import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { Socket } from "node:net";
import { dashboardCss, dashboardScript, renderDashboard, renderMain, renderShell } from "./dashboard.ts";
import { inventory, RunStore } from "./store.ts";
import { searchReports } from "./report-search.ts";
import { validateId } from "./paths.ts";
import type { RunState } from "./types.ts";
import { exportAllowed, portableMarkdown } from "./export.ts";
import { dashboardActionSchema, type DashboardControls } from "./dashboard-controls.ts";
import { RevisionApprovalChangedError } from "./revision-approval.ts";

async function actionBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0; let failed = false;
    const fail = () => { failed = true; reject(new Error("Invalid action body")); };
    req.setTimeout(10_000, () => { fail(); req.destroy(); });
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 24_000) { fail(); return; }
      if (!failed) chunks.push(chunk);
    });
    req.on("error", fail);
    req.on("end", () => {
      req.setTimeout(0);
      if (failed) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { fail(); }
    });
  });
}

export interface DashboardServer {
  url: string; publish(state: RunState, runnerLive?: boolean): void; close(): Promise<void>;
}
type Scope = { root: string; allowedTags?: ReadonlySet<string> } | { initial: RunState; live: boolean; persistedRoot?: string };
interface Client { response: ServerResponse; tag: string; line?: number; stamp?: string }
const metadata = (state: RunState) => ({ tag: state.tag, title: state.decomposition?.title, query: state.query,
  status: state.status, createdAt: state.createdAt, project: state.location?.projectPath });

/** A single-run token can never be upgraded into a central inventory capability. */
export async function startDashboard(initial: RunState, initialRunnerLive = true, root = initial.location?.dataRoot): Promise<DashboardServer> {
  return startServer({ initial: structuredClone(initial), live: initialRunnerLive, persistedRoot: root });
}
/** Explicitly grants access to central inventory, or just the supplied run set. */
export async function startInventory(root: string, allowedTags?: ReadonlySet<string>, controls?: DashboardControls): Promise<DashboardServer> {
  return startServer({ root, allowedTags: allowedTags ? new Set(allowedTags) : undefined }, controls);
}
async function startServer(scope: Scope, controls?: DashboardControls): Promise<DashboardServer> {
  const token = randomBytes(24).toString("hex");
  // Separate from the read URL; never included in snapshots, exports, or read-only shells.
  const controlToken = controls ? randomBytes(32).toString("hex") : undefined;
  const actions = new Map<string, { input: string; result: Promise<{ status: number; body: unknown }>; closeHandled?: boolean }>();
  let actionBusy = false;
  const clients = new Set<Client>(); const sockets = new Set<Socket>();
  const liveRuns = new Map<string, boolean>();
  if ("initial" in scope) liveRuns.set(scope.initial.tag, scope.live);
  let origin = ""; let closed = false; let searches = 0;
  const requests = new Set<AbortController>();
  const allowed = (tag: string) => {
    try { validateId(tag); } catch { return false; }
    return "initial" in scope ? scope.initial.tag === tag : !scope.allowedTags || scope.allowedTags.has(tag);
  };
  const load = (tag: string) => {
    if (!allowed(tag)) throw new Error("Not found");
    return "initial" in scope ? scope.persistedRoot ? new RunStore(scope.persistedRoot, tag).load() : scope.initial : new RunStore(scope.root, tag).load();
  };
  // Share the bounded inventory scan across clients and refresh it on live changes.
  let relatedCache: { at: number; data: ReturnType<typeof inventory> } | undefined;
  const related = (state: RunState) => {
    if ("initial" in scope) return { children: [] }; // Never expand a single-run capability.
    if (!relatedCache || Date.now() - relatedCache.at >= 5000) {
      relatedCache = { at: Date.now(), data: inventory(scope.root, scope.allowedTags) };
    }
    const data = relatedCache.data;
    let parent: RunState | undefined;
    if (state.revision && state.revision.parentTag !== state.tag && allowed(state.revision.parentTag)) {
      try { parent = load(state.revision.parentTag); } catch { /* Missing/corrupt parent remains a plain reference. */ }
    }
    return { parent, children: data.runs.filter(run => run.tag !== state.tag && run.revision?.parentTag === state.tag), partial: data.partial || data.issues.length > 0 };
  };
  const snapshot = (tag: string, line?: number) => {
    const state = load(tag);
    const lines = line ? state.report?.split("\n") : undefined;
    return { tag, html: renderMain(state, liveRuns.get(tag) ?? false, related(state), controls?.feedback(state)), at: state.updatedAt, hasReport: state.report !== undefined && exportAllowed(state),
      ...(line && lines ? { location: { line, text: lines.slice(Math.max(0, line - 3), line + 2).join("\n") } } : {}) };
  };
  const send = (client: Client) => {
    try {
      const payload = snapshot(client.tag, client.line); const serialized = JSON.stringify(payload);
      if (client.stamp === serialized) return;
      client.stamp = serialized;
      if (!client.response.write(`event: snapshot\ndata: ${serialized}\n\n`)) client.response.destroy();
    } catch {
      if (client.stamp !== "unavailable") client.response.write("event: unavailable\ndata: {}\n\n");
      client.stamp = "unavailable";
    }
  };
  const list = () => {
    if (!("initial" in scope)) return inventory(scope.root, scope.allowedTags);
    try { return { runs: [load(scope.initial.tag)], issues: [], partial: false }; }
    catch { return { runs: [], issues: [], partial: false }; }
  };
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("X-Frame-Options", "DENY");
    const actionRoute = req.url === `/${token}/actions`;
    if ((req.method !== "GET" && !(req.method === "POST" && actionRoute && controls)) || req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin) || req.headers["sec-fetch-site"] === "cross-site") {
      res.writeHead(403).end("Forbidden"); return;
    }
    if (!req.url || req.url.length > 4096) { res.writeHead(400).end("Request too long"); return; }
    const controller = new AbortController(); requests.add(controller);
    res.on("close", () => { controller.abort(); requests.delete(controller); });
    const json = (value: unknown) => { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, origin); const route = url.pathname;
      if (route === `/${token}/`) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderShell("initial" in scope ? scope.initial : undefined, true, "initial" in scope && scope.live, controlToken)); return;
      }
      if (route === `/${token}/style.css` || route === `/${token}/app.js`) {
        res.setHeader("Content-Type", route.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
        res.end(route.endsWith(".css") ? dashboardCss : dashboardScript); return;
      }
      if (route === `/${token}/controls` || route === `/${token}/actions`) {
        // Retain the legacy header for existing authenticated dashboard clients.
        if (!controls || (req.headers["x-turing-control"] ?? req.headers["x-hyperresearch-control"]) !== controlToken ||
          (route.endsWith("/actions") && (req.method !== "POST" || req.headers.origin !== origin || req.headers["content-type"] !== "application/json"))) {
          res.writeHead(403).end("Forbidden"); return;
        }
        if (route.endsWith("/controls")) { json(controls.session()); return; }
        const parsed = dashboardActionSchema.safeParse(await actionBody(req));
        if (!parsed.success) { res.statusCode = 400; json({ error: "Invalid action or missing spending authorization. Feedback must contain 1–4000 characters; refresh the dashboard before retrying." }); return; }
        const action = parsed.data;
        if (("tag" in action && !allowed(action.tag)) || (action.kind === "close" && action.activeTag && !allowed(action.activeTag))) {
          res.statusCode = 404; json({ error: "Investigation unavailable." }); return;
        }
        const input = JSON.stringify(action);
        let entry = actions.get(action.id);
        if (entry && entry.input !== input) { res.statusCode = 409; json({ error: "Request ID already used for another action." }); return; }
        if (!entry) {
          if (actionBusy || actions.size >= 100) { res.statusCode = 409; json({ error: actionBusy ? "Another action is starting or awaiting private-context permission. Wait for it to finish first." : "Action limit reached. Close and reopen the dashboard in Pi." }); return; }
          actionBusy = true;
          entry = { input, result: Promise.resolve().then(() => controls.execute(action))
            .then(body => ({ status: 200, body }))
            .catch(error => ({ status: 409, body: { error: error instanceof RevisionApprovalChangedError ? error.message : "Action not completed. Check Pi for details, then refresh before trying again." } }))
            .finally(() => { actionBusy = false; relatedCache = undefined; for (const client of clients) send(client); }) };
          actions.set(action.id, entry);
        }
        const result = await entry.result;
        const afterClose = () => {
          if (action.kind !== "close" || entry!.closeHandled) return;
          entry!.closeHandled = true;
          void controls.afterClose().catch(() => {});
        };
        if (res.destroyed) { afterClose(); return; }
        // A lost response must not leave the Pi close flow waiting forever. Cached retries
        // acknowledge the same result without repeating cleanup on a reopened UI.
        res.once("finish", afterClose); res.once("close", afterClose);
        res.statusCode = result.status; json(result.body); return;
      }
      if (route === `/${token}/runs`) {
        const data = list(); json({ runs: data.runs.map(metadata), issues: data.issues.length, partial: !!data.partial,
          scope: "initial" in scope ? "Access: this investigation only" : scope.allowedTags ? "Access: explicitly selected investigations" : "Access: all accessible central investigations (this token exposes their reports)" }); return;
      }
      if (route === `/${token}/markdown` || route === `/${token}/html`) {
        const tag = url.searchParams.get("id") ?? ("initial" in scope ? scope.initial.tag : "");
        if (!allowed(tag)) { res.writeHead(404).end("Not found"); return; }
        const state = load(tag);
        const markdown = route.endsWith("/markdown");
        res.setHeader("Content-Type", markdown ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${tag}.${markdown ? "md" : "html"}"`);
        res.end(markdown ? portableMarkdown(state) : renderDashboard(state)); return;
      }
      if (route === `/${token}/run` || route === `/${token}/events`) {
        const tag = url.searchParams.get(route.endsWith("/run") ? "id" : "run") ?? ("initial" in scope ? scope.initial.tag : "");
        if (!allowed(tag)) { res.writeHead(404).end("Not found"); return; }
        const lineText = url.searchParams.get("line"); const line = lineText ? Number(lineText) : undefined;
        if (line !== undefined && (!Number.isSafeInteger(line) || line < 1 || line > 200_000)) throw new Error("Invalid line");
        load(tag); // Reject an inaccessible checkpoint before opening a stream.
        if (route.endsWith("/run")) { json(snapshot(tag, line)); return; }
        if (clients.size >= 16) { res.writeHead(503).end("Too many dashboard connections"); return; }
        res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
        const client = { response: res, tag, line }; clients.add(client); send(client);
        res.on("close", () => clients.delete(client)); return;
      }
      if (route === `/${token}/search`) {
        if (searches >= 2) { res.writeHead(429).end("Too many searches"); return; }
        searches++;
        try {
          const data = list();
          const root = "root" in scope ? scope.root : scope.persistedRoot;
          if (!root) { res.writeHead(400).end("Snapshot has no central report path"); return; }
          const result = await searchReports(root, data.runs.map(state => state.tag), url.searchParams.get("q") ?? "", { signal: controller.signal });
          if (data.partial) { result.partial = true; result.reason ??= "Inventory scan limit reached"; }
          json(result);
        } finally { searches--; }
        return;
      }
      res.writeHead(404).end("Not found");
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (controller.signal.aborted) { res.destroy(); return; }
      res.writeHead(400).end(error instanceof Error && error.message.startsWith("Search needs") ? error.message : "Run or request unavailable");
    }
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No dashboard address");
  origin = `http://127.0.0.1:${address.port}`;
  const polling = setInterval(() => { if ("root" in scope || scope.persistedRoot) for (const client of clients) send(client); }, 1000); polling.unref();
  const heartbeat = setInterval(() => { for (const client of clients) if (!client.response.write(": heartbeat\n\n")) client.response.destroy(); }, 15_000); heartbeat.unref();
  return {
    url: `${origin}/${token}/`,
    publish(state, runnerLive = "initial" in scope ? scope.live : false) {
      if (closed || !allowed(state.tag)) return;
      if ("initial" in scope) { scope.initial = structuredClone(state); scope.live = runnerLive; }
      liveRuns.set(state.tag, runnerLive);
      relatedCache = undefined;
      for (const client of clients) send(client);
    },
    async close() {
      if (closed) return; closed = true; clearInterval(polling); clearInterval(heartbeat);
      for (const controller of requests) controller.abort();
      for (const client of clients) client.response.end();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

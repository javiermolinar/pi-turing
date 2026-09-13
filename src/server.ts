import { createServer, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { Socket } from "node:net";
import { renderDashboard, renderMain } from "./dashboard.ts";
import type { RunState } from "./types.ts";

/** Read-only, loopback-only dashboard. No filesystem routes or write endpoints. */
export async function startDashboard(initial: RunState, initialRunnerLive = true): Promise<{
  url: string; publish(state: RunState, runnerLive?: boolean): void; close(): Promise<void>;
}> {
  let state = structuredClone(initial);
  let runnerLive = initialRunnerLive;
  const token = randomBytes(24).toString("hex");
  const clients = new Set<ServerResponse>();
  const sockets = new Set<Socket>();
  let origin = "";
  const snapshot = () => `event: snapshot\ndata: ${JSON.stringify({ html: renderMain(state, runnerLive), at: state.updatedAt })}\n\n`;
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    // Host validation also rejects DNS-rebinding requests; no CORS headers.
    if (req.method !== "GET" || req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin) || req.headers["sec-fetch-site"] === "cross-site") {
      res.writeHead(403).end("Forbidden"); return;
    }
    if (req.url === `/${token}/`) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(renderDashboard(state, true, runnerLive)); return;
    }
    if (req.url === `/${token}/events`) {
      if (clients.size >= 16) { res.writeHead(503).end("Too many dashboard connections"); return; }
      res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
      res.write(snapshot()); clients.add(res);
      res.on("close", () => clients.delete(res)); return;
    }
    res.writeHead(404).end("Not found");
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No dashboard address");
  origin = `http://127.0.0.1:${address.port}`;
  const heartbeat = setInterval(() => {
    for (const res of clients) if (!res.write(": heartbeat\n\n")) res.destroy();
  }, 15_000);
  heartbeat.unref();
  let closed = false;
  return {
    url: `${origin}/${token}/`,
    publish(next, live = runnerLive) {
      if (closed) return;
      runnerLive = live;
      state = structuredClone(next);
      const payload = snapshot();
      // Disconnect slow clients instead of buffering an unbounded history.
      for (const res of clients) if (!res.write(payload)) res.destroy();
    },
    async close() {
      if (closed) return;
      closed = true; clearInterval(heartbeat);
      for (const client of clients) client.end();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import lockfile from "proper-lockfile";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PythonBackend, setupBackend } from "../src/backend.ts";
import { execute } from "../src/process.ts";
import { ResearchRunner } from "../src/runner.ts";
import { startDashboard } from "../src/server.ts";
import { ensureSearchConfigured } from "../src/search.ts";
import { queueFeedback, feedbackSummary } from "../src/feedback.ts";
import { progressLines } from "../src/progress.ts";
import { ResearchWidget } from "../src/widget.ts";
import { listRuns, loadConfig, RunStore } from "../src/store.ts";
import { cleanTerminal, feedbackTextSchema, message, type RunState } from "../src/types.ts";
import { PiWorkerDriver } from "../src/worker.ts";

const help = `Hyperresearch — light pipeline (experimental)
/hyperresearch start <question>  Start research using the selected Pi model
/hyperresearch status [tag]      Show persisted progress
/hyperresearch steer <feedback>  Queue feedback; replan at next stage boundary
/hyperresearch revise <tag> <feedback>  New revision of a completed report
/hyperresearch pause             Interrupt safely; keep artifacts
/hyperresearch resume [tag]      Resume first incomplete stage
/hyperresearch cancel            Abort; keep artifacts
/hyperresearch dashboard [tag]   Open live localhost dashboard
/hyperresearch snapshot [tag]    Open saved standalone HTML
/hyperresearch setup             Install the pinned backend with uv

A bare question also starts a run. Config: .pi/hyperresearch.json.
Only light mode is implemented. Default model-cost ceiling: ~$15.
Search fees are separate; in-flight model calls may overshoot.
Paused/failed stages restart with persisted sources, not hidden agent history.
Chat does not steer research. Steering replans all stages and retains spend.
Applied means included in worker instructions, not verified fulfillment.
Revisions preserve the parent report and start with a fresh cost ceiling.`;

export default function hyperresearch(pi: ExtensionAPI) {
  let active: ResearchRunner | undefined;
  let task: Promise<void> | undefined;
  let launching = false;
  let startup: Promise<void> | undefined;
  let dashboardOpening: Promise<void> | undefined;
  let latest: RunState | undefined;
  let dashboard: Awaited<ReturnType<typeof startDashboard>> | undefined;
  let dashboardTag: string | undefined;
  let release: (() => Promise<void>) | undefined;
  let lifecycle = new AbortController();
  let widget: ResearchWidget | undefined;
  const disposeWidget = () => { widget?.dispose(); widget = undefined; };

  const trusted = (ctx: ExtensionContext) => {
    if (!ctx.isProjectTrusted()) throw new Error("Trust this project in Pi before starting research or reading project-local configuration.");
  };
  const say = (ctx: ExtensionContext, text: string) => {
    const safe = text.split("\n").map(cleanTerminal).join("\n");
    if (ctx.hasUI) ctx.ui.notify(safe, "info");
    else if (ctx.mode === "json") process.stdout.write(JSON.stringify({ type: "hyperresearch_status", text: safe }) + "\n");
    else process.stdout.write(safe + "\n");
  };
  const show = (state: RunState, ctx: ExtensionContext) => {
    latest = structuredClone(state);
    const live = active?.state.tag === state.tag && !lifecycle.signal.aborted;
    if (dashboardTag === state.tag) dashboard?.publish(state, live);
    const url = dashboardTag === state.tag ? dashboard?.url : undefined;
    if (ctx.mode === "tui") {
      if (!widget) ctx.ui.setWidget("hyperresearch", (tui, theme) => {
        widget = new ResearchWidget(() => tui.requestRender(), theme);
        widget.update(latest!, live, url); return widget;
      });
      widget?.update(latest, live, url);
    } else if (ctx.hasUI) ctx.ui.setWidget("hyperresearch", progressLines(state, live, Date.now(), 0, url));
  };
  const resolveState = (ctx: ExtensionContext, tag?: string): RunState => {
    const state = tag ? new RunStore(ctx.cwd, tag).load() : active?.state ?? latest ?? listRuns(ctx.cwd)[0];
    if (!state) throw new Error("No Hyperresearch run in this directory");
    if (state.status === "running" && active?.state.tag !== state.tag) {
      return { ...state, reason: "Last recorded as running. This Pi session is showing saved state, not live worker activity; another process may own the vault." };
    }
    return state;
  };
  const open = async (url: string, ctx: ExtensionContext) => {
    say(ctx, url);
    if (ctx.mode !== "tui") return;
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
    try { await execute(command, [url], { cwd: ctx.cwd, timeoutMs: 10_000, signal: lifecycle.signal }); }
    catch { say(ctx, `Open this URL manually: ${url}`); }
  };
  function launch(ctx: ExtensionContext, query?: string, resumeTag?: string, revision?: { tag: string; feedback: string }): Promise<void> {
    if (active || launching) return Promise.reject(new Error("A run is already active. Pause or cancel it first."));
    startup = launchInner(ctx, query, resumeTag, revision);
    return startup;
  }
  async function launchInner(ctx: ExtensionContext, query?: string, resumeTag?: string, revision?: { tag: string; feedback: string }): Promise<void> {
    trusted(ctx);
    if (active || launching) throw new Error("A run is already active. Pause or cancel it first.");
    launching = true;
    try {
      lifecycle.signal.throwIfAborted();
      // No two Pi sessions may mutate the same vault through this port.
      // proper-lockfile heartbeats and reclaims a stale lock after a crash.
      release = await lockfile.lock(ctx.cwd, {
        lockfilePath: join(ctx.cwd, ".hyperresearch-runner.lock"), retries: 0,
        stale: 30_000, update: 10_000,
        onCompromised: error => { active?.stop("paused"); say(ctx, `Runner lock lost: ${message(error)}`); },
      });
      for (const path of [".hyperresearch", "research"]) {
        const full = join(ctx.cwd, path);
        if (existsSync(full) && lstatSync(full).isSymbolicLink()) throw new Error(`Refusing symlink workspace: ${full}`);
      }
      const config = loadConfig(ctx.cwd);
      ensureSearchConfigured(config.searchProvider);
      const backend = new PythonBackend(ctx.cwd);
      const driver = await PiWorkerDriver.create(ctx);
      lifecycle.signal.throwIfAborted();
      if (query !== undefined || revision) {
        if (!ctx.model) throw new Error("Select an authenticated model first");
        active = revision
          ? await ResearchRunner.revise(ctx.cwd, new RunStore(ctx.cwd, revision.tag).load(), revision.feedback, config,
            `${ctx.model.provider}/${ctx.model.id}`, ctx.thinkingLevel ?? "medium", backend, driver, state => show(state, ctx))
          : await ResearchRunner.create(ctx.cwd, query!, config, `${ctx.model.provider}/${ctx.model.id}`, ctx.thinkingLevel ?? "medium",
            backend, driver, state => show(state, ctx));
      } else {
        const state = resolveState(ctx, resumeTag);
        state.config = config; // Explicit resume picks up budget/provider/model changes.
        active = new ResearchRunner(ctx.cwd, state, backend, driver, current => show(current, ctx));
      }
      if (lifecycle.signal.aborted) { active.stop("paused"); throw new Error("Session ended during research setup"); }
      const runner = active;
      pi.appendEntry("hyperresearch-run", { tag: runner.state.tag });
      say(ctx, `Starting light research: ${runner.state.tag} (search: ${runner.state.config.searchProvider}). /hyperresearch dashboard opens live progress.`);
      task = runner.run().then(() => {
        say(ctx, `${runner.state.status}: ${runner.state.reason ?? runner.store.reportPath}`);
      }).catch(error => { say(ctx, `Research failed: ${message(error)}`); }).finally(async () => {
        active = undefined;
        const unlock = release; release = undefined;
        await unlock?.();
      });
    } catch (error) {
      active = undefined;
      const unlock = release; release = undefined;
      await unlock?.(); throw error;
    } finally { launching = false; }
  }

  pi.registerCommand("hyperresearch", {
    description: "Research with a persistent vault and live/offline HTML dashboard",
    getArgumentCompletions: prefix => ["start", "status", "steer", "revise", "pause", "resume", "cancel", "dashboard", "snapshot", "setup"]
      .filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: async (args, ctx) => {
      try {
        const input = args.trim();
        const [command, ...rest] = input.split(/\s+/);
        const argument = rest.join(" ");
        if (!input || command === "help") { say(ctx, help); return; }
        if (command === "setup") {
          trusted(ctx);
          if (active || launching) throw new Error("Stop the run before updating the backend");
          if (ctx.hasUI && !await ctx.ui.confirm("Install research backend?", "uv will install the pinned Hyperresearch Python package and dependencies. No Claude files or browser profiles will be installed.")) return;
          launching = true;
          try { await setupBackend(ctx.cwd, lifecycle.signal); }
          finally { launching = false; }
          say(ctx, "Backend installed. Start with /hyperresearch <question>."); return;
        }
        if (command === "steer") {
          trusted(ctx);
          const feedback = feedbackTextSchema.parse(argument);
          if (launching) throw new Error("Wait for research setup to finish");
          if (active) {
            const note = active.steer(feedback);
            say(ctx, `Feedback ${note.id} queued. Current workers are unchanged; all stages replan at the next boundary. Existing spend counts toward the ceiling.`);
          } else {
            launching = true;
            startup = (async () => {
              const unlock = await lockfile.lock(ctx.cwd, { lockfilePath: join(ctx.cwd, ".hyperresearch-runner.lock"), retries: 0, stale: 30_000 });
              try {
                lifecycle.signal.throwIfAborted();
                const selected = resolveState(ctx);
                const store = new RunStore(ctx.cwd, selected.tag);
                const state = store.load(); // Re-read under lock, not a cached view.
                if (state.status === "running") throw new Error("Resume the interrupted run explicitly before steering it");
                const note = queueFeedback(state, feedback); store.save(state); show(state, ctx);
                say(ctx, `Feedback ${note.id} queued for ${state.tag}. /hyperresearch resume applies it and replans; no workers started.`);
              } finally { await unlock(); }
            })();
            try { await startup; } finally { launching = false; }
          }
          return;
        }
        if (command === "pause" || command === "cancel") {
          if (!active) { say(ctx, "No active run"); return; }
          active.stop(command === "pause" ? "paused" : "aborted"); await task; return;
        }
        if (["status", "dashboard", "snapshot"].includes(command)) {
          trusted(ctx);
          const state = resolveState(ctx, argument || undefined);
          if (command === "status") { show(state, ctx); say(ctx, `${state.tag}: ${state.status}${state.reason ? ` — ${state.reason}` : ""}\nSteering: ${feedbackSummary(state)}${state.feedback.length ? "\n" + state.feedback.map(f => `${f.id}. ${f.status}: ${f.text}`).join("\n") : ""}`); return; }
          if (command === "snapshot") { await open(pathToFileURL(join(ctx.cwd, "research", "runs", state.tag, "dashboard.html")).href, ctx); return; }
          if (dashboardOpening) throw new Error("Dashboard is already opening");
          dashboardOpening = (async () => {
            lifecycle.signal.throwIfAborted();
            if (!dashboard || dashboardTag !== state.tag) {
              await dashboard?.close(); dashboard = await startDashboard(state, active?.state.tag === state.tag); dashboardTag = state.tag;
            }
            if (lifecycle.signal.aborted) { await dashboard.close(); dashboard = undefined; return; }
            show(state, ctx); await open(dashboard.url, ctx);
          })();
          try { await dashboardOpening; } finally { dashboardOpening = undefined; }
          return;
        }
        if (command === "revise") {
          const [tag, ...feedback] = rest;
          if (!tag || !feedback.length) throw new Error("Usage: /hyperresearch revise <tag> <feedback>");
          await launch(ctx, undefined, undefined, { tag, feedback: feedbackTextSchema.parse(feedback.join(" ")) });
        } else if (command === "resume") await launch(ctx, undefined, argument || undefined);
        else await launch(ctx, command === "start" ? input.slice(6).trim() : input);
        // In print/JSON mode don't let process exit while workers are in flight.
        if (!ctx.hasUI) await task;
      } catch (error) { say(ctx, `Hyperresearch: ${message(error)}`); }
    },
  });
  pi.registerTool({
    name: "hyperresearch_run", label: "Hyperresearch",
    description: "Run the light research pipeline and wait for its verified report or explicit failure. Only use when the user explicitly requests research with Hyperresearch. May take 30+ minutes and incur model/search costs; default model estimate ceiling ~$15. Requires /hyperresearch setup.",
    parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 30_000 }) }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      await launch(ctx, params.query);
      const runner = active;
      const abort = () => runner?.stop("paused");
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      try {
        await task;
        const state = runner?.state;
        if (!state || state.status !== "done") throw new Error(state?.reason ?? "Research did not complete");
        return { content: [{ type: "text", text: `Light research verified. Report: ${runner!.store.reportPath}\nDashboard snapshot: ${join(runner!.store.dir, "dashboard.html")}` }], details: { tag: state.tag, cost: state.cost, tokens: state.tokens } };
      } finally { signal?.removeEventListener("abort", abort); }
    },
  });
  pi.on("before_agent_start", (event, ctx) => {
    const state = active?.state ?? latest;
    if (!state || !ctx.isProjectTrusted()) return;
    return {
      systemPrompt: event.systemPrompt + "\nHyperresearch workers are isolated from this chat. Ordinary prompts do not steer them. " +
        "For progress questions, read the checkpoint or report as needed. Do not edit host-owned research state or claim feedback was applied through chat. " +
        "Direct the user to /hyperresearch steer <feedback> or /hyperresearch revise <tag> <feedback> for changes.",
      message: { customType: "hyperresearch-context", display: false, content: JSON.stringify({
        tag: state.tag, status: state.status, liveInThisSession: !!active, activity: state.activity,
        steering: feedbackSummary(state), checkpoint: join(ctx.cwd, "research", "runs", state.tag, "pi-state.json"),
        report: new RunStore(ctx.cwd, state.tag).reportPath,
      }) },
    };
  });
  pi.on("session_start", (_event, ctx) => {
    lifecycle = new AbortController();
    if (ctx.isProjectTrusted()) {
      latest = listRuns(ctx.cwd)[0];
      if (latest) {
        // Persisted running means only 'last known running' until explicitly resumed.
        if (latest.status === "running") { latest = structuredClone(latest); latest.reason = "Last recorded as running. Resume explicitly; this session is not running it."; }
        show(latest, ctx);
      }
    }
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    lifecycle.abort(); disposeWidget(); active?.stop("paused");
    await startup?.catch(() => {});
    active?.stop("paused");
    await Promise.allSettled([task, dashboardOpening]);
    await dashboard?.close(); dashboard = undefined; dashboardTag = undefined;
    disposeWidget();
    if (ctx.hasUI) ctx.ui.setWidget("hyperresearch", undefined);
  });
}

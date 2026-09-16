import { join } from "node:path";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { contextPermissions, contextRequest } from "../src/approvals.ts";
import { approveContext, previewContext, revokeContext } from "../src/context.ts";
import { execute } from "../src/process.ts";
import { prepareResearch, type LaunchRequest } from "../src/launch.ts";
import { RunController } from "../src/run-controller.ts";
import { startDashboard, startInventory } from "../src/server.ts";
import type { DashboardControls, FeedbackControl } from "../src/dashboard-controls.ts";
import { revisionSpendingOffer } from "../src/revision-approval.ts";
import { parseResumeOptions } from "../src/budget.ts";
import { queueFeedback, feedbackSummary } from "../src/feedback.ts";
import { progressLines } from "../src/progress.ts";
import { ResearchWidget } from "../src/widget.ts";
import { inventory, listRuns, RunStore } from "../src/store.ts";
import { dataRoot, requireLocation } from "../src/paths.ts";
import { lockDataRoot, writerLocked } from "../src/locks.ts";
import { migrateLegacy, previewMigration, rollbackMigration } from "../src/migration.ts";
import { pickerRows, RunPicker, runActions } from "../src/picker.ts";
import { portableMarkdown, prepareSave, saveMarkdown } from "../src/export.ts";
import { cleanTerminal, requireLightRun, isReadOnlyRun, feedbackTextSchema, message, type RunState } from "../src/types.ts";

const help = `Turing — research for the questions behind your code
/turing              Open the dashboard
/turing <question>   Start research with Pi approval
/turing close        Hide the UI, or pause and close
/turing help         Show this help

Browse, read, steer, follow up, and export in the dashboard.
Steering updates ongoing work. The follow-up button authorizes its displayed model-cost ceiling.
Private-context reuse requires separate permission in Pi.
Closing the UI preserves saved investigations and never silently cancels research.
Default model-cost ceiling: ~$15; search fees are separate.
Advanced/compatibility commands: /turing help advanced`;

const advancedHelp = `Turing — advanced and compatibility commands
/turing browse           Browse saved investigations in the terminal
/turing list             List central runs without opening a picker
/turing start <question>  Start research using the selected Pi model
/turing status [tag]      Show persisted progress
/turing steer <feedback>  Queue feedback; offer a revision if already done
/turing context [tag]     Approve local context for a paused run (or revoke)
/turing revise <tag> <feedback>  New revision of a completed report
/turing pause             Interrupt safely; keep artifacts
/turing resume [tag]      Resume with saved context/configuration
  Exhausted budgets offer an approved $15 top-up; spend is never reset
  Add --add-budget <USD> to explicitly increase this run's total ceiling
  Or --use-project-config to propose current project preferences (not both)
/turing cancel            Abort; keep artifacts
/turing dashboard         Open full inventory, focused on the active run if any
/turing dashboard <tag>   Open full inventory, focused on this investigation
/turing dashboard all     Open the full inventory list
/turing snapshot [tag]    Generate/open standalone HTML
/turing export [tag]      Browser-managed Markdown download
/turing save [--overwrite] <tag> <path.md>  Save a portable report
/turing migrate [apply]   Preview/copy this checkout's legacy runs
/turing migrate rollback <id>  Roll back an unchanged migration

A bare question also starts a run using configured defaults, without a context questionnaire.
Files/readers are opt-in via config or /turing context. Config: .pi/turing.json.
The old /hyperresearch command and .pi/hyperresearch.json remain supported.
Light research only. Default model-cost ceiling: ~$15, not a completion estimate.
Full/extended execution has been removed; old runs remain read-only.
Search fees are separate; in-flight model calls may overshoot.
Paused/failed stages restart with persisted sources, not hidden agent history.
Metadata outages retry verification without rerunning paid editing stages.
OpenAlex approval is required for the final retraction refresh.
Chat does not steer research. Steering replans all stages and retains spend.
Applied means included in worker instructions, not verified fulfillment.
Revisions preserve the parent report and start with a fresh cost ceiling.`;

type ViewCommand = "status" | "dashboard" | "snapshot" | "export";

export default function turing(pi: ExtensionAPI) {
  let controller = new RunController();
  let latest: RunState | undefined;
  let uiHidden = false;
  let closingFromDashboard = false;
  const sessionRuns = new Set<string>();
  let dashboardOpening: Promise<void> | undefined;
  // Direct downloads stay run-scoped; interactive dashboards share the approved inventory.
  let exportDashboard: Awaited<ReturnType<typeof startDashboard>> | undefined;
  let exportTag: string | undefined;
  let inventoryDashboard: Awaited<ReturnType<typeof startInventory>> | undefined;
  const dashboardUrl = (tag: string) => inventoryDashboard ? new URL(`?run=${encodeURIComponent(tag)}`, inventoryDashboard.url).href : undefined;
  let widget: ResearchWidget | undefined;
  const disposeWidget = () => { widget?.dispose(); widget = undefined; };

  const trusted = (ctx: ExtensionContext) => {
    if (!ctx.isProjectTrusted()) throw new Error("Trust this project in Pi before starting research or reading project-local configuration.");
  };
  // Keep the legacy JSON event/custom-entry identifiers stable for consumers
  // and saved sessions; visible names and command guidance use Turing.
  const say = (ctx: ExtensionContext, text: string, level: "info" | "warning" | "error" = "info") => {
    const safe = text.split("\n").map(cleanTerminal).join("\n");
    if (ctx.hasUI) ctx.ui.notify(safe, level);
    else if (ctx.mode === "json") process.stdout.write(JSON.stringify({ type: "hyperresearch_status", text: safe }) + "\n");
    else process.stdout.write(safe + "\n");
  };
  const show = (state: RunState, ctx: ExtensionContext) => {
    const live = controller.active?.state.tag === state.tag && !controller.signal.aborted;
    if (exportTag === state.tag) exportDashboard?.publish(state, live);
    inventoryDashboard?.publish(state, live);
    if (uiHidden) return;
    latest = structuredClone(state);
    const url = dashboardUrl(state.tag);
    if (ctx.mode === "tui") {
      if (!widget) ctx.ui.setWidget("turing", (tui, theme) => {
        widget = new ResearchWidget(() => tui.requestRender(), theme);
        widget.update(latest!, live, url);
        return widget;
      });
      widget?.update(latest, live, url);
    } else if (ctx.hasUI) ctx.ui.setWidget("turing", progressLines(state, live, Date.now(), 0, url));
  };
  const resolveState = (ctx: ExtensionContext, tag?: string): RunState => {
    const state = tag ? new RunStore(dataRoot(), tag).load() : controller.active?.state ?? latest ?? listRuns(dataRoot()).find(s => s.location?.projectPath === realpathSync(ctx.cwd));
    if (!state) throw new Error("No selected Turing run. Supply a central run ID.");
    if (state.status === "running" && controller.active?.state.tag !== state.tag) {
      return { ...state, reason: "Last recorded as running. This Pi session is showing saved state, not live worker activity; another process may own the vault." };
    }
    return state;
  };
  const open = async (url: string, ctx: ExtensionContext) => {
    say(ctx, url);
    if (ctx.mode !== "tui") return;
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
    try { await execute(command, [url], { cwd: ctx.cwd, timeoutMs: 10_000, signal: controller.signal }); }
    catch { say(ctx, `Open this URL manually: ${url}`); }
  };
  const saveReport = async (ctx: ExtensionContext, state: RunState, path?: string, overwrite = false) => {
    const signal = controller.signal;
    const input = path ?? (ctx.hasUI ? await ctx.ui.input("Save report to .md path", join(ctx.cwd, `${state.tag}.md`), { signal }) : undefined);
    if (!input) return;
    const markdown = portableMarkdown(state);
    const target = prepareSave(ctx.cwd, input, dataRoot());
    const approved = target.existingHash ? (ctx.hasUI ? await ctx.ui.confirm("Overwrite exported report?", `${target.path}\nThis replaces your existing copy. The preserved run is unchanged.`, { signal }) : overwrite) : false;
    signal.throwIfAborted();
    if (target.existingHash && !approved) { say(ctx, "Save cancelled: overwrite not approved. Non-interactive saves require --overwrite."); return; }
    saveMarkdown(target, markdown, approved);
    say(ctx, `Report saved: ${target.path}. This is a copy; verification status is included.`);
  };
  const launch = async (ctx: ExtensionContext, request: LaunchRequest, signal?: AbortSignal) => {
    if (!controller.busy) uiHidden = false;
    const started = await controller.start(scope => prepareResearch(ctx, request, scope, state => show(state, ctx), text => say(ctx, text)), signal);
    if (started) {
      const { runner, done } = started;
      sessionRuns.add(runner.state.tag);
      show(runner.state, ctx);
      say(ctx, `Starting ${runner.state.profile} research: ${runner.state.tag} (search: ${runner.state.config.searchProvider}). /turing dashboard opens live progress.`);
      void done.then(() => { if (!uiHidden) say(ctx, `${runner.state.status}: ${runner.state.reason ?? runner.store.reportPath}`); })
        .catch(error => { if (!uiHidden) say(ctx, `Research failed: ${message(error)}`, "error"); })
        .finally(() => closeIdleViews()).catch(() => {});
    }
    return started;
  };
  const launchCommand = async (ctx: ExtensionContext, request: LaunchRequest) => {
    const started = await launch(ctx, request);
    // Print/JSON commands must not let the process exit with workers in flight.
    if (!ctx.hasUI) await started?.done;
  };

  async function closeIdleViews(): Promise<void> {
    if (!uiHidden || controller.busy || closingFromDashboard) return;
    const inventory = inventoryDashboard; inventoryDashboard = undefined;
    const download = exportDashboard; exportDashboard = undefined; exportTag = undefined;
    await Promise.all([inventory?.close(), download?.close()]);
  }

  async function closeUI(ctx: ExtensionContext, mode?: "hide" | "pause", expectedTag?: string, fromDashboard = false): Promise<void> {
    trusted(ctx);
    if (controller.preparing || dashboardOpening) throw new Error("Another action is starting or awaiting permission. Wait for it to finish before closing the research UI.");
    const active = controller.active;
    if (fromDashboard && mode === "pause" && active?.state.tag !== expectedTag) throw new Error("The active investigation changed. Reopen the close dialog.");
    if (!mode && active) {
      if (!ctx.hasUI) throw new Error("Research is active. Use /turing close hide or /turing close pause.");
      const choice = await ctx.ui.select("Close research UI? Saved investigations are preserved.", ["Hide UI, keep running", "Pause and close", "Cancel"], { signal: controller.signal });
      if (!choice || choice === "Cancel") return;
      if (controller.active !== active || controller.preparing) throw new Error("The active investigation changed. Try closing again.");
      mode = choice === "Pause and close" ? "pause" : "hide";
    }
    closingFromDashboard = fromDashboard;
    uiHidden = true; latest = undefined; disposeWidget();
    if (ctx.hasUI) ctx.ui.setWidget("turing", undefined);
    if (mode === "pause" && active) await controller.stop("paused");
    if (!fromDashboard) {
      await closeIdleViews();
      say(ctx, controller.busy ? "Research UI hidden. Work continues; /turing reopens it." : "Research UI closed. Saved investigations are preserved; /turing reopens them.");
    }
  }

  function dashboardControls(ctx: ExtensionContext): DashboardControls {
    const feedback = (state: RunState): FeedbackControl => {
      if (!ctx.isProjectTrusted() || uiHidden || controller.signal.aborted) return { reason: "Controls are closed. Reopen with /turing in Pi." };
      if (isReadOnlyRun(state)) return { reason: "Historical investigation: read-only." };
      if (controller.preparing) return { reason: "Another action is starting or awaiting permission. Wait for it to finish first." };
      if (state.status === "running" && controller.active?.state.tag === state.tag) return { mode: "steer" };
      if (state.status === "paused" && sessionRuns.has(state.tag) && !controller.busy) return { mode: "steer" };
      if (state.status === "done" && state.report && !controller.busy && (!state.inputs || ctx.hasUI)) return { mode: "revise", spendingApproval: revisionSpendingOffer(state) };
      return { reason: state.status === "done" ? "Follow-ups require an idle Pi session; private-context reuse also needs interactive permission."
        : "Resume this investigation in Pi before steering it here. Only work owned by this Pi session can be steered." };
    };
    return {
      feedback,
      session: () => ({ activeTag: controller.active?.state.tag, preparing: controller.preparing, hidden: uiHidden }),
      async execute(action) {
        try {
          trusted(ctx); controller.signal.throwIfAborted();
          if (uiHidden) throw new Error("Research UI is closed. Reopen it in Pi.");
          if (action.kind === "close") {
            await closeUI(ctx, action.mode, action.activeTag, true);
            return { kind: "closed", message: controller.busy ? "Research UI hidden. Work continues in Pi." : "Research UI closed. Saved investigations are preserved." };
          }
          const state = new RunStore(dataRoot(), action.tag).load();
          if (feedback(state).mode !== action.kind) throw new Error(feedback(state).reason ?? "Investigation changed. Refresh before submitting feedback.");
          if (action.kind === "steer") {
            await steer(ctx, action.text, action.tag, true);
            return { kind: "queued", tag: action.tag, message: state.status === "paused" ? "Guidance saved. Research remains paused." : "Guidance queued for the next stage boundary." };
          }
          // The authenticated click approves these exact spending terms. The existing
          // launch path still checks them under lock and separately renews private context.
          const started = await launch(ctx, { kind: "revise", tag: action.tag, feedback: action.text,
            spendingApproval: { ...action.spendingApproval, source: "dashboard", requestId: action.id, at: new Date().toISOString() } });
          return started ? { kind: "revision", tag: started.runner.state.tag, message: "Linked revision started. The original report is preserved." }
            : { kind: "cancelled", message: "Private-context reuse was not approved in Pi. No new investigation started; your feedback is retained here." };
        } catch (error) { say(ctx, `Dashboard action: ${message(error)}`, "error"); throw error; }
      },
      afterClose: async () => { closingFromDashboard = false; await closeIdleViews(); },
    };
  }

  async function view(ctx: ExtensionContext, command: ViewCommand, tag?: string): Promise<void> {
    trusted(ctx);
    if (command === "dashboard" && !tag) {
      const active = controller.active;
      tag = active?.state.status === "running" && !controller.signal.aborted ? active.state.tag : "all";
    }
    if (command === "dashboard") {
      if (dashboardOpening) throw new Error("Dashboard is already opening");
      const state = tag === "all" ? undefined : resolveState(ctx, tag);
      dashboardOpening = (async () => {
        if (!inventoryDashboard && ctx.hasUI && !await ctx.ui.confirm("Open central inventory?", "This dashboard URL grants read access to all accessible central investigations and their reports, across projects. The selected investigation opens first; Investigations shows the full inventory. It also enables steering for work owned by this Pi session and closing/hiding the research UI. A follow-up click authorizes the model-cost ceiling displayed on its button. Private-context permissions must be renewed separately in Pi. Access ends when the dashboard or Pi session closes. Opening alone starts no workers or model costs.", { signal: controller.signal })) return;
        controller.signal.throwIfAborted();
        inventoryDashboard ??= await startInventory(dataRoot(), undefined, dashboardControls(ctx));
        if (controller.signal.aborted) { await inventoryDashboard.close(); inventoryDashboard = undefined; return; }
        uiHidden = false;
        if (controller.active) inventoryDashboard.publish(controller.active.state, true);
        if (state) show(resolveState(ctx, state.tag), ctx);
        await open(state ? dashboardUrl(state.tag)! : inventoryDashboard.url, ctx);
      })();
    } else {
      const state = resolveState(ctx, tag);
      if (command === "status") {
        uiHidden = false;
        show(state, ctx);
        say(ctx, `${state.tag}: ${state.status}${state.reason ? ` — ${state.reason}` : ""}${state.recovery ? `\nRecovery: ${state.recovery}` : ""}\nSteering: ${feedbackSummary(state)}${state.feedback.length ? "\n" + state.feedback.map(f => `${f.id}. ${f.status}: ${f.text}`).join("\n") : ""}`);
        return;
      }
      if (command === "snapshot") { await open(pathToFileURL(new RunStore(dataRoot(), state.tag).snapshot()).href, ctx); return; }
      if (dashboardOpening) throw new Error("Dashboard is already opening");
      dashboardOpening = (async () => {
        controller.signal.throwIfAborted();
        if (!exportDashboard || exportTag !== state.tag) {
          await exportDashboard?.close();
          exportDashboard = await startDashboard(state, controller.active?.state.tag === state.tag, dataRoot());
          exportTag = state.tag;
        }
        if (controller.signal.aborted) { await exportDashboard.close(); exportDashboard = undefined; return; }
        show(state, ctx);
        await open(new URL("markdown", exportDashboard.url).href, ctx);
      })();
    }
    try { await dashboardOpening; } finally { dashboardOpening = undefined; }
  }

  async function steer(ctx: ExtensionContext, text: string, tag?: string, fromDashboard = false): Promise<void> {
    trusted(ctx);
    const feedback = feedbackTextSchema.parse(text);
    if (controller.preparing) throw new Error("Wait for research setup to finish");
    const selected = resolveState(ctx, tag);
    requireLightRun(selected);
    if (fromDashboard && selected.status !== "running" && selected.status !== "paused") throw new Error("Investigation changed. Refresh before steering.");
    if (selected.status === "done") {
      await reviseFromSteering(ctx, selected.tag, feedback);
      return;
    }
    if (controller.active) {
      if (controller.active.state.tag !== selected.tag) throw new Error("Another investigation is active. Feedback was not queued.");
      const note = controller.active.steer(feedback);
      say(ctx, `Feedback ${note.id} queued. Current workers are unchanged; all stages replan at the next boundary. Existing spend counts toward the ceiling.`);
      return;
    }
    const completedTag = await controller.exclusive(async signal => {
      const unlock = await lockDataRoot(dataRoot());
      try {
        signal.throwIfAborted();
        const store = new RunStore(dataRoot(), selected.tag);
        const state = store.load();
        requireLightRun(state);
        if (fromDashboard && (state.status !== "paused" || !sessionRuns.has(state.tag))) throw new Error("This Pi session no longer owns paused steering for this investigation.");
        if (state.status === "done") return state.tag;
        if (state.status === "running") throw new Error("Resume the interrupted run explicitly before steering it");
        requireLocation(state, dataRoot());
        const note = queueFeedback(state, feedback);
        store.save(state); show(state, ctx);
        say(ctx, `Feedback ${note.id} queued for ${state.tag}. /turing resume applies it and replans; no workers started.`);
      } finally { await unlock(); }
    });
    if (completedTag) await reviseFromSteering(ctx, completedTag, feedback);
  }

  async function reviseFromSteering(ctx: ExtensionContext, tag: string, feedback: string): Promise<void> {
    say(ctx, `Run ${tag} is already complete; this feedback was not queued. A revision preserves the original report and starts a new paid run with a fresh cost ceiling.\n/turing revise ${tag} ${feedback}`);
    if (!ctx.hasUI) return; // Never silently turn non-interactive steering into new paid work.
    // A runner can publish "done" before the controller has released its locks.
    await controller.waitForCompletion();
    await launchCommand(ctx, { kind: "revise", tag, feedback });
  }

  async function changeContext(ctx: ExtensionContext, tag?: string): Promise<void> {
    trusted(ctx);
    await controller.exclusive(async signal => {
      const selected = new RunStore(dataRoot(), resolveState(ctx, tag).tag).load();
      requireLightRun(selected);
      const location = requireLocation(selected, dataRoot());
      if (!ctx.hasUI) throw new Error("Context changes require interactive approval");
      if (selected.inputs) {
        if (!await ctx.ui.confirm("Revoke this run's context approval?", "Saved snapshots remain, but further model use and exports are refused. To reuse current snapshots, revise with explicit reapproval before revoking. Changed files require a new run and fresh preview.", { signal })) return;
        const unlock = await lockDataRoot(dataRoot());
        try {
          signal.throwIfAborted();
          const current = new RunStore(dataRoot(), selected.tag).load();
          if (JSON.stringify(current) !== JSON.stringify(selected)) throw new Error("Run changed while awaiting revocation approval");
          revokeContext(location.workspacePath, selected.inputs);
          say(ctx, "Context approval revoked; snapshots preserved.");
        } finally { await unlock(); }
        return;
      }
      if (!["paused", "failed", "blocked"].includes(selected.status)) throw new Error("Attach context to a paused run, or create an explicitly approved revision");
      const request = await contextRequest(ctx, location.projectPath, { instructions: "", files: [] }, signal);
      if (!request) { say(ctx, "Context selection cancelled; run unchanged."); return; }
      if (!request.instructions && !request.files.length && !request.capabilities?.length) { say(ctx, "No context selected; run unchanged."); return; }
      const preview = previewContext(location.projectPath, request);
      say(ctx, "Context proposal pending approval; no steering or model work has started.");
      const permissions = await contextPermissions(ctx, JSON.stringify(preview, null, 2), signal);
      if (!permissions) { say(ctx, "Context disclosure was not approved; run unchanged."); return; }
      const unlock = await lockDataRoot(dataRoot());
      try {
        signal.throwIfAborted();
        const store = new RunStore(dataRoot(), selected.tag);
        const state = store.load();
        if (JSON.stringify(state) !== JSON.stringify(selected)) throw new Error("Run changed while awaiting context approval");
        const inputs = approveContext(location.workspacePath, preview, permissions);
        state.inputs = inputs;
        state.location!.contextRefs = inputs.files.map(file => file.id);
        state.location!.approvalRefs = [inputs.grant.id];
        queueFeedback(state, "Use the newly approved additional sources and instructions within their disclosure permissions.");
        store.save(state); show(state, ctx);
        say(ctx, "Context approved and steering queued. Resume explicitly to apply it at the next stage boundary.");
      } finally { await unlock(); }
    });
  }

  async function migrate(ctx: ExtensionContext, args: string[]): Promise<void> {
    trusted(ctx);
    await controller.exclusive(async signal => {
      if (args[0] === "rollback" && args.length === 2) {
        if (ctx.hasUI && !await ctx.ui.confirm("Roll back migration?", "Remove unchanged migrated copies only; preserve originals. Changed destinations are refused.", { signal })) return;
        signal.throwIfAborted();
        await rollbackMigration(dataRoot(), args[1]);
        return;
      }
      const argument = args.join(" ");
      if (argument && argument !== "apply") throw new Error("Usage: migrate [apply] or migrate rollback <id>");
      const preview = previewMigration(ctx.cwd, dataRoot());
      say(ctx, JSON.stringify(preview, null, 2));
      if (argument !== "apply") { say(ctx, "Preview only. Use /turing migrate apply to copy and validate; originals remain."); return; }
      if (ctx.hasUI && !await ctx.ui.confirm("Copy legacy runs?", "Copy and validate the previewed workspace and runs. Stop upstream CLI writers first. Originals remain; no workers or network calls start.", { signal })) return;
      signal.throwIfAborted();
      const id = await migrateLegacy(preview, { signal });
      say(ctx, `Migration complete: ${id}. Originals preserved.`);
    });
  }

  async function browse(ctx: ExtensionContext, listOnly: boolean): Promise<void> {
    trusted(ctx);
    const rows = pickerRows(inventory(dataRoot()), controller.active?.state.tag);
    if (listOnly || !ctx.hasUI) {
      say(ctx, rows.length ? rows.map(row => `${row.id}: ${row.title} · ${row.description}`).join("\n") : "No saved runs. Use /turing start <question>.");
      return;
    }
    const signal = controller.signal;
    const choice = ctx.mode === "tui"
      ? await ctx.ui.custom<string | null>((tui, theme, keys, done) => new RunPicker(rows, theme, keys, done, () => tui.requestRender(), Math.max(2, Math.min(8, tui.terminal.rows - 13))))
      : await ctx.ui.select("Saved investigations (opening starts no research)", ["New research", ...rows.map(row => `${row.id} · ${row.title} · ${row.description}`)], { signal }).then(value => value === "New research" ? "_new" : rows.find(row => value?.startsWith(`${row.id} · `))?.id);
    signal.throwIfAborted();
    if (!choice) return;
    if (choice === "_new") {
      const question = await ctx.ui.input("Research question", undefined, { signal });
      if (question?.trim()) await launchCommand(ctx, { kind: "start", query: question.trim() });
      return;
    }
    const state = new RunStore(dataRoot(), choice).load();
    let workspaceAvailable = true;
    try { requireLocation(state, dataRoot()); } catch (error) { workspaceAvailable = false; say(ctx, message(error)); }
    const ownership = controller.active?.state.tag === state.tag ? "session" : await writerLocked(dataRoot()) ? "external" : "saved";
    if (ownership === "external") say(ctx, "A writer owns this data root. Only read-only actions are available.");
    const action = await ctx.ui.select(cleanTerminal(`${state.query}\n${state.tag} · ${state.status} · ${state.location?.projectPath ?? "Legacy"}`), runActions(state, ownership, workspaceAvailable), { signal });
    signal.throwIfAborted();
    if (action === "View") await view(ctx, "dashboard", state.tag);
    else if (action === "Export Markdown") await view(ctx, "export", state.tag);
    else if (action === "Save report…") await saveReport(ctx, state);
    else if (action === "Resume") await launchCommand(ctx, { kind: "resume", tag: state.tag });
    else if (action === "Revise" || action === "Steer") {
      const feedback = await ctx.ui.input(action === "Revise" ? "Revision instructions (parent report preserved)" : "Steering (queued at next safe boundary)", undefined, { signal });
      if (feedback?.trim()) {
        if (action === "Revise") await launchCommand(ctx, { kind: "revise", tag: state.tag, feedback });
        else await steer(ctx, feedback);
      }
    } else if (action === "Pause" || action === "Cancel") await controller.stop(action === "Pause" ? "paused" : "aborted");
  }

  const command: Parameters<ExtensionAPI["registerCommand"]>[1] = {
    description: "Research with a persistent vault and live/offline HTML dashboard",
    getArgumentCompletions: prefix => ["close", "help"]
      .filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: async (args, ctx) => {
      try {
        const input = args.trim();
        const [command, ...rest] = input.split(/\s+/);
        const argument = rest.join(" ");
        if (command === "help") { say(ctx, argument === "advanced" ? advancedHelp : help); return; }
        if (!input) { await view(ctx, "dashboard"); return; }
        if (command === "close") {
          if (argument && argument !== "hide" && argument !== "pause") throw new Error("Usage: /turing close [hide|pause]");
          await closeUI(ctx, argument as "hide" | "pause" || undefined); return;
        }
        if (command === "browse" || command === "list") { await browse(ctx, command === "list"); return; }
        if (command === "save") {
          trusted(ctx);
          const match = /^save\s+(?:(--overwrite)\s+)?(\S+)\s+([\s\S]+)$/.exec(input);
          if (!match) throw new Error("Usage: save [--overwrite] <tag> <literal path.md>");
          await saveReport(ctx, resolveState(ctx, match[2]), match[3], !!match[1]);
          return;
        }
        if (command === "migrate") { await migrate(ctx, rest); return; }
        // Retain the harmless installer-era hint for existing users.
        if (command === "setup") { say(ctx, "No setup needed. Turing runs on Node.js; start with /turing <question>."); return; }
        if (command === "context") { await changeContext(ctx, argument || undefined); return; }
        if (command === "steer") { await steer(ctx, argument); return; }
        if (command === "pause" || command === "cancel") {
          if (!controller.active) { say(ctx, "No active run"); return; }
          await controller.stop(command === "pause" ? "paused" : "aborted");
          return;
        }
        if (command === "status" || command === "dashboard" || command === "snapshot" || command === "export") {
          await view(ctx, command, argument || undefined);
          return;
        }
        if (command === "revise") {
          const [tag, ...feedback] = rest;
          if (!tag || !feedback.length) throw new Error("Usage: /turing revise <tag> <feedback>");
          await launchCommand(ctx, { kind: "revise", tag, feedback: feedbackTextSchema.parse(feedback.join(" ")) });
        } else if (command === "resume") {
          trusted(ctx);
          const options = parseResumeOptions(rest);
          await launchCommand(ctx, { kind: "resume", ...options, tag: options.tag ?? resolveState(ctx).tag });
        } else await launchCommand(ctx, { kind: "start", query: command === "start" ? input.slice(6).trim() : input });
      } catch (error) { say(ctx, `Turing: ${message(error)}`, "error"); }
    },
  };
  pi.registerCommand("turing", command);
  pi.registerCommand("hyperresearch", { ...command, description: "Legacy alias for /turing" });
  pi.registerTool({
    name: "turing_run", label: "Turing",
    description: "Run light research and wait for its report or explicit failure. Structural/quote checks are not factual verification. Only use when the user explicitly requests research with Turing. May take 30+ minutes and incur model/search costs; default model estimate ceiling ~$15. No separate backend setup required.",
    parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 30_000 }) }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const started = await launch(ctx, { kind: "start", query: params.query }, signal);
      if (!started) throw new Error("Research did not complete");
      await started.done;
      const { runner } = started;
      const state = runner.state;
      if (state.status !== "done") throw new Error(state.reason ?? "Research did not complete");
      return { content: [{ type: "text", text: state.inputs ? `${state.profile} research completed with approved private/scoped context. View it with /turing dashboard ${state.tag}. Do not read its checkpoint or report into this chat without explicit disclosure approval for the current chat model.` : `${state.profile} research completed its required gates (not proof of truth). Report: ${runner.store.reportPath}\nOffline snapshot: /turing snapshot ${state.tag}` }], details: { tag: state.tag, cost: state.cost, tokens: state.tokens } };
    },
  });
  pi.on("before_agent_start", (event, ctx) => {
    const state = controller.active?.state ?? latest;
    if (uiHidden || !state || !ctx.isProjectTrusted()) return;
    return {
      systemPrompt: event.systemPrompt + "\nTuring workers are isolated from this chat. Ordinary prompts do not steer them. " +
        (state.inputs ? "Contextual research was approved for its saved research models, not automatic disclosure to this chat. Answer progress questions from the status fields below; obtain explicit user approval before reading its checkpoint, report or snapshots into the current chat model. " : "For progress questions, read the checkpoint or report as needed. ") +
        "Do not edit host-owned research state or claim feedback was applied through chat. " +
        "Direct the user to /turing steer <feedback> or /turing revise <tag> <feedback> for changes.",
      message: { customType: "hyperresearch-context", display: false, content: JSON.stringify({
        tag: state.tag, status: state.status, liveInThisSession: !!controller.active, activity: state.activity,
        steering: feedbackSummary(state),
        ...(state.inputs ? { contextual: true } : { checkpoint: join(new RunStore(dataRoot(), state.tag).dir, "pi-state.json"), report: new RunStore(dataRoot(), state.tag).reportPath }),
      }) },
    };
  });
  pi.on("session_start", (_event, ctx) => {
    controller = new RunController(error => say(ctx, `Runner lock lost: ${message(error)}`, "error"));
    // Explicit commands/tool use select runs; startup never scans saved state.
    latest = undefined; uiHidden = false; closingFromDashboard = false; sessionRuns.clear();
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    uiHidden = true; latest = undefined;
    disposeWidget();
    await controller.shutdown();
    await dashboardOpening?.catch(() => {});
    await exportDashboard?.close(); exportDashboard = undefined; exportTag = undefined;
    await inventoryDashboard?.close(); inventoryDashboard = undefined;
    disposeWidget();
    if (ctx.hasUI) ctx.ui.setWidget("turing", undefined);
  });
}

import { join } from "node:path";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { availableReaderIds } from "../src/capabilities.ts";
import { approveContext, previewContext, reapproveContext, revokeContext, validateContext, type ContextPreview } from "../src/context.ts";
import type { ContextRequest, Disclosure } from "../src/context-types.ts";
import { PythonBackend, setupBackend } from "../src/backend.ts";
import { ResearchServices } from "../src/services.ts";
import { execute } from "../src/process.ts";
import { ResearchRunner } from "../src/runner.ts";
import { startDashboard, startInventory } from "../src/server.ts";
import { ensureSearchConfigured } from "../src/search.ts";
import { queueFeedback, feedbackSummary } from "../src/feedback.ts";
import { progressLines } from "../src/progress.ts";
import { ResearchWidget } from "../src/widget.ts";
import { inventory, listRuns, loadConfig, RunStore } from "../src/store.ts";
import { createLocation, dataRoot, requireLocation } from "../src/paths.ts";
import { lockDataRoot, lockWorkspace, writerLocked } from "../src/locks.ts";
import { migrateLegacy, previewMigration, rollbackMigration } from "../src/migration.ts";
import { pickerRows, RunPicker, runActions } from "../src/picker.ts";
import { portableMarkdown, prepareSave, saveMarkdown } from "../src/export.ts";
import { cleanTerminal, configSchema, feedbackTextSchema, message, type RunState } from "../src/types.ts";
import { PiWorkerDriver } from "../src/worker.ts";

const help = `Hyperresearch — light pipeline (experimental)
/hyperresearch                  Browse saved investigations (no model work)
/hyperresearch list             List central runs without opening a picker
/hyperresearch start <question>  Start research using the selected Pi model
/hyperresearch status [tag]      Show persisted progress
/hyperresearch steer <feedback>  Queue feedback; replan at next stage boundary
/hyperresearch context [tag]     Approve local context for a paused run (or revoke)
/hyperresearch revise <tag> <feedback>  New revision of a completed report
/hyperresearch pause             Interrupt safely; keep artifacts
/hyperresearch resume [tag]      Resume with saved context/configuration
  Add --use-project-config to explicitly propose current project preferences
/hyperresearch cancel            Abort; keep artifacts
/hyperresearch dashboard [tag]   Open a run-scoped localhost dashboard
/hyperresearch dashboard all     Open central inventory (broader read access)
/hyperresearch snapshot [tag]    Generate/open standalone HTML
/hyperresearch export [tag]      Browser-managed Markdown download
/hyperresearch save [--overwrite] <tag> <path.md>  Save a portable report
/hyperresearch setup             Install the pinned backend with uv
/hyperresearch migrate [apply]   Preview/copy this checkout's legacy runs
/hyperresearch migrate rollback <id>  Roll back an unchanged migration

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
  let inventoryDashboard: Awaited<ReturnType<typeof startInventory>> | undefined;
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
    inventoryDashboard?.publish(state, live);
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
    const state = tag ? new RunStore(dataRoot(), tag).load() : active?.state ?? latest ?? listRuns(dataRoot()).find(s => s.location?.projectPath === realpathSync(ctx.cwd));
    if (!state) throw new Error("No selected Hyperresearch run. Supply a central run ID.");
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
  const saveReport = async (ctx: ExtensionContext, state: RunState, path?: string, overwrite = false) => {
    const input = path ?? (ctx.hasUI ? await ctx.ui.input("Save report to .md path", join(ctx.cwd, `${state.tag}.md`)) : undefined);
    if (!input) return;
    const markdown = portableMarkdown(state);
    const target = prepareSave(ctx.cwd, input, dataRoot());
    const approved = target.existingHash ? (ctx.hasUI ? await ctx.ui.confirm("Overwrite exported report?", `${target.path}\nThis replaces your existing copy. The preserved run is unchanged.`) : overwrite) : false;
    if (target.existingHash && !approved) { say(ctx, "Save cancelled: overwrite not approved. Non-interactive saves require --overwrite."); return; }
    saveMarkdown(target, markdown, approved);
    say(ctx, `Report saved: ${target.path}. This is a copy; verification status is included.`);
  };
  async function contextRequest(ctx: ExtensionContext, project: string, initial: ContextRequest): Promise<ContextRequest | undefined> {
    if (!ctx.hasUI) return initial;
    const instructions = await ctx.ui.input("Additional sources & instructions (optional; no tools are granted by this text)", initial.instructions);
    if (instructions === undefined) return;
    const files = [...initial.files];
    while (files.length < 8 && await ctx.ui.confirm(files.length ? "Add another local context file?" : "Attach a local context file?", `Optional. Originating project: ${project}\nExisting selections: ${files.map(file => `${file.path} (${file.purpose})`).join(", ") || "none"}\nOnly selected text files are snapshotted; no directory scans or ambient project instructions.`)) {
      const path = await ctx.ui.input(`File path within ${project}`); if (!path) return;
      const purpose = await ctx.ui.select("How should this file be used?", ["Background (not citable)", "Local evidence (not independent external corroboration)"]);
      if (!purpose) return;
      files.push({ path, purpose: purpose.startsWith("Background") ? "background" : "evidence" });
    }
    const capabilities = [...(initial.capabilities ?? [])];
    const registered = availableReaderIds();
    while (capabilities.length < 8 && registered.some(id => !capabilities.includes(id)) && await ctx.ui.confirm("Add an additional scoped source?", `Registered read-only adapters: ${registered.join(", ")}\nSelected: ${capabilities.join(", ") || "none"}. Skills and integrations are never inherited from ambient Pi tools.`)) {
      const id = await ctx.ui.select("Select a scoped source for approval", registered.filter(id => !capabilities.includes(id))); if (!id) return;
      capabilities.push(id);
    }
    return { instructions, files, capabilities };
  }
  async function contextPermissions(ctx: ExtensionContext, summary: string): Promise<Disclosure | undefined> {
    if (!ctx.hasUI) throw new Error("Local context and additional instructions require interactive disclosure approval before model work");
    if (!await ctx.ui.confirm("Approve context for research models?", `${summary}\nThe selected research models will receive this context. Listed read-only integrations may receive research queries within their fixed scopes; their fees are separate from the model ceiling. Text is untrusted data; instructions cannot grant other tools. Nothing is sent if you decline.`)) return;
    const search = await ctx.ui.confirm("Allow context in public search/acquisition requests?", "Separate permission. If declined, private context is reserved for drafting; later public requests are disabled after it is used. Public research still runs first without these inputs.");
    const exportAllowed = await ctx.ui.confirm("Allow exporting reports derived from this context?", "Separate permission. This allows derived report copies, not source attachments. If declined, read-only viewing remains available but Markdown/HTML export and Save report are blocked after context use.");
    return { model: true, search, export: exportAllowed };
  }
  function launch(ctx: ExtensionContext, query?: string, resumeTag?: string, revision?: { tag: string; feedback: string }, useProjectConfig = false): Promise<void> {
    if (active || launching) return Promise.reject(new Error("A run is already active. Pause or cancel it first."));
    startup = launchInner(ctx, query, resumeTag, revision, useProjectConfig);
    return startup;
  }
  async function launchInner(ctx: ExtensionContext, query?: string, resumeTag?: string, revision?: { tag: string; feedback: string }, useProjectConfig = false): Promise<void> {
    trusted(ctx);
    if (active || launching) throw new Error("A run is already active. Pause or cancel it first.");
    launching = true;
    try {
      lifecycle.signal.throwIfAborted();
      const root = dataRoot();
      const selected = revision ? new RunStore(root, revision.tag).load() : query === undefined ? new RunStore(root, resolveState(ctx, resumeTag).tag).load() : undefined;
      if (!revision && selected && ["done", "aborted"].includes(selected.status)) throw new Error(`Cannot resume a ${selected.status} run`);
      const location = selected ? requireLocation(selected, root) : createLocation(ctx.cwd, root);
      const config = selected && !useProjectConfig ? configSchema.parse(selected.config) : loadConfig(ctx.cwd);
      if (selected?.inputs) validateContext(location.workspacePath, selected.inputs);
      let preview: ContextPreview | undefined; let permissions: Disclosure | undefined;
      if (!selected) {
        const requested = await contextRequest(ctx, location.projectPath, { instructions: config.additionalInstructions, files: config.contextFiles, capabilities: config.capabilities });
        if (!requested) return;
        config.additionalInstructions = requested.instructions; config.contextFiles = requested.files; config.capabilities = requested.capabilities ?? [];
        if (requested.instructions || requested.files.length || requested.capabilities?.length) {
          preview = previewContext(location.projectPath, requested);
          permissions = await contextPermissions(ctx, JSON.stringify(preview, null, 2)); if (!permissions) return;
        }
      } else if (revision && selected.inputs) {
        permissions = await contextPermissions(ctx, `Revision reuses these pinned snapshots and the previous report, not current project files:\n${JSON.stringify(selected.inputs, null, 2)}`);
        if (!permissions) return;
      }
      if (ctx.hasUI && !await ctx.ui.confirm(selected ? (revision ? "Create revision?" : "Resume paid research?") : "Start research?",
        `Project: ${location.projectPath}\nWorkspace: ${location.workspacePath}\nModel: ${selected?.model ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "not selected")}\nRole model overrides: ${JSON.stringify(config.models)}\nSearch: ${config.searchProvider}\nScholarly: ${config.scholarlyProviders.join(", ") || "disabled"}\nFull-text resolvers: ${config.fullTextResolvers.join(", ") || "disabled"} (Unpaywall needs HYPERRESEARCH_CONTACT_EMAIL; CORE needs CORE_API_KEY)\nModel ceiling: ${config.budgetUsd === null ? "unlimited" : `$${config.budgetUsd}`} (search fees separate).\n${selected ? (useProjectConfig ? `Proposed configuration replacement from ${ctx.cwd}:\n${JSON.stringify(config, null, 2)}\nPrevious: ${JSON.stringify(selected.config)}\nSaved context and default model remain unchanged.` : "Uses saved configuration and context, not this project's files.") : preview ? "Only the separately approved context will be attached; no ambient integrations are loaded." : "No local files or integrations attached."}${selected?.inputs ? `\nSaved context grant: ${selected.inputs.grant.id}; model/search/export permissions remain scoped to this run.` : ""}`)) return;
      const lost = (error: Error) => { lifecycle.abort(); active?.stop("paused"); say(ctx, `Runner lock lost: ${message(error)}`); };
      const unlockRoot = await lockDataRoot(root, lost);
      release = unlockRoot;
      const unlockWorkspace = await lockWorkspace(location.workspacePath, lost);
      release = async () => { try { await unlockWorkspace(); } finally { await unlockRoot(); } };
      // Re-read under lock; a saved selection is not runner ownership.
      if (selected) {
        const current = new RunStore(root, selected.tag).load();
        if (JSON.stringify(current) !== JSON.stringify(selected)) throw new Error("Run changed while awaiting approval. Select it again.");
      }
      ensureSearchConfigured(config.searchProvider);
      const inputs = preview ? approveContext(location.workspacePath, preview, permissions!) : revision && selected?.inputs ? reapproveContext(location.workspacePath, selected.inputs, permissions!) : selected?.inputs;
      const backend = new ResearchServices(new PythonBackend(location.workspacePath));
      const driver = await PiWorkerDriver.create(ctx, location.workspacePath);
      lifecycle.signal.throwIfAborted();
      if (query !== undefined || revision) {
        if (!selected && !ctx.model) throw new Error("Select an authenticated model first");
        active = revision
          ? await ResearchRunner.revise(location.projectPath, selected!, revision.feedback, config,
            selected!.model, selected!.thinking, backend, driver, state => show(state, ctx), inputs)
          : await ResearchRunner.create(location.projectPath, query!, config, `${ctx.model!.provider}/${ctx.model!.id}`, ctx.thinkingLevel ?? "medium",
            backend, driver, state => show(state, ctx), undefined, location, inputs);
      } else {
        const state = new RunStore(root, selected!.tag).load();
        state.config = config; // Only an explicit --use-project-config proposes replacements.
        active = new ResearchRunner(location.projectPath, state, backend, driver, current => show(current, ctx));
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
    getArgumentCompletions: prefix => ["start", "status", "steer", "revise", "pause", "resume", "cancel", "dashboard", "snapshot", "setup", "migrate", "list", "export", "save", "context", "help"]
      .filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: async function handleCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
      try {
        const input = args.trim();
        const [command, ...rest] = input.split(/\s+/);
        const argument = rest.join(" ");
        if (command === "help") { say(ctx, help); return; }
        if (!input || command === "list") {
          trusted(ctx);
          const entries = inventory(dataRoot());
          const rows = pickerRows(entries, active?.state.tag);
          if (command === "list" || !ctx.hasUI) {
            say(ctx, rows.length ? rows.map(row => `${row.id}: ${row.title} · ${row.description}`).join("\n") : "No saved runs. Use /hyperresearch start <question>.");
            return;
          }
          const choice = ctx.mode === "tui"
            ? await ctx.ui.custom<string | null>((tui, theme, keys, done) => new RunPicker(rows, theme, keys, done, () => tui.requestRender(), Math.max(2, Math.min(8, tui.terminal.rows - 13))))
            : await ctx.ui.select("Saved investigations (opening starts no research)", ["New research", ...rows.map(row => `${row.id} · ${row.title} · ${row.description}`)]).then(value => value === "New research" ? "_new" : rows.find(row => value?.startsWith(`${row.id} · `))?.id);
          if (!choice) return;
          if (choice === "_new") {
            const question = await ctx.ui.input("Research question");
            if (question?.trim()) await launch(ctx, question.trim());
            return;
          }
          const state = new RunStore(dataRoot(), choice).load();
          let workspaceAvailable = true;
          try { requireLocation(state, dataRoot()); } catch (error) { workspaceAvailable = false; say(ctx, message(error)); }
          const ownership = active?.state.tag === state.tag ? "session" : await writerLocked(dataRoot()) ? "external" : "saved";
          if (ownership === "external") say(ctx, "A writer owns this data root. Only read-only actions are available.");
          const action = await ctx.ui.select(cleanTerminal(`${state.query}\n${state.tag} · ${state.status} · ${state.location?.projectPath ?? "Legacy"}`), runActions(state, ownership, workspaceAvailable));
          if (!action) return;
          if (action === "View") await handleCommand(`dashboard ${state.tag}`, ctx);
          else if (action === "Export Markdown") await handleCommand(`export ${state.tag}`, ctx);
          else if (action === "Save report…") await saveReport(ctx, state);
          else if (action === "Resume") await launch(ctx, undefined, state.tag);
          else if (action === "Revise") {
            const feedback = await ctx.ui.input("Revision instructions (parent report preserved)");
            if (feedback?.trim()) await launch(ctx, undefined, undefined, { tag: state.tag, feedback });
          } else if (action === "Steer") {
            const feedback = await ctx.ui.input("Steering (queued at next safe boundary)");
            if (feedback?.trim()) await handleCommand(`steer ${feedback}`, ctx);
          } else await handleCommand(action.toLowerCase(), ctx);
          return;
        }
        if (command === "save") {
          trusted(ctx);
          const match = /^save\s+(?:(--overwrite)\s+)?(\S+)\s+([\s\S]+)$/.exec(input);
          if (!match) throw new Error("Usage: save [--overwrite] <tag> <literal path.md>");
          await saveReport(ctx, resolveState(ctx, match[2]), match[3], !!match[1]); return;
        }
        if (command === "migrate") {
          trusted(ctx);
          if (active || launching) throw new Error("Stop research before migration");
          if (rest[0] === "rollback" && rest.length === 2) {
            if (ctx.hasUI && !await ctx.ui.confirm("Roll back migration?", "Remove unchanged migrated copies only; preserve originals. Changed destinations are refused.")) return;
            launching = true;
            startup = rollbackMigration(dataRoot(), rest[1]);
          } else {
            if (argument && argument !== "apply") throw new Error("Usage: migrate [apply] or migrate rollback <id>");
            const preview = previewMigration(ctx.cwd, dataRoot());
            say(ctx, JSON.stringify(preview, null, 2));
            if (argument !== "apply") { say(ctx, "Preview only. Use /hyperresearch migrate apply to copy and validate; originals remain."); return; }
            if (ctx.hasUI && !await ctx.ui.confirm("Copy legacy runs?", "Copy and validate the previewed workspace and runs. Stop upstream CLI writers first. Originals remain; no workers or network calls start.")) return;
            launching = true;
            startup = migrateLegacy(preview, { signal: lifecycle.signal }).then(id => { say(ctx, `Migration complete: ${id}. Originals preserved.`); });
          }
          try { await startup; } finally { launching = false; }
          return;
        }
        if (command === "setup") {
          trusted(ctx);
          if (active || launching) throw new Error("Stop the run before updating the backend");
          if (ctx.hasUI && !await ctx.ui.confirm("Install research backend?", "uv will install the pinned Hyperresearch Python package and dependencies. No Claude files or browser profiles will be installed.")) return;
          launching = true;
          try { await setupBackend(ctx.cwd, lifecycle.signal); }
          finally { launching = false; }
          say(ctx, "Backend installed. Start with /hyperresearch <question>."); return;
        }
        if (command === "context") {
          trusted(ctx);
          if (active || launching) throw new Error("Pause research before changing context approvals");
          const selected = new RunStore(dataRoot(), resolveState(ctx, argument || undefined).tag).load(); const location = requireLocation(selected, dataRoot());
          if (!ctx.hasUI) throw new Error("Context changes require interactive approval");
          if (selected.inputs) {
            if (await ctx.ui.confirm("Revoke this run's context approval?", "Saved snapshots remain, but further model use and exports are refused. To reuse current snapshots, revise with explicit reapproval before revoking. Changed files require a new run and fresh preview.")) {
              const unlock = await lockDataRoot(dataRoot());
              try {
                const current = new RunStore(dataRoot(), selected.tag).load();
                if (JSON.stringify(current) !== JSON.stringify(selected)) throw new Error("Run changed while awaiting revocation approval");
                revokeContext(location.workspacePath, selected.inputs); say(ctx, "Context approval revoked; snapshots preserved.");
              } finally { await unlock(); }
            }
            return;
          }
          if (!["paused", "failed", "blocked"].includes(selected.status)) throw new Error("Attach context to a paused run, or create an explicitly approved revision");
          const request = await contextRequest(ctx, location.projectPath, { instructions: "", files: [] }); if (!request || (!request.instructions && !request.files.length && !request.capabilities?.length)) return;
          const preview = previewContext(location.projectPath, request);
          say(ctx, "Context proposal pending approval; no steering or model work has started.");
          const permissions = await contextPermissions(ctx, JSON.stringify(preview, null, 2)); if (!permissions) return;
          const unlock = await lockDataRoot(dataRoot());
          try {
            const store = new RunStore(dataRoot(), selected.tag); const state = store.load();
            if (JSON.stringify(state) !== JSON.stringify(selected)) throw new Error("Run changed while awaiting context approval");
            const inputs = approveContext(location.workspacePath, preview, permissions);
            state.inputs = inputs; state.location!.contextRefs = inputs.files.map(file => file.id); state.location!.approvalRefs = [inputs.grant.id];
            queueFeedback(state, "Use the newly approved additional sources and instructions within their disclosure permissions.");
            store.save(state); show(state, ctx); say(ctx, "Context approved and steering queued. Resume explicitly to apply it at the next stage boundary.");
          } finally { await unlock(); }
          return;
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
              const unlock = await lockDataRoot(dataRoot());
              try {
                lifecycle.signal.throwIfAborted();
                const selected = resolveState(ctx);
                const store = new RunStore(dataRoot(), selected.tag);
                const state = store.load(); // Re-read under lock, not a cached view.
                if (state.status === "running") throw new Error("Resume the interrupted run explicitly before steering it");
                requireLocation(state, dataRoot());
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
        if (["status", "dashboard", "snapshot", "export"].includes(command)) {
          trusted(ctx);
          if (command === "dashboard" && argument === "all") {
            if (dashboardOpening) throw new Error("Dashboard is already opening");
            if (!inventoryDashboard && ctx.hasUI && !await ctx.ui.confirm("Open central inventory?", "This new token grants read access to all accessible central investigations and their reports, across projects. Existing single-run tokens stay scoped to one run. No workers or model costs.")) return;
            dashboardOpening = (async () => {
              inventoryDashboard ??= await startInventory(dataRoot());
              if (lifecycle.signal.aborted) { await inventoryDashboard.close(); inventoryDashboard = undefined; return; }
              if (active) inventoryDashboard.publish(active.state, true);
              await open(inventoryDashboard.url, ctx);
            })();
            try { await dashboardOpening; } finally { dashboardOpening = undefined; }
            return;
          }
          const state = resolveState(ctx, argument || undefined);
          if (command === "status") { show(state, ctx); say(ctx, `${state.tag}: ${state.status}${state.reason ? ` — ${state.reason}` : ""}\nSteering: ${feedbackSummary(state)}${state.feedback.length ? "\n" + state.feedback.map(f => `${f.id}. ${f.status}: ${f.text}`).join("\n") : ""}`); return; }
          if (command === "snapshot") { await open(pathToFileURL(new RunStore(dataRoot(), state.tag).snapshot()).href, ctx); return; }
          if (dashboardOpening) throw new Error("Dashboard is already opening");
          dashboardOpening = (async () => {
            lifecycle.signal.throwIfAborted();
            if (!dashboard || dashboardTag !== state.tag) {
              await dashboard?.close(); dashboard = await startDashboard(state, active?.state.tag === state.tag, dataRoot()); dashboardTag = state.tag;
            }
            if (lifecycle.signal.aborted) { await dashboard.close(); dashboard = undefined; return; }
            show(state, ctx); await open(command === "export" ? new URL("markdown", dashboard.url).href : dashboard.url, ctx);
          })();
          try { await dashboardOpening; } finally { dashboardOpening = undefined; }
          return;
        }
        if (command === "revise") {
          const [tag, ...feedback] = rest;
          if (!tag || !feedback.length) throw new Error("Usage: /hyperresearch revise <tag> <feedback>");
          await launch(ctx, undefined, undefined, { tag, feedback: feedbackTextSchema.parse(feedback.join(" ")) });
        } else if (command === "resume") {
          const tags = rest.filter(value => value !== "--use-project-config");
          if (tags.length > 1 || tags[0]?.startsWith("--")) throw new Error("Usage: resume [tag] [--use-project-config]");
          await launch(ctx, undefined, tags[0], undefined, rest.includes("--use-project-config"));
        }
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
        return { content: [{ type: "text", text: state.inputs ? `Light research completed with approved private/scoped context. View it with /hyperresearch dashboard ${state.tag}. Do not read its checkpoint or report into this chat without explicit disclosure approval for the current chat model.` : `Light research verified. Report: ${runner!.store.reportPath}\nOffline snapshot: /hyperresearch snapshot ${state.tag}` }], details: { tag: state.tag, cost: state.cost, tokens: state.tokens } };
      } finally { signal?.removeEventListener("abort", abort); }
    },
  });
  pi.on("before_agent_start", (event, ctx) => {
    const state = active?.state ?? latest;
    if (!state || !ctx.isProjectTrusted()) return;
    return {
      systemPrompt: event.systemPrompt + "\nHyperresearch workers are isolated from this chat. Ordinary prompts do not steer them. " +
        (state.inputs ? "Contextual research was approved for its saved research models, not automatic disclosure to this chat. Answer progress questions from the status fields below; obtain explicit user approval before reading its checkpoint, report or snapshots into the current chat model. " : "For progress questions, read the checkpoint or report as needed. ") +
        "Do not edit host-owned research state or claim feedback was applied through chat. " +
        "Direct the user to /hyperresearch steer <feedback> or /hyperresearch revise <tag> <feedback> for changes.",
      message: { customType: "hyperresearch-context", display: false, content: JSON.stringify({
        tag: state.tag, status: state.status, liveInThisSession: !!active, activity: state.activity,
        steering: feedbackSummary(state),
        ...(state.inputs ? { contextual: true } : { checkpoint: join(new RunStore(dataRoot(), state.tag).dir, "pi-state.json"), report: new RunStore(dataRoot(), state.tag).reportPath }),
      }) },
    };
  });
  pi.on("session_start", (_event, ctx) => {
    lifecycle = new AbortController();
    if (ctx.isProjectTrusted()) {
      // Do not inject an unrelated project's latest investigation into chat.
      latest = listRuns(dataRoot()).find(state => state.location?.projectPath === realpathSync(ctx.cwd));
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
    await inventoryDashboard?.close(); inventoryDashboard = undefined;
    disposeWidget();
    if (ctx.hasUI) ctx.ui.setWidget("hyperresearch", undefined);
  });
}

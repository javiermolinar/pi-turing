import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { revisionSpendingOffer } from "../src/revision-approval.ts";
import { approveContext, previewContext } from "../src/context.ts";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lockDataRoot } from "../src/locks.ts";
import { createLocation, privateDirectory } from "../src/paths.ts";
import extension from "../extensions/index.ts";
import previewWidget from "../scripts/preview-widget.ts";
import { RunStore } from "../src/store.ts";
import { fixture } from "./fixtures.ts";
import { ResearchRunner } from "../src/runner.ts";
import { PiWorkerDriver } from "../src/worker.ts";

export function harness(cwd: string, factory = extension) {
  process.env.TURING_DATA_ROOT = cwd;
  const commands = new Map<string, any>(); const tools = new Map<string, any>(); const events = new Map<string, any>(); const notices: string[] = []; const noticeLevels: string[] = [];
  const ctx: any = { cwd, mode: "rpc", hasUI: true, isProjectTrusted: () => true,
    ui: { select: async () => undefined, confirm: async () => false, input: async () => undefined, notify: (text: string, level: string) => { notices.push(text); noticeLevels.push(level); }, setWidget: () => {}, setEditorText: () => { throw new Error("Must not replace user input"); } } };
  const pi: any = { registerCommand: (name: string, spec: any) => commands.set(name, spec), on: (name: string, handler: any) => events.set(name, handler),
    registerTool: (spec: any) => tools.set(spec.name, spec), appendEntry: () => {}, sendUserMessage: () => { throw new Error("Must not start model turns"); } };
  factory(pi);
  return { ctx, events, tools, notices, noticeLevels, commands, completions: (prefix = "") => commands.get("turing").getArgumentCompletions(prefix), command: (input: string) => commands.get("turing").handler(input, ctx) };
}

test("Turing exposes its new tool and retains the old command as an alias", async () => {
  const root = mkdtempSync(join(tmpdir(), "turing-command-")); const h = harness(root);
  try {
    assert.ok(h.commands.has("turing")); assert.ok(h.commands.has("hyperresearch"));
    assert.ok(h.tools.has("turing_run")); assert.equal(h.tools.has("hyperresearch_run"), false);
    await h.command("help");
    const help = h.notices.at(-1)!;
    assert.match(help, /Turing — research for the questions behind your code/);
    assert.match(help, /\/turing <question>/); assert.doesNotMatch(help, /\/hyperresearch/);
    await h.commands.get("hyperresearch").handler("help", h.ctx);
    assert.equal(h.notices.at(-1), help);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("legacy setup command is a no-op and no longer requests an install", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-native-setup-")); const h = harness(root);
  try {
    h.ctx.ui.confirm = async () => { throw new Error("No installer approval should be requested"); };
    await h.command("setup");
    assert.match(h.notices.at(-1)!, /No setup needed/);
    assert.equal(existsSync(join(root, "workspaces")), false);
    assert.equal(existsSync(join(root, "backend")), false);
    assert.ok(!h.tools.get("turing_run").description.includes("Requires /turing setup"));
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("startup and ordinary chat never load saved investigations or show Turing UI", async t => {
  const root = mkdtempSync(join(tmpdir(), "hpr-quiet-start-")); const h = harness(root);
  try {
    const state = fixture(); state.location = createLocation(root, root);
    const store = new RunStore(root, state.tag); store.save(state);
    let loads = 0, widgets = 0;
    t.mock.method(RunStore.prototype, "load", () => { loads++; throw new Error("Startup must not read checkpoints"); });
    h.ctx.ui.setWidget = () => { widgets++; };
    for (const trusted of [true, false]) {
      h.ctx.isProjectTrusted = () => trusted;
      for (const reason of ["startup", "reload", "new", "resume", "fork"]) {
        h.events.get("session_start")({ reason }, h.ctx);
        assert.equal(h.events.get("before_agent_start")({ systemPrompt: "base", prompt: "Unrelated coding question" }, h.ctx), undefined);
      }
    }
    assert.equal(loads, 0); assert.equal(widgets, 0); assert.deepEqual(h.notices, []);
    assert.ok(h.tools.has("turing_run"), "Explicit research remains available");
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});
test("explicit status selects a saved run, but session replacement does not restore it", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-explicit-selection-")); const h = harness(root);
  try {
    const state = fixture(); state.location = createLocation(root, root);
    const store = new RunStore(root, state.tag); store.save(state);
    const before = readFileSync(join(store.dir, "pi-state.json"));
    const widgets: unknown[] = []; h.ctx.ui.setWidget = (_key: string, value: unknown) => { widgets.push(value); };
    h.events.get("session_start")({ reason: "startup" }, h.ctx);
    assert.equal(widgets.length, 0);
    await h.command(`status ${state.tag}`);
    assert.equal(widgets.length, 1);
    const context = h.events.get("before_agent_start")({ systemPrompt: "base" }, h.ctx);
    assert.equal(JSON.parse(context.message.content).tag, state.tag);
    assert.equal(JSON.parse(context.message.content).liveInThisSession, false);
    await h.events.get("session_shutdown")({}, h.ctx);
    assert.equal(widgets.at(-1), undefined);
    const count = widgets.length;
    h.events.get("session_start")({ reason: "reload" }, h.ctx);
    assert.equal(widgets.length, count);
    assert.equal(h.events.get("before_agent_start")({ systemPrompt: "base" }, h.ctx), undefined);
    assert.deepEqual(readFileSync(join(store.dir, "pi-state.json")), before);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});
test("unconfigured research defaults to DuckDuckGo and warns about rate limits before cost approval", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-default-start-")); const h = harness(root);
  try {
    h.ctx.model = { provider: "test", id: "mock" };
    h.ctx.ui.input = async () => { throw new Error("Must not ask for optional instructions or file paths"); };
    h.ctx.ui.select = async () => { throw new Error("Must not ask for optional readers"); };
    const confirmations: string[] = [];
    h.ctx.ui.confirm = async (title: string, text: string) => {
      confirmations.push(title); assert.match(text, /Scope: light/); assert.match(text, /No local files or integrations attached/);
      assert.match(text, /Search: duckduckgo/); assert.match(text, /rate-limited or blocked/); return false;
    };
    await h.command("start A bounded research question");
    assert.deepEqual(confirmations, ["Start research?"]);
    assert.match(h.notices.at(-1)!, /cost confirmation was cancelled/);
    assert.equal(existsSync(join(root, "workspaces")), false); assert.equal(existsSync(join(root, "runs")), false);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});
for (const scope of ["full", "extended"] as const) test(`${scope} configuration fails before any approval or model setup`, async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-removed-config-")); const h = harness(root);
  try {
    privateDirectory(join(root, ".pi"));
    writeFileSync(join(root, ".pi", "hyperresearch.json"), JSON.stringify({ scope }));
    h.ctx.ui.confirm = async () => { throw new Error("No approval should be requested"); };
    await h.command("start A new question"); assert.match(h.notices.at(-1)!, /removed/);
    await assert.rejects(h.tools.get("turing_run").execute("fixture", { query: "A new question" }, new AbortController().signal, undefined, h.ctx), /removed/);
    assert.equal(existsSync(join(root, "workspaces")), false);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});
for (const scope of ["full", "extended"] as const) test(`${scope} commands refuse resumes, top-ups, revisions and context changes without touching saved artifacts`, async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-removed-run-")); const h = harness(root);
  try {
    const state = fixture(); state.profile = scope; state.config.scope = scope; state.status = "blocked";
    state.location = createLocation(root, root); state.report = "# Original draft";
    state.pipeline = { originalCriticFindings: ["Original blocker"] };
    privateDirectory(state.location.workspacePath);
    const store = new RunStore(root, state.tag); privateDirectory(store.dir);
    const path = join(store.dir, "pi-state.json"); writeFileSync(path, JSON.stringify(state));
    const before = readFileSync(path);
    h.ctx.ui.confirm = async () => { throw new Error("Read-only runs must not offer paid or context approval"); };
    h.events.get("session_start")({}, h.ctx);
    await h.command(`status ${state.tag}`); assert.match(h.notices.at(-1)!, /blocked/);
    for (const command of [`resume ${state.tag}`, `resume ${state.tag} --add-budget 15`, `resume ${state.tag} --use-project-config`, `revise ${state.tag} Shorten`, `context ${state.tag}`, "steer Shorten"]) {
      await h.command(command); assert.match(h.notices.at(-1)!, /read-only/, command);
      assert.deepEqual(readFileSync(path), before, command);
    }
    assert.equal(existsSync(join(state.location.workspacePath, "research")), false);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});
test("incompatible retraction configuration fails before dialogs or workspace creation", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-retraction-config-")); const h = harness(root);
  try {
    privateDirectory(join(root, ".pi"));
    writeFileSync(join(root, ".pi", "hyperresearch.json"), JSON.stringify({ scholarlyProviders: [] }));
    h.ctx.ui.confirm = async () => { throw new Error("No approval should precede a failed preflight"); };
    await h.command("start A bounded research question");
    assert.match(h.notices.at(-1)!, /requires OpenAlex/);
    assert.equal(existsSync(join(root, "workspaces")), false);
    assert.equal(existsSync(join(root, "runs")), false);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("tool cancellation dismisses startup approval and never starts workers", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-tool-cancel-")); const h = harness(root);
  const abort = new AbortController();
  try {
    h.ctx.model = { provider: "test", id: "mock" };
    let ready!: () => void;
    const prompted = new Promise<void>(resolve => { ready = resolve; });
    h.ctx.ui.confirm = async (_title: string, _text: string, options: { signal: AbortSignal }) => {
      ready();
      return new Promise<boolean>(resolve => options.signal.addEventListener("abort", () => resolve(false), { once: true }));
    };
    const task = h.tools.get("turing_run").execute("fixture", { query: "Cancelled question" }, abort.signal, undefined, h.ctx);
    await prompted;
    abort.abort();
    await assert.rejects(task);
    assert.equal(existsSync(join(root, "workspaces")), false);
    h.ctx.ui.confirm = async () => false;
    await h.command("start Another question");
    assert.match(h.notices.at(-1)!, /cost confirmation was cancelled/);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("a fast tool completion returns its own run even after the controller becomes idle", async t => {
  const root = mkdtempSync(join(tmpdir(), "hpr-tool-complete-")); const h = harness(root);
  try {
    h.ctx.model = { provider: "test", id: "mock" };
    h.ctx.ui.confirm = async () => true;
    t.mock.method(PiWorkerDriver, "create", async () => ({ checkModels: async () => true }) as any);
    t.mock.method(ResearchRunner.prototype, "run", async function(this: ResearchRunner) { this.state.status = "done"; });
    const result = await h.tools.get("turing_run").execute("fixture", { query: "Fast fixture" }, new AbortController().signal, undefined, h.ctx);
    assert.match(result.content[0].text, /completed its required gates/);
    assert.match(result.details.tag, /^fast-fixture-/);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("configured context remains a proposal with separate disclosures, not automatic consent", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-configured-start-")); const h = harness(root);
  try {
    privateDirectory(join(root, ".pi")); writeFileSync(join(root, "design.md"), "Selected background only.");
    writeFileSync(join(root, ".pi", "hyperresearch.json"), JSON.stringify({ searchProvider: "duckduckgo", additionalInstructions: "Keep the configured instructions", contextFiles: [{ path: "design.md", purpose: "background" }] }));
    h.ctx.model = { provider: "test", id: "mock" };
    h.ctx.ui.input = async () => { throw new Error("Configured selections must not be replaced by a questionnaire"); };
    const confirmations: string[] = [];
    h.ctx.ui.confirm = async (title: string, text: string) => {
      confirmations.push(title);
      if (title === "Approve context for research models?") { assert.match(text, /Keep the configured instructions/); assert.match(text, /design.md/); return true; }
      return false;
    };
    await h.command("start A configured research question");
    assert.deepEqual(confirmations, ["Approve context for research models?", "Allow context in public search/acquisition requests?", "Allow exporting reports derived from this context?", "Start research?"]);
    assert.equal(existsSync(join(root, "workspaces")), false);
    confirmations.length = 0; h.ctx.hasUI = false; // Explicit context still requires interactive permission.
    await assert.rejects(h.tools.get("turing_run").execute("fixture", { query: "Noninteractive context must not auto-approve" }, new AbortController().signal, undefined, h.ctx), /interactive disclosure approval/);
    assert.equal(existsSync(join(root, "workspaces")), false);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});
test("explicit Brave selection still requires credentials and never falls back to DuckDuckGo", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-start-preflight-")); const h = harness(root); const key = process.env.BRAVE_SEARCH_API_KEY;
  try {
    privateDirectory(join(root, ".pi"));
    writeFileSync(join(root, ".pi", "hyperresearch.json"), JSON.stringify({ searchProvider: "brave" }));
    delete process.env.BRAVE_SEARCH_API_KEY;
    h.ctx.ui.input = h.ctx.ui.confirm = async () => { throw new Error("No dialog should precede the failed preflight"); };
    await h.command("start This must not launch");
    assert.match(h.notices.at(-1)!, /BRAVE_SEARCH_API_KEY/); assert.equal(h.noticeLevels.at(-1), "error");
    assert.equal(existsSync(join(root, "workspaces")), false);
  } finally { if (key === undefined) delete process.env.BRAVE_SEARCH_API_KEY; else process.env.BRAVE_SEARCH_API_KEY = key; await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});
for (const [provider, keyName] of [["tavily", "TAVILY_API_KEY"], ["serply", "SERPLY_API_KEY"], ["kagi", "KAGI_API_KEY"]] as const) test(`${provider} startup validates its key before approval and names the selected provider in cost confirmation`, async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-provider-start-")); const h = harness(root); const originalKey = process.env[keyName];
  try {
    privateDirectory(join(root, ".pi"));
    writeFileSync(join(root, ".pi", "hyperresearch.json"), JSON.stringify({ searchProvider: provider }));
    delete process.env[keyName];
    h.ctx.model = { provider: "test", id: "mock" };
    h.ctx.ui.confirm = async () => { throw new Error("Missing credentials must fail before approval"); };
    await h.command("start Explicit provider selection");
    assert.match(h.notices.at(-1)!, new RegExp(keyName));
    assert.equal(existsSync(join(root, "workspaces")), false);
    process.env[keyName] = "fixture-secret";
    let confirmations = 0;
    h.ctx.ui.confirm = async (_title: string, text: string) => {
      confirmations++; assert.match(text, new RegExp(`Search: ${provider}`)); assert.ok(!text.includes("fixture-secret")); return false;
    };
    await h.command("start Explicit provider selection");
    assert.equal(confirmations, 1); assert.equal(existsSync(join(root, "workspaces")), false);
  } finally { if (originalKey === undefined) delete process.env[keyName]; else process.env[keyName] = originalKey; await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("blank file input skips files in explicit context selection; Escape cancels without silently saving", async () => {
  for (const path of ["", "   ", undefined]) {
    const root = mkdtempSync(join(tmpdir(), "hpr-skip-files-")); const h = harness(root);
    try {
      const state = fixture(); state.status = "paused"; state.location = createLocation(root, root); privateDirectory(state.location.workspacePath);
      const store = new RunStore(root, state.tag); store.save(state);
      h.ctx.ui.input = async (title: string) => title.startsWith("Additional") ? "Use these instructions without attachments" : path;
      h.ctx.ui.confirm = async (title: string) => title === "Attach a local context file?" || title === "Approve context for research models?";
      await h.command(`context ${state.tag}`);
      const saved = store.load();
      if (path === undefined) { assert.equal(saved.inputs, undefined); assert.equal(saved.feedback.length, 0); assert.match(h.notices.at(-1)!, /selection cancelled/); }
      else { assert.equal(saved.inputs!.instructions, "Use these instructions without attachments"); assert.deepEqual(saved.inputs!.files, []); assert.equal(saved.feedback.length, 1); }
    } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
  }
});
test("compatibility picker, list, status and denied cross-project resume never mutate checkpoints or use ambient preferences", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-read-only-")); const h = harness(root);
  try {
    const origin = join(root, "origin"); privateDirectory(origin);
    const other = join(root, "other"); privateDirectory(join(other, ".pi"));
    writeFileSync(join(other, ".pi", "hyperresearch.json"), JSON.stringify({ searchProvider: "duckduckgo", budgetUsd: 99 }));
    const state = fixture(); state.status = "paused"; state.location = createLocation(origin, root);
    state.config.searchProvider = "brave"; // Saved choice must not adopt the new DuckDuckGo default.
    privateDirectory(state.location.workspacePath);
    const store = new RunStore(root, state.tag); store.save(state);
    const before = readFileSync(join(store.dir, "pi-state.json"));
    h.ctx.cwd = other;
    const proposals: string[] = [];
    h.ctx.ui.confirm = async (_title: string, text: string) => { proposals.push(text); return false; };
    h.events.get("session_start")({}, h.ctx);
    assert.equal(h.events.get("before_agent_start")({ systemPrompt: "base" }, h.ctx), undefined);
    await h.command("browse"); await h.command("list"); await h.command(`status ${state.tag}`);
    await h.command(`resume ${state.tag}`);
    assert.match(proposals[0], /saved configuration/); assert.match(proposals[0], /Search: brave/);
    await h.command(`resume ${state.tag} --use-project-config`);
    assert.match(proposals[1], /Proposed configuration replacement/); assert.match(proposals[1], /Search: duckduckgo/);
    assert.deepEqual(readFileSync(join(store.dir, "pi-state.json")), before);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

async function openedDashboard(h: ReturnType<typeof harness>) {
  const url = [...h.notices].reverse().find(text => text.startsWith("http://127.0.0.1:"));
  assert.ok(url, h.notices.join("\n"));
  const response = await fetch(new URL("runs", url));
  assert.equal(response.status, 200);
  return { url, data: await response.json() };
}

test("bare dashboard opens inventory without a selected run, only after access approval", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-dashboard-default-")); const h = harness(root);
  try {
    const prompts: string[] = []; let approved = false;
    h.ctx.ui.confirm = async (title: string, text: string) => {
      prompts.push(title); assert.match(text, /across projects/); return approved;
    };
    await h.command("dashboard");
    assert.deepEqual(prompts, ["Open central inventory?"]);
    assert.equal(h.notices.length, 0);
    approved = true;
    await h.command("dashboard");
    const opened = await openedDashboard(h);
    assert.match(opened.data.scope, /all accessible central investigations/);
    assert.deepEqual(opened.data.runs, []);
    await h.command("dashboard");
    assert.equal((await openedDashboard(h)).url, opened.url);
    assert.equal(prompts.length, 2, "An already-approved inventory token is reused");
    assert.ok(!h.noticeLevels.includes("error"), h.notices.join("\n"));
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("a saved run opens focused within the full inventory but does not count as active research", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-dashboard-saved-")); const h = harness(root);
  try {
    const state = fixture(); state.status = "running";
    const store = new RunStore(root, state.tag); store.save(state);
    const other = fixture(); other.tag = "other-project-report"; other.location = createLocation(tmpdir(), root);
    new RunStore(root, other.tag).save(other);
    const before = readFileSync(join(store.dir, "pi-state.json"));
    const prompts: string[] = []; let approved = false;
    h.ctx.ui.confirm = async (title: string, text: string) => {
      prompts.push(title); assert.match(text, /across projects/); assert.match(text, /selected investigation opens first/); return approved;
    };
    await h.command(`dashboard ${state.tag}`);
    assert.equal(h.notices.length, 0, "Declining access must not open even the selected run");
    approved = true;
    const widgets: string[][] = []; h.ctx.ui.setWidget = (_key: string, value: string[]) => widgets.push(value);
    await h.command(`dashboard ${state.tag}`);
    const focused = await openedDashboard(h);
    assert.equal(new URL(focused.url).searchParams.get("run"), state.tag);
    assert.match(focused.data.scope, /all accessible central investigations/);
    assert.deepEqual(focused.data.runs.map((run: any) => run.tag).sort(), [other.tag, state.tag].sort());
    assert.ok(widgets.at(-1)!.some(line => line.includes(focused.url)), "Widget links use the inventory with a selected run");
    const snapshot = await (await fetch(new URL(`run?id=${state.tag}`, focused.url))).json();
    assert.match(snapshot.html, /Recorded running — not live/);
    await h.command("dashboard");
    const inventory = await openedDashboard(h);
    assert.equal(new URL(inventory.url).search, "", "A saved selection is not a live run");
    assert.equal(new URL(inventory.url).pathname, new URL(focused.url).pathname, "Reuse the same approved token");
    assert.deepEqual(prompts, ["Open central inventory?", "Open central inventory?"]);
    assert.deepEqual(readFileSync(join(store.dir, "pi-state.json")), before);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("bare dashboard selects the live run, honors explicit targets, and uses inventory when work ends", async t => {
  const root = mkdtempSync(join(tmpdir(), "hpr-dashboard-live-")); const h = harness(root);
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  try {
    const { store, state } = savedBudgetRun(root); state.status = "paused"; state.cost = 0; store.save(state);
    const other = fixture(); other.tag = "other-report"; other.status = "done";
    new RunStore(root, other.tag).save(other);
    const prompts: string[] = [];
    h.ctx.ui.confirm = async (title: string) => { prompts.push(title); return true; };
    let worker!: ResearchRunner;
    t.mock.method(PiWorkerDriver, "create", async () => ({} as any));
    t.mock.method(ResearchRunner.prototype, "run", async function(this: ResearchRunner) {
      worker = this; this.state.status = "running"; this.store.save(this.state); await hold;
    });
    await h.command(`resume ${state.tag}`);
    await h.command("dashboard");
    const active = await openedDashboard(h);
    assert.match(active.data.scope, /all accessible central investigations/);
    assert.deepEqual(active.data.runs.map((run: any) => run.tag).sort(), [state.tag, other.tag].sort());
    assert.equal(new URL(active.url).searchParams.get("run"), state.tag);
    assert.match((await (await fetch(new URL(`run?id=${state.tag}`, active.url))).json()).html, /data-run-live="true"/);
    assert.deepEqual(prompts, ["Resume paid research?", "Open central inventory?"]);
    await h.command(`dashboard ${other.tag}`);
    const selected = await openedDashboard(h);
    assert.equal(new URL(selected.url).searchParams.get("run"), other.tag);
    assert.equal(new URL(selected.url).pathname, new URL(active.url).pathname);
    assert.deepEqual(selected.data.runs.map((run: any) => run.tag).sort(), [state.tag, other.tag].sort());
    assert.match((await (await fetch(new URL(`run?id=${state.tag}`, selected.url))).json()).html, /data-run-live="true"/, "Selecting another investigation preserves the active run's live status");
    await h.command("dashboard all");
    const inventory = await openedDashboard(h);
    assert.match(inventory.data.scope, /all accessible central investigations/);
    assert.deepEqual(prompts, ["Resume paid research?", "Open central inventory?"]);
    assert.equal(new URL(inventory.url).search, "");
    await h.command("dashboard");
    assert.equal((await openedDashboard(h)).url, active.url);
    for (const status of ["done", "paused", "blocked", "failed", "aborted"] as const) {
      worker.state.status = status; worker.store.save(worker.state);
      await h.command("dashboard");
      assert.equal((await openedDashboard(h)).url, inventory.url, status);
    }
    assert.ok(!h.noticeLevels.includes("error"), h.notices.join("\n"));
  } finally { release(); await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("dashboard approval is serialized, cancelled on shutdown, and renewed after session replacement", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-dashboard-lifecycle-")); const h = harness(root);
  try {
    const state = fixture(); new RunStore(root, state.tag).save(state);
    let prompted!: () => void;
    const ready = new Promise<void>(resolve => { prompted = resolve; });
    let prompts = 0;
    h.ctx.ui.confirm = async (_title: string, _text: string, { signal }: { signal: AbortSignal }) => {
      prompts++; prompted();
      return new Promise<boolean>(resolve => signal.addEventListener("abort", () => resolve(false), { once: true }));
    };
    const pending = h.command(`dashboard ${state.tag}`);
    await ready;
    await h.command("dashboard all");
    assert.match(h.notices.at(-1)!, /Dashboard is already opening/);
    assert.equal(prompts, 1);
    await h.events.get("session_shutdown")({}, h.ctx);
    await pending;
    assert.ok(!h.notices.some(text => text.startsWith("http://")), "Shutdown cancels approval before a server opens");
    h.events.get("session_start")({ reason: "reload" }, h.ctx);
    h.ctx.ui.confirm = async () => { prompts++; return true; };
    await h.command(`dashboard ${state.tag}`);
    const opened = await openedDashboard(h);
    assert.equal(prompts, 2);
    await h.events.get("session_shutdown")({}, h.ctx);
    await assert.rejects(fetch(new URL("runs", opened.url)), "Session shutdown closes the approved inventory server");
    h.events.get("session_start")({ reason: "resume" }, h.ctx);
    h.ctx.ui.confirm = async () => { prompts++; return false; };
    const notices = h.notices.length;
    await h.command(`dashboard ${state.tag}`);
    assert.equal(prompts, 3);
    assert.equal(h.notices.length, notices, "A replacement session cannot reuse approval or the previous URL");
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("direct exports remain single-run and are not upgraded when a full dashboard opens", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-dashboard-export-")); const h = harness(root);
  try {
    const state = fixture(); state.report = "# Export fixture"; new RunStore(root, state.tag).save(state);
    const other = fixture(); other.tag = "another-run"; new RunStore(root, other.tag).save(other);
    h.ctx.ui.confirm = async () => { throw new Error("Direct export needs no inventory approval"); };
    await h.command(`export ${state.tag}`);
    const download = await openedDashboard(h);
    assert.match(new URL(download.url).pathname, /\/markdown$/);
    assert.match(download.data.scope, /this investigation only/);
    assert.match(await (await fetch(download.url)).text(), /Export fixture/);
    h.ctx.ui.confirm = async () => true;
    await h.command(`dashboard ${state.tag}`);
    const dashboard = await openedDashboard(h);
    assert.equal(dashboard.data.runs.length, 2);
    assert.notEqual(new URL(".", dashboard.url).href, new URL(".", download.url).href);
    assert.equal((await fetch(new URL(`run?id=${other.tag}`, download.url))).status, 404);
    assert.equal((await (await fetch(new URL("runs", download.url))).json()).runs.length, 1);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

async function dashboardActions(h: ReturnType<typeof harness>) {
  const { url } = await openedDashboard(h);
  const html = await (await fetch(new URL(".", url))).text();
  const secret = /data-control-token="([a-f0-9]+)"/.exec(html)![1];
  return { url, post: (action: object) => fetch(new URL("actions", url), {
    method: "POST", headers: { Origin: new URL(url).origin, "Content-Type": "application/json", "X-Hyperresearch-Control": secret },
    body: JSON.stringify({ id: randomUUID(), ...action }),
  }) };
}

test("bare command opens the dashboard; primary help and completions expose only the small interface", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-simple-interface-")); const h = harness(root);
  try {
    h.ctx.ui.confirm = async () => true;
    h.ctx.ui.select = async () => { throw new Error("The bare command must not open a terminal picker"); };
    await h.command("");
    assert.match((await openedDashboard(h)).data.scope, /all accessible central/);
    assert.deepEqual(h.completions().map((item: any) => item.value), ["close", "help"]);
    await h.command("help");
    assert.match(h.notices.at(-1)!, /Open the dashboard/);
    assert.doesNotMatch(h.notices.at(-1)!, /\/turing (migrate|context|snapshot|steer)/);
    await h.command("help advanced"); assert.match(h.notices.at(-1)!, /\/turing migrate/);
    const url = (await openedDashboard(h)).url;
    await h.command("close");
    assert.equal(h.events.get("before_agent_start")({ systemPrompt: "base" }, h.ctx), undefined);
    await assert.rejects(fetch(url));
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

for (const budget of [15, null]) test(`dashboard follow-up authorizes its displayed ceiling without another Pi prompt (budget=${budget})`, async t => {
  const root = mkdtempSync(join(tmpdir(), "hpr-dashboard-followup-")); const h = harness(root);
  try {
    const { state, store } = savedBudgetRun(root); state.status = "done"; state.config.budgetUsd = budget; store.save(state);
    const before = readFileSync(join(store.dir, "pi-state.json"));
    let approvals = 0; let launches = 0;
    h.ctx.ui.confirm = async (title: string) => {
      approvals++; assert.equal(title, "Open central inventory?", "The spending button replaces the Pi cost dialog"); return true;
    };
    t.mock.method(PiWorkerDriver, "create", async () => ({ checkModels: async () => true }) as any);
    t.mock.method(ResearchRunner.prototype, "run", async function(this: ResearchRunner) { launches++; });
    await h.command(`dashboard ${state.tag}`);
    const actions = await dashboardActions(h);
    const snapshot = await (await fetch(new URL(`run?id=${state.tag}`, actions.url))).json();
    assert.ok(snapshot.html.includes(budget === null ? "No model ceiling" : "$15 model ceiling"));
    assert.match(snapshot.html, /Search fees are separate/);
    const action = { id: randomUUID(), kind: "revise", tag: state.tag, text: "Compare recovery options", spendingApproval: revisionSpendingOffer(store.load()) };
    const result = await (await actions.post(action)).json();
    assert.equal(result.kind, "revision");
    assert.deepEqual(await (await actions.post(action)).json(), result);
    assert.equal(approvals, 1); assert.equal(launches, 1);
    assert.deepEqual(readFileSync(join(store.dir, "pi-state.json")), before);
    const child = new RunStore(root, result.tag).load();
    assert.equal(child.revision?.parentTag, state.tag); assert.equal(child.feedback[0].text, action.text); assert.equal(child.cost, 0);
    assert.equal(child.config.budgetUsd, budget);
    assert.deepEqual(child.revision?.spendingApproval, { ...action.spendingApproval, source: "dashboard", requestId: action.id, at: child.revision!.spendingApproval!.at });
    assert.match((await (await fetch(new URL(`run?id=${state.tag}`, actions.url))).json()).html, new RegExp(`data-related-run="${result.tag}"`));
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("missing, forged, and stale dashboard spending terms cannot launch or silently approve a changed budget", async t => {
  const root = mkdtempSync(join(tmpdir(), "hpr-stale-followup-")); const h = harness(root);
  try {
    const { state, store } = savedBudgetRun(root); state.status = "done"; store.save(state);
    h.ctx.ui.confirm = async () => true;
    await h.command(`dashboard ${state.tag}`);
    h.ctx.ui.confirm = async () => { throw new Error("Stale requests must not open approval dialogs"); };
    let launches = 0; t.mock.method(PiWorkerDriver, "create", async () => { launches++; throw new Error("Must not create a driver"); });
    const actions = await dashboardActions(h);
    const action = { kind: "revise", tag: state.tag, text: "Compare alternatives" };
    assert.equal((await actions.post(action)).status, 400);
    const offer = revisionSpendingOffer(store.load());
    assert.equal((await actions.post({ ...action, spendingApproval: { ...offer, budgetUsd: 1 } })).status, 409);
    state.config.budgetUsd = 30; store.save(state);
    const response = await actions.post({ ...action, spendingApproval: offer });
    assert.equal(response.status, 409); assert.match((await response.json()).error, /Follow-up terms changed/);
    assert.equal(launches, 0); assert.equal(store.load().config.budgetUsd, 30);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

for (const permission of ["declined", "approved", "changed"] as const) test(`dashboard spending authorization does not replace private-context permission (${permission})`, async t => {
  const root = mkdtempSync(join(tmpdir(), "hpr-private-followup-")); const h = harness(root);
  try {
    const { state, store } = savedBudgetRun(root); state.status = "done";
    writeFileSync(join(state.location!.projectPath, "context.md"), "Private design context for the synthetic fixture.");
    state.inputs = approveContext(state.location!.workspacePath, previewContext(state.location!.projectPath, { instructions: "", files: [{ path: "context.md", purpose: "background" }] }), { model: true, search: false, export: false });
    state.location!.contextRefs = state.inputs.files.map(file => file.id); state.location!.approvalRefs = [state.inputs.grant.id];
    store.save(state);
    const prompts: string[] = [];
    h.ctx.ui.confirm = async (title: string) => {
      prompts.push(title);
      if (title === "Open central inventory?") return true;
      assert.notEqual(title, "Create revision?", "Spending has already been explicitly authorized in the browser");
      if (title === "Approve context for research models?") {
        if (permission === "changed") { state.config.budgetUsd = 30; store.save(state); }
        return permission !== "declined";
      }
      return false; // Public disclosure and exports stay unapproved.
    };
    let launches = 0;
    t.mock.method(PiWorkerDriver, "create", async () => ({ checkModels: async () => true }) as any);
    t.mock.method(ResearchRunner.prototype, "run", async () => { launches++; });
    await h.command(`dashboard ${state.tag}`);
    const actions = await dashboardActions(h);
    const response = await actions.post({ kind: "revise", tag: state.tag, text: "Use the private context", spendingApproval: revisionSpendingOffer(store.load()) });
    const result = await response.json();
    assert.ok(prompts.includes("Approve context for research models?"));
    assert.equal(launches, permission === "approved" ? 1 : 0);
    if (permission === "approved") {
      assert.equal(result.kind, "revision");
      const child = new RunStore(root, result.tag).load();
      assert.notEqual(child.inputs?.grant.id, state.inputs.grant.id);
      assert.deepEqual(child.inputs?.grant.disclosure, { model: true, search: false, export: false });
      assert.equal(child.config.budgetUsd, 15);
    } else if (permission === "declined") assert.equal(result.kind, "cancelled");
    else { assert.equal(response.status, 409); assert.match(result.error, /Follow-up terms changed/); }
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

for (const mode of ["hide", "pause"] as const) test(`dashboard steers only owned work and ${mode} closes the UI without losing research`, async t => {
  const root = mkdtempSync(join(tmpdir(), "hpr-dashboard-owning-")); const h = harness(root);
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  try {
    const { state, store } = savedBudgetRun(root); state.status = "paused"; state.cost = 0; store.save(state);
    const other = fixture(); other.tag = "other-running"; new RunStore(root, other.tag).save(other);
    const widgets: unknown[] = []; h.ctx.ui.setWidget = (_key: string, value: unknown) => widgets.push(value);
    h.ctx.ui.confirm = async () => true;
    let worker!: ResearchRunner;
    t.mock.method(PiWorkerDriver, "create", async () => ({} as any));
    t.mock.method(ResearchRunner.prototype, "run", async function(this: ResearchRunner) {
      worker = this; this.state.status = "running"; this.store.save(this.state);
      this.abortController.signal.addEventListener("abort", () => release(), { once: true });
      await hold;
      this.state.status = "paused"; this.store.save(this.state); (this as any).onChange(this.state);
    });
    await h.command(`resume ${state.tag}`); await h.command("");
    const actions = await dashboardActions(h);
    assert.equal((await actions.post({ kind: "steer", tag: other.tag, text: "Wrong target" })).status, 409);
    assert.equal(new RunStore(root, other.tag).load().feedback.length, 0);
    const action = { id: randomUUID(), kind: "steer", tag: state.tag, text: "Prioritize backups" };
    assert.equal((await (await actions.post(action)).json()).kind, "queued");
    assert.equal((await actions.post(action)).status, 200);
    assert.equal(store.load().feedback.length, 1);
    assert.equal((await actions.post({ kind: "close", mode: "pause", activeTag: other.tag })).status, 409);
    assert.equal(worker.abortController.signal.aborted, false);
    const closed = await (await actions.post({ kind: "close", mode, activeTag: state.tag })).json();
    assert.equal(closed.kind, "closed");
    assert.equal(widgets.at(-1), undefined);
    assert.equal(h.events.get("before_agent_start")({ systemPrompt: "base" }, h.ctx), undefined);
    assert.equal(worker.abortController.signal.aborted, mode === "pause");
    if (mode === "hide") {
      const count = widgets.length;
      worker.steer("A later progress update");
      assert.equal(widgets.length, count, "Hidden UI must not return on progress updates");
      assert.equal((await actions.post({ kind: "steer", tag: state.tag, text: "Closed controls" })).status, 409);
      await h.command("");
      assert.notEqual(widgets.at(-1), undefined, "Explicit reopening restores the widget");
      await h.command("pause");
      assert.equal(store.load().status, "paused");
      assert.equal((await (await actions.post({ kind: "steer", tag: state.tag, text: "Saved while paused" })).json()).kind, "queued");
      assert.equal(store.load().status, "paused", "Saving guidance cannot resume research");
      await h.command("close");
    }
    assert.equal(store.load().status, "paused");
    await assert.rejects(fetch(actions.url), "Idle close shuts down the server after acknowledging the browser");
    assert.ok(store.load().report);
  } finally { release(); await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

function savedBudgetRun(root: string) {
  const origin = join(root, "origin"); privateDirectory(origin);
  const state = fixture(); state.status = "blocked"; state.reason = "Model cost ceiling reached";
  state.cost = 15.015412; state.config.budgetUsd = 15; state.config.searchProvider = "duckduckgo";
  state.report = "# Preserved unverified draft";
  state.location = createLocation(origin, root); privateDirectory(state.location.workspacePath);
  const store = new RunStore(root, state.tag); store.save(state);
  return { store, state };
}
test("a structural blocker refuses resume before offering an exhausted-budget top-up", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-structural-resume-")); const h = harness(root);
  try {
    const { store, state } = savedBudgetRun(root);
    state.checks = [{ name: "required-headings", ok: false, detail: "Missing heading" }];
    store.save(state);
    const before = readFileSync(join(store.dir, "pi-state.json"));
    h.ctx.ui.confirm = async () => { throw new Error("A top-up cannot repair a structural blocker"); };
    await h.command(`resume ${state.tag}`);
    assert.match(h.notices.at(-1)!, /explicitly steer/);
    assert.deepEqual(readFileSync(join(store.dir, "pi-state.json")), before);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("exhausted interactive resume offers one $15 top-up; declining changes nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-budget-decline-")); const h = harness(root);
  try {
    const { store, state } = savedBudgetRun(root); const before = readFileSync(join(store.dir, "pi-state.json"));
    const prompts: string[] = [];
    h.ctx.ui.confirm = async (title: string, text: string) => {
      prompts.push(title); assert.match(title, /Add \$15.00 and resume/);
      assert.match(text, /Already spent: \$15.02/); assert.match(text, /New total ceiling: \$30.00/); assert.match(text, /Remaining estimate: \$14.98/); return false;
    };
    await h.command(`resume ${state.tag}`);
    assert.equal(prompts.length, 1); assert.deepEqual(readFileSync(join(store.dir, "pi-state.json")), before);
    assert.match(h.notices.at(-1)!, /saved budget unchanged/);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});
test("approved top-up is saved before work, preserves origin/artifacts/spend, and does not repeat on ordinary resume", async t => {
  const root = mkdtempSync(join(tmpdir(), "hpr-budget-approve-")); const h = harness(root);
  try {
    const { store, state } = savedBudgetRun(root); const before = store.load();
    const other = join(root, "other"); privateDirectory(join(other, ".pi")); h.ctx.cwd = other;
    const configPath = join(other, ".pi", "hyperresearch.json"); const configText = JSON.stringify({ budgetUsd: 999, scope: "extended", searchProvider: "brave" }); writeFileSync(configPath, configText);
    const prompts: string[] = []; let executions = 0;
    h.ctx.ui.confirm = async (title: string) => { prompts.push(title); return true; };
    t.mock.method(PiWorkerDriver, "create", async () => ({ checkModels: async () => true, run: async () => { throw new Error("No paid worker should run in this fixture"); } }) as any);
    t.mock.method(ResearchRunner.prototype, "run", async function(this: ResearchRunner) {
      executions++; const saved = this.store.load();
      assert.equal(saved.config.budgetUsd, 30, "Approval must reach the authoritative checkpoint before model work");
      assert.equal(saved.budgetAdjustments!.length, 1); assert.equal(saved.cost, before.cost);
      assert.equal(saved.budgetAdjustments![0].approval, "interactive");
      assert.deepEqual(saved.steps, before.steps); assert.deepEqual(saved.workers, before.workers);
      assert.deepEqual(saved.sources, before.sources); assert.deepEqual(saved.location, before.location);
      assert.equal(saved.report, before.report); assert.equal(saved.tokens, before.tokens);
    });
    await h.command(`resume ${state.tag}`); await h.events.get("session_shutdown")({}, h.ctx);
    assert.equal(executions, 1); assert.equal(store.load().config.scope, "light");
    assert.equal(readFileSync(configPath, "utf8"), configText, "Project defaults must not be changed or adopted by a top-up");
    // A startup interruption/reload must not treat the already-approved increment as another top-up.
    h.events.get("session_start")({}, h.ctx);
    await h.command(`resume ${state.tag}`); await h.events.get("session_shutdown")({}, h.ctx);
    assert.equal(executions, 2); assert.deepEqual(prompts, ["Add $15.00 and resume research?", "Resume paid research?"]);
    assert.equal(store.load().budgetAdjustments!.length, 1);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});
test("explicit custom top-up still requires UI approval and cannot combine with project replacement", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-budget-custom-")); const h = harness(root);
  try {
    const { store, state } = savedBudgetRun(root); const before = readFileSync(join(store.dir, "pi-state.json"));
    let confirmations = 0;
    h.ctx.ui.confirm = async (title: string, text: string) => { confirmations++; assert.match(title, /Add \$2.50/); assert.match(text, /New total ceiling: \$17.50/); return false; };
    await h.command(`resume ${state.tag} --add-budget 2.50`);
    await h.command(`resume ${state.tag} --add-budget 15 --use-project-config`);
    assert.equal(confirmations, 1); assert.match(h.notices.at(-1)!, /not both/);
    assert.deepEqual(readFileSync(join(store.dir, "pi-state.json")), before);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});
test("non-interactive exhausted resume never auto-adds money; an explicit flag authorizes exactly one addition", async t => {
  const root = mkdtempSync(join(tmpdir(), "hpr-budget-print-")); const h = harness(root);
  try {
    const { store, state } = savedBudgetRun(root); h.ctx.hasUI = false; h.ctx.mode = "json";
    let created = 0, executions = 0;
    t.mock.method(PiWorkerDriver, "create", async () => { created++; return {} as any; });
    t.mock.method(ResearchRunner.prototype, "run", async function(this: ResearchRunner) {
      executions++; const saved = this.store.load(); assert.equal(saved.config.budgetUsd, 30); assert.equal(saved.cost, state.cost);
      assert.equal(saved.budgetAdjustments!.length, 1); assert.equal(saved.budgetAdjustments![0].approval, "explicit-flag");
    });
    await h.command(`resume ${state.tag}`); assert.equal(created, 0); assert.equal(store.load().config.budgetUsd, 15);
    await h.command(`resume ${state.tag} --add-budget 15`);
    assert.equal(created, 1); assert.equal(executions, 1);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});
for (const failure of ["changed", "locked", "setup", "save"] as const) test(`a ${failure} startup cannot grant an uncommitted top-up or launch workers`, async t => {
  const root = mkdtempSync(join(tmpdir(), "hpr-budget-failure-")); const h = harness(root); let unlock: (() => Promise<void>) | undefined;
  try {
    const { store, state } = savedBudgetRun(root); let executions = 0;
    t.mock.method(PiWorkerDriver, "create", async () => { if (failure === "setup") throw new Error("Fixture setup failed"); return {} as any; });
    t.mock.method(ResearchRunner.prototype, "run", async () => { executions++; });
    if (failure === "locked") unlock = await lockDataRoot(root);
    h.ctx.ui.confirm = async () => {
      if (failure === "changed") { const current = store.load(); current.cost++; store.save(current); }
      return true;
    };
    if (failure === "save") t.mock.method(RunStore.prototype, "save", () => { throw new Error("Fixture disk full"); });
    await h.command(`resume ${state.tag}`);
    assert.equal(executions, 0); assert.equal(store.load().config.budgetUsd, 15); assert.equal(store.load().budgetAdjustments, undefined);
    assert.equal(store.load().cost, state.cost + (failure === "changed" ? 1 : 0));
    assert.match(h.notices.at(-1)!, failure === "changed" ? /changed while awaiting approval/ : failure === "locked" ? /lock/i : failure === "setup" ? /setup failed/ : /disk full/);
  } finally { await unlock?.(); await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});
test("paused context proposals require separate disclosures, preserve origin, and only queue approved steering", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-context-command-")); const h = harness(root);
  try {
    const origin = join(root, "origin"); privateDirectory(origin); writeFileSync(join(origin, "design.md"), "Original project's selected evidence.");
    const other = join(root, "other"); privateDirectory(other); writeFileSync(join(other, "design.md"), "Unapproved other project's file.");
    const state = fixture(); state.status = "paused"; state.location = createLocation(origin, root); privateDirectory(state.location.workspacePath);
    const store = new RunStore(root, state.tag); store.save(state); h.ctx.cwd = other;
    const prompts: string[] = []; const approvals = [true, false, true, false, false];
    h.ctx.ui.confirm = async (title: string) => { prompts.push(title); return approvals.shift() ?? false; };
    h.ctx.ui.input = async (title: string) => title.startsWith("Additional") ? "Prioritize our design" : "design.md";
    h.ctx.ui.select = async () => "Local evidence (not independent external corroboration)";
    await h.command(`context ${state.tag}`);
    const saved = store.load(); assert.equal(saved.status, "paused"); assert.equal(saved.feedback[0].status, "queued");
    assert.deepEqual(saved.inputs?.grant.disclosure, { model: true, search: false, export: false });
    assert.equal(saved.inputs?.projectPath, saved.location?.projectPath);
    assert.match(saved.inputs!.files[0].originalPath, /origin\/design.md$/);
    assert.ok(prompts.includes("Allow context in public search/acquisition requests?")); assert.ok(prompts.includes("Allow exporting reports derived from this context?"));
    assert.equal(saved.workers.length, state.workers.length);
    await h.command(`save ${state.tag} ${join(other, "report.md")}`); assert.equal(existsSync(join(other, "report.md")), false);
    assert.match(h.notices.at(-1)!, /Export not approved/);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("Pi saves literal paths, confirms overwrites and preserves both concurrent edits and run state", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-save-command-")); const output = mkdtempSync(join(tmpdir(), "hpr-output-")); const h = harness(root);
  try {
    const state = fixture(); state.report = "# Report\n\nEvidence [[sqlite-wal]]";
    const store = new RunStore(root, state.tag); store.save(state);
    const before = readFileSync(join(store.dir, "pi-state.json"));
    h.ctx.cwd = output; const target = join(output, "chosen report.md");
    await h.command(`save ${state.tag} ${target}`);
    assert.match(readFileSync(target, "utf8"), /Recorded sources/);
    writeFileSync(target, "User-edited copy");
    await h.command(`save ${state.tag} ${target}`); assert.equal(readFileSync(target, "utf8"), "User-edited copy");
    h.ctx.ui.confirm = async () => { writeFileSync(target, "Concurrent editor change"); return true; };
    await h.command(`save ${state.tag} ${target}`); assert.equal(readFileSync(target, "utf8"), "Concurrent editor change");
    assert.match(h.notices.at(-1)!, /changed since approval/);
    assert.deepEqual(readFileSync(join(store.dir, "pi-state.json")), before);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); rmSync(output, { recursive: true, force: true }); }
});

test("the terminal preview fixture absorbs mistyped commands instead of starting model turns", () => {
  const h = harness(tmpdir(), previewWidget);
  assert.deepEqual(h.events.get("input")({ text: "/misspelled-demo", source: "interactive" }, h.ctx), { action: "handled" });
  assert.deepEqual(h.events.get("input")({ text: "accidental chat", source: "interactive" }, h.ctx), { action: "handled" });
});

for (const approve of [false, true]) test(`completed steering offers a revision with preserved feedback (approved=${approve})`, async t => {
  const root = mkdtempSync(join(tmpdir(), "hpr-steer-done-")); const h = harness(root);
  try {
    const { store, state } = savedBudgetRun(root);
    state.status = "done"; state.reason = undefined; store.save(state);
    const before = readFileSync(join(store.dir, "pi-state.json"));
    const feedback = "Compare alternatives to minhash when shape and cardinality matter?";
    const prompts: string[] = []; const children: ResearchRunner[] = [];
    h.ctx.ui.confirm = async (title: string, text: string) => {
      prompts.push(title); assert.match(text, /Model ceiling: \$15/); return approve;
    };
    t.mock.method(PiWorkerDriver, "create", async () => ({ checkModels: async () => true }) as any);
    t.mock.method(ResearchRunner.prototype, "run", async function(this: ResearchRunner) { children.push(this); });
    await h.command(`status ${state.tag}`);
    await h.command(`steer ${feedback}`);
    await h.events.get("session_shutdown")({}, h.ctx);
    assert.deepEqual(prompts, ["Create revision?"]);
    assert.ok(h.notices.some(n => n.includes(`/turing revise ${state.tag} ${feedback}`)));
    assert.deepEqual(readFileSync(join(store.dir, "pi-state.json")), before);
    assert.equal(children.length, approve ? 1 : 0);
    if (approve) {
      assert.equal(children[0].state.revision?.parentTag, state.tag);
      assert.equal(children[0].state.feedback[0].text, feedback);
      assert.equal(children[0].state.cost, 0);
    }
    assert.ok(!h.noticeLevels.includes("error"), h.notices.join("\n"));
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("steering waits for a completed live runner to release ownership before offering revision", async t => {
  const root = mkdtempSync(join(tmpdir(), "hpr-steer-settling-")); const h = harness(root);
  let release!: () => void;
  const settling = new Promise<void>(resolve => { release = resolve; });
  try {
    const { store, state } = savedBudgetRun(root); state.status = "paused"; state.cost = 0; store.save(state);
    const prompts: string[] = [];
    h.ctx.ui.confirm = async (title: string) => { prompts.push(title); return title !== "Create revision?"; };
    t.mock.method(PiWorkerDriver, "create", async () => ({ checkModels: async () => true }) as any);
    t.mock.method(ResearchRunner.prototype, "run", async function(this: ResearchRunner) {
      this.state.status = "done"; this.store.save(this.state);
      await settling;
    });
    await h.command(`resume ${state.tag}`);
    const steering = h.command("steer Compare alternatives");
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(prompts, ["Resume paid research?"]);
    release(); await steering;
    assert.deepEqual(prompts, ["Resume paid research?", "Create revision?"]);
    assert.equal(store.load().feedback.length, 0);
    assert.ok(!h.noticeLevels.includes("error"), h.notices.join("\n"));
  } finally { release(); await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("non-interactive completed steering only prints the exact revision command", async t => {
  const root = mkdtempSync(join(tmpdir(), "hpr-steer-print-")); const h = harness(root);
  try {
    const { store, state } = savedBudgetRun(root); state.status = "done"; store.save(state);
    h.ctx.hasUI = false; h.ctx.mode = "json";
    const output: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    t.mock.method(process.stdout, "write", (text: any, ...args: any[]) => {
      if (typeof text === "string" && text.startsWith('{"type":"hyperresearch_status"')) { output.push(text); return true; }
      return (write as any)(text, ...args);
    });
    t.mock.method(PiWorkerDriver, "create", async () => { throw new Error("Must not start paid work"); });
    await h.command(`status ${state.tag}`);
    const before = readFileSync(join(store.dir, "pi-state.json"));
    await h.command("steer Compare alternatives");
    assert.match(output.at(-1)!, new RegExp(`/turing revise ${state.tag} Compare alternatives`));
    assert.deepEqual(readFileSync(join(store.dir, "pi-state.json")), before);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
});

test("paused steering is saved under the vault lock; chat provides read-only context and does not steer", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "hpr-extension-")); const h = harness(cwd);
  try {
    const state = fixture(); state.status = "paused";
    state.location = createLocation(cwd, cwd); privateDirectory(state.location.workspacePath);
    const store = new RunStore(cwd, state.tag); store.save(state);
    h.events.get("session_start")({}, h.ctx);
    assert.equal(h.events.has("input"), false); // Editor input is neither intercepted nor locked.
    await h.command("steer Prioritize primary sources");
    assert.equal(store.load().feedback[0].status, "queued");
    assert.equal(store.load().status, "paused");
    const context = h.events.get("before_agent_start")({ systemPrompt: "Base instructions", prompt: "Also change the scope" }, h.ctx);
    assert.match(context.systemPrompt, /Ordinary prompts do not steer/);
    assert.equal(JSON.parse(context.message.content).liveInThisSession, false);
    assert.equal(store.load().feedback.length, 1);
    await h.command("status");
    assert.ok(h.notices.some(n => n.includes("1 queued · 0 applied")));
    await h.command("revise");
    assert.match(h.notices.at(-1)!, /Usage:/);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(cwd, { recursive: true, force: true }); }
});

test("another runner's lock and untrusted projects prevent persisted steering", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "hpr-extension-lock-")); const h = harness(cwd);
  let unlock: (() => Promise<void>) | undefined;
  try {
    const state = fixture(); state.status = "paused";
    const store = new RunStore(cwd, state.tag); store.save(state);
    await h.command(`status ${state.tag}`);
    unlock = await lockDataRoot(cwd);
    await h.command("steer Do not compete");
    assert.equal(store.load().feedback.length, 0);
    assert.match(h.notices.at(-1)!, /lock/i);
    await unlock(); unlock = undefined;
    h.ctx.isProjectTrusted = () => false;
    await h.command("steer Not authorized");
    assert.equal(store.load().feedback.length, 0);
    assert.match(h.notices.at(-1)!, /Trust this project/);
  } finally { await unlock?.(); await h.events.get("session_shutdown")({}, h.ctx); rmSync(cwd, { recursive: true, force: true }); }
});

import { test } from "node:test";
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

export function harness(cwd: string, factory = extension) {
  process.env.HYPERRESEARCH_DATA_ROOT = cwd;
  const commands = new Map<string, any>(); const events = new Map<string, any>(); const notices: string[] = [];
  const ctx: any = { cwd, mode: "rpc", hasUI: true, isProjectTrusted: () => true,
    ui: { select: async () => undefined, confirm: async () => false, input: async () => undefined, notify: (text: string) => notices.push(text), setWidget: () => {}, setEditorText: () => { throw new Error("Must not replace user input"); } } };
  const pi: any = { registerCommand: (name: string, spec: any) => commands.set(name, spec), on: (name: string, handler: any) => events.set(name, handler),
    registerTool: () => {}, appendEntry: () => {}, sendUserMessage: () => { throw new Error("Must not start model turns"); } };
  factory(pi);
  return { ctx, events, notices, command: (input: string) => commands.get("hyperresearch").handler(input, ctx) };
}

test("bare picker, list, status and denied cross-project resume never mutate checkpoints or use ambient preferences", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-read-only-")); const h = harness(root);
  try {
    const origin = join(root, "origin"); privateDirectory(origin);
    const other = join(root, "other"); privateDirectory(join(other, ".pi"));
    writeFileSync(join(other, ".pi", "hyperresearch.json"), JSON.stringify({ searchProvider: "duckduckgo", budgetUsd: 99 }));
    const state = fixture(); state.status = "paused"; state.location = createLocation(origin, root);
    privateDirectory(state.location.workspacePath);
    const store = new RunStore(root, state.tag); store.save(state);
    const before = readFileSync(join(store.dir, "pi-state.json"));
    h.ctx.cwd = other;
    const proposals: string[] = [];
    h.ctx.ui.confirm = async (_title: string, text: string) => { proposals.push(text); return false; };
    h.events.get("session_start")({}, h.ctx);
    assert.equal(h.events.get("before_agent_start")({ systemPrompt: "base" }, h.ctx), undefined);
    await h.command(""); await h.command("list"); await h.command(`status ${state.tag}`);
    await h.command(`resume ${state.tag}`);
    assert.match(proposals[0], /saved configuration/); assert.match(proposals[0], /Search: brave/);
    await h.command(`resume ${state.tag} --use-project-config`);
    assert.match(proposals[1], /Proposed configuration replacement/); assert.match(proposals[1], /Search: duckduckgo/);
    assert.deepEqual(readFileSync(join(store.dir, "pi-state.json")), before);
  } finally { await h.events.get("session_shutdown")({}, h.ctx); rmSync(root, { recursive: true, force: true }); }
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

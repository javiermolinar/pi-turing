import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import lockfile from "proper-lockfile";
import extension from "../extensions/index.ts";
import previewWidget from "../scripts/preview-widget.ts";
import { RunStore } from "../src/store.ts";
import { fixture } from "./fixtures.ts";

function harness(cwd: string, factory = extension) {
  const commands = new Map<string, any>(); const events = new Map<string, any>(); const notices: string[] = [];
  const ctx: any = { cwd, mode: "rpc", hasUI: true, isProjectTrusted: () => true,
    ui: { notify: (text: string) => notices.push(text), setWidget: () => {}, setEditorText: () => { throw new Error("Must not replace user input"); } } };
  const pi: any = { registerCommand: (name: string, spec: any) => commands.set(name, spec), on: (name: string, handler: any) => events.set(name, handler),
    registerTool: () => {}, appendEntry: () => {}, sendUserMessage: () => { throw new Error("Must not start model turns"); } };
  factory(pi);
  return { ctx, events, notices, command: (input: string) => commands.get("hyperresearch").handler(input, ctx) };
}

test("the terminal preview fixture absorbs mistyped commands instead of starting model turns", () => {
  const h = harness(tmpdir(), previewWidget);
  assert.deepEqual(h.events.get("input")({ text: "/misspelled-demo", source: "interactive" }, h.ctx), { action: "handled" });
  assert.deepEqual(h.events.get("input")({ text: "accidental chat", source: "interactive" }, h.ctx), { action: "handled" });
});

test("paused steering is saved under the vault lock; chat provides read-only context and does not steer", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "hpr-extension-")); const h = harness(cwd);
  try {
    const state = fixture(); state.status = "paused";
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
    unlock = await lockfile.lock(cwd, { lockfilePath: join(cwd, ".hyperresearch-runner.lock") });
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

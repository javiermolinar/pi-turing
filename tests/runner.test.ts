import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Backend, BackendAction } from "../src/backend.ts";
import { ResearchRunner } from "../src/runner.ts";
import { createLocation } from "../src/paths.ts";
import { configSchema, type RunState } from "../src/types.ts";
import type { WorkRequest, WorkerDriver } from "../src/worker.ts";
import { fixture } from "./fixtures.ts";

class FakeBackend implements Backend {
  calls: BackendAction[] = [];
  passed = true;
  rateLimited = 0;
  async call<T>(action: BackendAction, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push(action);
    let value: unknown = {};
    if (action === "init") value = { sourceMin: 2, wordTarget: [500, 2000] };
    if (action === "fetch_source") value = { note_id: new URL(args.url as string).pathname.slice(1) };
    if (action === "read_source") value = { id: args.id, title: String(args.id), url: `https://example.org/${args.id}`, words: 100,
      offset: 0, end: 100, total: 100, hash: "fixed-body", body: "Evidence ".repeat(10), nextOffset: null };
    if (action === "retractions") value = { checked: 0, unresolved: 0, rate_limited: this.rateLimited, retracted: [] };
    if (action === "finish") value = { passed: this.passed, checks: [{ name: "test-backend-gate", ok: this.passed, detail: "Fixture verdict" }] };
    return value as T;
  }
}
class FakeDriver implements WorkerDriver {
  roles: string[] = [];
  count = 0;
  wait = false;
  async checkModels() { return true; }
  async run(request: WorkRequest, state: RunState): Promise<unknown> {
    this.roles.push(request.role); request.onTurn(); request.onUsage(100, 0.01);
    if (this.wait) await new Promise<void>((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new Error("Stopped")), { once: true }));
    request.signal.throwIfAborted();
    let result: unknown;
    if (request.role === "decompose") result = fixture().decomposition;
    if (request.role === "research") {
      const fetch = request.tools.find(t => t.name === "fetch_source")!;
      await fetch.execute({ url: `https://example.org/source-${++this.count}` }, request.signal);
      result = { summary: "Evidence collected", gaps: [] };
    }
    if (request.role === "draft") {
      const read = request.tools.find(t => t.name === "read_source")!;
      for (const source of state.sources) await read.execute({ id: source.id }, request.signal);
      result = { markdown: "# Evidence report\n\nAwkward sentence.\n\n" + "Measured evidence. ".repeat(300) + state.sources.map(s => `[[${s.id}]]`).join(" ") };
    }
    if (request.role === "polish") result = { summary: "Clarity", edits: state.report?.includes("Awkward sentence.") ? [{ oldText: "Awkward sentence.", newText: "Clear sentence.", reason: "Clarity" }] : [] };
    if (request.role === "readability") result = { summary: "No additional changes", edits: [] };
    request.resultSchema.parse(result); request.validateResult?.(result); return result;
  }
}

async function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "hpr-runner-"));
  const backend = new FakeBackend(); const driver = new FakeDriver();
  const runner = await ResearchRunner.create(cwd, "Verbatim question?", configSchema.parse({}), "test/mock", "off", backend, driver, undefined, undefined, createLocation(cwd, cwd));
  return { cwd, backend, driver, runner, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("light pipeline orders stages, requires source reads, patches and verifies", async () => {
  const env = await setup();
  try {
    await env.runner.run();
    assert.equal(env.runner.state.status, "done");
    assert.deepEqual(env.driver.roles, ["decompose", "research", "research", "draft", "polish", "readability"]);
    assert.ok(env.runner.state.sources.every(s => s.fullRead));
    assert.match(readFileSync(env.runner.store.reportPath, "utf8"), /Clear sentence/);
    assert.match(readFileSync(join(env.runner.store.dir, "dashboard.html"), "utf8"), /Offline snapshot/);
    assert.equal(env.backend.calls.at(-1), "finish");
    assert.equal(env.runner.state.tokens, 600);
    assert.equal(env.runner.state.query, "Verbatim question?");
  } finally { env.cleanup(); }
});

test("failed gate stays blocked and resume patches rather than regenerating draft", async () => {
  const env = await setup();
  try {
    env.backend.passed = false; await env.runner.run();
    assert.equal(env.runner.state.status, "blocked");
    assert.ok(env.runner.state.checks.some(c => !c.ok));
    env.backend.passed = true;
    const resume = new ResearchRunner(env.cwd, env.runner.store.load(), env.backend, env.driver);
    await resume.run(); assert.equal(resume.state.status, "done");
    assert.equal(env.driver.roles.filter(role => role === "draft").length, 1);
    assert.equal(env.driver.roles.filter(role => role === "polish").length, 2);
  } finally { env.cleanup(); }
});

test("an incomplete retraction refresh cannot ship a report", async () => {
  const env = await setup();
  try {
    env.backend.rateLimited = 1;
    await env.runner.run();
    assert.equal(env.runner.state.status, "blocked");
    assert.ok(!env.backend.calls.includes("finish"));
    assert.ok(env.runner.state.checks.some(c => c.name === "retraction-refresh" && !c.ok));
  } finally { env.cleanup(); }
});

test("cost ceiling stops work and refuses resume until budget is raised", async () => {
  const env = await setup();
  try {
    env.runner.state.config.budgetUsd = 0.005;
    await env.runner.run(); assert.equal(env.runner.state.status, "blocked");
    assert.equal(env.driver.roles.length, 1); assert.ok(!env.backend.calls.includes("finish"));
    const resume = new ResearchRunner(env.cwd, env.runner.store.load(), env.backend, env.driver);
    await resume.run(); assert.equal(env.driver.roles.length, 1);
    const raised = env.runner.store.load(); raised.config.budgetUsd = 1;
    const retry = new ResearchRunner(env.cwd, raised, env.backend, env.driver);
    await retry.run(); assert.equal(retry.state.status, "done");
  } finally { env.cleanup(); }
});

test("pause waits for worker cancellation; resume restarts incomplete stage", async () => {
  const env = await setup();
  try {
    env.driver.wait = true;
    const running = env.runner.run();
    setTimeout(() => env.runner.stop("paused"), 50);
    await running; assert.equal(env.runner.state.status, "paused");
    assert.equal(env.runner.state.steps["1"], "pending");
    assert.ok(env.runner.state.workers.every(w => w.status !== "running"));
    env.driver.wait = false;
    const resumed = new ResearchRunner(env.cwd, env.runner.store.load(), env.backend, env.driver);
    await resumed.run(); assert.equal(resumed.state.status, "done");
  } finally { env.cleanup(); }
});

test("steering waits for both research lanes, persists its queue, then replans with cumulative cost", async () => {
  const env = await setup();
  try {
    const original = env.driver.run.bind(env.driver);
    const prompts: { role: string; prompt: string }[] = [];
    let lanes = 0;
    let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
    let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve; });
    env.driver.run = async (request, state) => {
      prompts.push({ role: request.role, prompt: request.prompt });
      if (request.role === "research" && ++lanes <= 2) {
        if (lanes === 2) ready();
        await barrier;
      }
      return original(request, state);
    };
    const running = env.runner.run(); await started;
    env.runner.steer("Prioritize primary experimental evidence");
    assert.equal(env.runner.state.feedback[0].status, "queued");
    assert.equal(env.runner.store.load().feedback[0].status, "queued");
    assert.equal(env.runner.state.steps["2"], "running");
    assert.equal(env.runner.state.workers.filter(w => w.status === "running").length, 2);
    release(); await running;
    assert.equal(env.runner.state.status, "done");
    assert.equal(env.runner.state.feedback[0].status, "applied");
    assert.ok(env.runner.state.feedback[0].appliedAt);
    assert.equal(prompts.filter(p => p.role === "decompose").length, 2);
    assert.ok(prompts.slice(0, 3).every(p => !p.prompt.includes("Prioritize primary experimental evidence")));
    assert.ok(prompts.slice(3).every(p => p.prompt.includes("Prioritize primary experimental evidence")));
    assert.equal(env.runner.state.tokens, 900);
    assert.ok(Math.abs(env.runner.state.cost - 0.09) < 0.0001);
    assert.equal(env.runner.state.query, "Verbatim question?");
  } finally { env.cleanup(); }
});

test("pause keeps feedback queued; explicit resume applies it before a worker starts", async () => {
  const env = await setup();
  try {
    env.driver.wait = true;
    const running = env.runner.run();
    while (!env.driver.roles.length) await new Promise(resolve => setTimeout(resolve, 1));
    env.runner.steer("Narrow the scope to primary sources");
    env.runner.stop("paused"); await running;
    assert.equal(env.runner.store.load().feedback[0].status, "queued");
    env.driver.wait = false;
    const resumed = new ResearchRunner(env.cwd, env.runner.store.load(), env.backend, env.driver);
    const original = env.driver.run.bind(env.driver);
    env.driver.run = async (request, state) => {
      assert.match(request.prompt, /Narrow the scope/);
      assert.equal(state.feedback[0].status, "applied");
      return original(request, state);
    };
    await resumed.run(); assert.equal(resumed.state.status, "done");
  } finally { env.cleanup(); }
});

test("late steering archives the draft and marks it stale until a new evidence-grounded draft is written", async () => {
  const env = await setup();
  try {
    const original = env.driver.run.bind(env.driver);
    let sent = false; let staleObserved = false;
    env.driver.run = async (request, state) => {
      if (request.role === "polish" && !sent) { sent = true; env.runner.steer("Explain the contrary evidence"); }
      if (sent && request.role === "decompose") {
        staleObserved = !!state.reportStale;
        assert.match(request.prompt, /Previous report for revision context only/);
        assert.match(request.prompt, /Clear sentence/);
        assert.deepEqual(state.checks, []);
        assert.match(readFileSync(join(env.runner.store.dir, "draft-before-feedback-1.md"), "utf8"), /Clear sentence/);
      }
      return original(request, state);
    };
    await env.runner.run();
    assert.equal(env.runner.state.status, "done"); assert.ok(staleObserved);
    assert.equal(env.runner.state.reportStale, false);
    assert.equal(env.driver.roles.filter(r => r === "draft").length, 2);
    assert.ok(env.runner.state.checks.find(c => c.name === "report-current")?.ok);
  } finally { env.cleanup(); }
});

test("feedback arriving during verification cannot be silently shipped or dropped", async () => {
  const env = await setup();
  try {
    const original = env.backend.call.bind(env.backend);
    let sent = false;
    env.backend.call = async (action, args) => {
      if (action === "finish" && !sent) { sent = true; env.runner.steer("Check counterexamples"); }
      return original(action, args);
    };
    await env.runner.run();
    assert.equal(env.runner.state.status, "done");
    assert.equal(env.runner.state.feedback[0].status, "applied");
    assert.equal(env.backend.calls.filter(a => a === "finish").length, 2);
    assert.equal(env.driver.roles.filter(r => r === "decompose").length, 2);
  } finally { env.cleanup(); }
});

test("steering cannot reset the model cost ceiling", async () => {
  const env = await setup();
  try {
    env.runner.state.config.budgetUsd = 0.035;
    const original = env.driver.run.bind(env.driver);
    let sent = false;
    env.driver.run = async (request, state) => {
      if (request.role === "research" && !sent) { sent = true; env.runner.steer("Prefer primary evidence"); }
      return original(request, state);
    };
    await env.runner.run();
    assert.equal(env.runner.state.status, "blocked");
    assert.ok(env.runner.state.cost >= 0.035);
    assert.equal(env.driver.roles.filter(r => r === "decompose").length, 2);
    assert.ok(!env.backend.calls.includes("finish"));
  } finally { env.cleanup(); }
});

test("revision preserves the parent, snapshots its context, and reruns evidence reads and gates with its own budget", async () => {
  const env = await setup();
  try {
    await env.runner.run();
    const parent = env.runner.store.load();
    const parentState = readFileSync(join(env.runner.store.dir, "pi-state.json"), "utf8");
    const parentReport = readFileSync(env.runner.store.reportPath, "utf8");
    const child = await ResearchRunner.revise(env.cwd, parent, "Expand the limitations", configSchema.parse({}), "test/mock", "off", env.backend, env.driver);
    assert.notEqual(child.state.tag, parent.tag);
    assert.equal(child.state.revision?.parentTag, parent.tag);
    assert.equal(child.state.revision?.report, parentReport);
    assert.equal(child.state.cost, 0); assert.equal(child.state.sources.length, 0);
    const original = env.driver.run.bind(env.driver);
    env.driver.run = async (request, state) => {
      assert.match(request.prompt, /Expand the limitations/);
      assert.match(request.prompt, /not the previous report as evidence/);
      return original(request, state);
    };
    await child.run(); assert.equal(child.state.status, "done");
    assert.ok(child.state.sources.every(s => s.fullRead));
    assert.equal(readFileSync(env.runner.store.reportPath, "utf8"), parentReport);
    assert.equal(readFileSync(join(env.runner.store.dir, "pi-state.json"), "utf8"), parentState);
    const grandchild = await ResearchRunner.revise(env.cwd, child.state, "Make the conclusion shorter", configSchema.parse({}), "test/mock", "off", env.backend, env.driver);
    assert.deepEqual(grandchild.state.revision?.instructions, ["Expand the limitations"]);
    await assert.rejects(ResearchRunner.revise(env.cwd, grandchild.state, "not done", configSchema.parse({}), "test/mock", "off", env.backend, env.driver), /Only completed/);
  } finally { env.cleanup(); }
});

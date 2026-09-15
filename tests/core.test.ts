import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch, citationIds } from "../src/patch.ts";
import { ReadCoverage } from "../src/coverage.ts";
import { RunStore, validateTag, atomicWrite } from "../src/store.ts";
import { renderDashboard } from "../src/dashboard.ts";
import { execute } from "../src/process.ts";
import { fixture } from "./fixtures.ts";

test("patches are unique, bounded and matched against original text", () => {
  const report = "A unique sentence. A different sentence. " + "padding ".repeat(100);
  const patch = { summary: "clarity", edits: [{ oldText: "A unique sentence.", newText: "A clearer sentence.", reason: "clarity" }] };
  assert.match(applyPatch(report, patch).report, /^A clearer/);
  assert.throws(() => applyPatch(report, { ...patch, edits: [{ ...patch.edits[0], oldText: "padding" }] }), /exactly once/);
  assert.throws(() => applyPatch(report, { ...patch, edits: [{ ...patch.edits[0], oldText: "absent" }] }), /exactly once/);
  assert.throws(() => applyPatch(report, { summary: "x", edits: [patch.edits[0], { oldText: "unique sentence", newText: "x", reason: "x" }] }), /overlap/);
  assert.throws(() => applyPatch("short report", { summary: "x", edits: [{ oldText: "short report", newText: "rewritten", reason: "x" }] }), /15%/);
  assert.deepEqual(citationIds("[[one]] [[two|label]] [[one#section]]"), ["one", "two"]);
});

test("read coverage requires every page and resets on changed body hash", () => {
  const coverage = new ReadCoverage();
  assert.equal(coverage.add("a", "v1", 5, 10, 10), false);
  assert.equal(coverage.add("a", "v1", 0, 4, 10), false);
  assert.equal(coverage.add("a", "v1", 4, 5, 10), true);
  assert.equal(coverage.add("a", "v2", 0, 5, 10), false);
  assert.throws(() => coverage.add("a", "v2", 0, 12, 10));
});

test("checkpoint rematerializes report and refuses traversal and symlinks", () => {
  const cwd = mkdtempSync(join(tmpdir(), "hpr-store-"));
  try {
    const state = fixture(); state.report = "# Actual report";
    const store = new RunStore(cwd, state.tag); store.save(state);
    assert.equal(store.load().report, "# Actual report");
    writeFileSync(store.reportPath, "interrupted materialized view");
    store.save(store.load()); assert.equal(readFileSync(store.reportPath, "utf8"), state.report);
    assert.equal(existsSync(join(store.dir, "dashboard.html")), false);
    assert.match(readFileSync(store.snapshot(), "utf8"), /Offline snapshot/);
    for (const tag of ["../escape", "/absolute", "a/b", "..", ""]) assert.throws(() => validateTag(tag));
    const outside = join(cwd, "outside"); writeFileSync(outside, "safe");
    symlinkSync(outside, join(cwd, "alias"));
    assert.throws(() => atomicWrite(join(cwd, "alias"), "bad"), /symlink/);
    assert.equal(readFileSync(outside, "utf8"), "safe");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("activity checkpoints leave unchanged reports alone and retire duplicate JSON views", () => {
  const cwd = mkdtempSync(join(tmpdir(), "hpr-store-views-"));
  try {
    const state = fixture(); state.report = "# Preserved report";
    state.patches = { "15": { summary: "Polish", edits: [] }, "16": { summary: "Readable", edits: [] } };
    const store = new RunStore(cwd, state.tag);
    store.save(state);
    const before = lstatSync(store.reportPath, { bigint: true });
    const retired = ["prompt-decomposition.json", "polish-log.json", "readability-decisions.json"];
    for (const file of retired) {
      assert.equal(existsSync(join(store.dir, file)), false);
      writeFileSync(join(store.dir, file), "stale bridge view");
    }
    state.activity = { text: "Reasoning", at: new Date().toISOString() };
    store.save(state);
    const after = lstatSync(store.reportPath, { bigint: true });
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeNs, before.mtimeNs);
    for (const file of retired) assert.equal(existsSync(join(store.dir, file)), false);
    assert.deepEqual(store.load().patches, state.patches);
    assert.deepEqual(store.load().decomposition, state.decomposition);
    state.report = "# Updated report";
    store.save(state);
    assert.equal(readFileSync(store.reportPath, "utf8"), state.report);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("dashboard escapes queries, source URLs, errors and report HTML", () => {
  const state = fixture();
  state.query = '</main><script>alert("xss")</script>';
  state.sources[0].url = 'javascript:alert(1)'; state.sources[0].title = '<img src=x onerror=alert(1)>';
  state.report = '# Preview\n<script>alert(1)</script><img src="https://evil.test/pixel"><a href="javascript:alert(1)">bad</a>';
  state.reason = '<iframe src="file:///etc/passwd">';
  const html = renderDashboard(state);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
  assert.ok(!html.includes('<img ')); assert.ok(!html.includes('<iframe '));
  assert.ok(!/<a\b[^>]*href="javascript:/i.test(html));
  assert.ok(html.includes("Content-Security-Policy"));
});

test("process cancellation terminates and output is capped", async () => {
  const signal = AbortSignal.timeout(100);
  await assert.rejects(execute(process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd: process.cwd(), signal }), /Cancelled/);
  await assert.rejects(execute(process.execPath, ["-e", "process.stdout.write('x'.repeat(20000))"], { cwd: process.cwd(), maxBytes: 1000 }), /limit/);
});

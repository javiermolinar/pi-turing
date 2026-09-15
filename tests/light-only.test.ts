import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configSchema, isReadOnlyRun, type Config, type RunState } from "../src/types.ts";
import { ResearchRunner } from "../src/runner.ts";
import { RunStore, inventory } from "../src/store.ts";
import { createLocation, privateDirectory } from "../src/paths.ts";
import { proposeBudgetTopUp } from "../src/budget.ts";
import { queueFeedback } from "../src/feedback.ts";
import { runActions } from "../src/picker.ts";
import { progressLines } from "../src/progress.ts";
import { portableMarkdown } from "../src/export.ts";
import { renderDashboard } from "../src/dashboard.ts";
import type { Backend } from "../src/services.ts";
import type { WorkerDriver } from "../src/worker.ts";
import { fixture } from "./fixtures.ts";

const forbidden = async (): Promise<never> => { throw new Error("No backend or model call may occur"); };
const backend: Backend = { initialize: forbidden, fetchSource: forbidden, readSource: forbidden, searchVault: forbidden,
  searchWeb: forbidden, searchScholarly: forbidden, refreshRetractions: forbidden, verifyReport: forbidden };
const driver: WorkerDriver = { checkModels: forbidden, run: forbidden };

for (const scope of ["full", "extended"] as const) test(`${scope} cannot create paid work or a workspace`, async () => {
  const root = mkdtempSync(join(tmpdir(), "light-only-new-"));
  try {
    assert.throws(() => configSchema.parse({ scope }), /removed/);
    const config = { ...configSchema.parse({}), scope } as unknown as Config;
    const location = createLocation(root, root);
    await assert.rejects(ResearchRunner.create(root, "Question", config, "test/mock", "off", backend, driver, undefined, undefined, location), /removed/);
    assert.equal(existsSync(location.workspacePath), false);
    assert.equal(existsSync(join(root, "runs")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const scope of ["full", "extended"] as const) test(`${scope} checkpoints and reports stay read-only with historical status and spend`, async () => {
  const root = mkdtempSync(join(tmpdir(), "light-only-legacy-"));
  try {
    const raw = fixture(); raw.profile = scope; raw.config.scope = scope; raw.status = "blocked"; raw.cost = 30.204642;
    raw.reason = "Original evidence review blocker";
    raw.report = "# Preserved report\n\nConditional comparison. [[sqlite-wal]]";
    raw.pipeline = { arbitraryLegacySchema: { privateQuote: "PRIVATE-REVIEW-TEXT", critics: ["unresolved"] } };
    raw.steps = { "1": "done", corpus: "done", evidence: "pending", '<script>alert(1)</script>': "pending" };
    raw.location = createLocation(root, root); privateDirectory(raw.location.workspacePath);
    const store = new RunStore(root, raw.tag); privateDirectory(store.dir);
    const path = join(store.dir, "pi-state.json"); writeFileSync(path, JSON.stringify(raw));
    writeFileSync(store.reportPath, raw.report);
    const before = readFileSync(path), state = store.load();
    assert.equal(state.profile, scope); assert.equal(state.cost, raw.cost); assert.equal(state.status, "blocked");
    assert.deepEqual(state.pipeline, raw.pipeline); assert.equal(inventory(root).runs.length, 1);
    assert.equal(isReadOnlyRun(state), true);
    assert.deepEqual(runActions(state, "saved", true), ["View", "Export Markdown", "Save report…"]);
    assert.deepEqual(runActions(state, "session", true), ["View", "Export Markdown", "Save report…"]);
    assert.match(progressLines(state, true).join("\n"), /read-only legacy/);
    assert.match(portableMarkdown(state), /UNVERIFIED DRAFT/);
    assert.match(portableMarkdown(state), /historical full\/extended/);
    const html = renderDashboard(state);
    assert.match(html, /Read-only legacy run/); assert.ok(html.includes("Preserved report"));
    assert.ok(!html.includes("PRIVATE-REVIEW-TEXT")); assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.throws(() => store.save(state), /read-only/);
    assert.throws(() => queueFeedback(state, "Do more work"), /read-only/);
    assert.throws(() => proposeBudgetTopUp(state, 15), /read-only/);
    const runner = new ResearchRunner(root, state, backend, driver);
    await assert.rejects(runner.run(), /read-only/);
    await assert.rejects(ResearchRunner.revise(root, { ...state, status: "done" }, "Revise", configSchema.parse({}), "test/mock", "off", backend, driver), /read-only/);
    assert.deepEqual(readFileSync(path), before); assert.equal(readFileSync(store.reportPath, "utf8"), raw.report);
    assert.equal(existsSync(join(raw.location.workspacePath, "research")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("legacy metadata or saved config cannot be hidden by changing only the profile", async () => {
  const root = mkdtempSync(join(tmpdir(), "light-only-mismatch-"));
  try {
    for (const changes of [{ config: { ...fixture().config, scope: "full" as const } }, { pipeline: {} }]) {
      const state: RunState = { ...fixture(), ...changes, profile: "light", status: "paused" };
      assert.equal(isReadOnlyRun(state), true);
      await assert.rejects(new ResearchRunner(root, state, backend, driver).run(), /read-only/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

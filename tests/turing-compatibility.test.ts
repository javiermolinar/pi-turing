import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalPath, createLocation, dataRoot, privateDirectory, requireLocation } from "../src/paths.ts";
import { loadConfig, RunStore } from "../src/store.ts";
import { renderDashboard } from "../src/dashboard.ts";
import { resolverCoverage } from "../src/acquisition.ts";
import { ScholarlyDiscovery } from "../src/scholarly.ts";
import { fixture } from "./fixtures.ts";

test("Turing config takes precedence without merging, rewriting, or silently falling back", () => {
  const root = mkdtempSync(join(tmpdir(), "turing-config-"));
  try {
    privateDirectory(join(root, ".pi"));
    assert.equal(loadConfig(root).searchProvider, "duckduckgo");
    const legacy = join(root, ".pi", "hyperresearch.json");
    const current = join(root, ".pi", "turing.json");
    const saved = JSON.stringify({ searchProvider: "kagi", budgetUsd: 21 });
    writeFileSync(legacy, saved);
    assert.equal(loadConfig(root).searchProvider, "kagi");
    writeFileSync(current, JSON.stringify({ searchProvider: "brave", budgetUsd: 9 }));
    assert.equal(loadConfig(root).searchProvider, "brave");
    assert.equal(loadConfig(root).budgetUsd, 9);
    writeFileSync(current, "{}");
    assert.equal(loadConfig(root).searchProvider, "duckduckgo", "New config does not inherit legacy settings");
    writeFileSync(current, "{");
    assert.throws(() => loadConfig(root), SyntaxError);
    writeFileSync(current, '{"budgetUsd":-1}');
    assert.throws(() => loadConfig(root));
    assert.equal(readFileSync(legacy, "utf8"), saved);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Turing preserves the storage identity and legacy overrides without moving saved runs", () => {
  const root = mkdtempSync(join(tmpdir(), "turing-storage-"));
  const old = { current: process.env.TURING_DATA_ROOT, legacy: process.env.HYPERRESEARCH_DATA_ROOT };
  try {
    delete process.env.TURING_DATA_ROOT; delete process.env.HYPERRESEARCH_DATA_ROOT;
    assert.equal(dataRoot(), canonicalPath(join(homedir(), ".pi", "hyperresearch")));
    process.env.HYPERRESEARCH_DATA_ROOT = root;
    const state = fixture(); state.location = createLocation(root, dataRoot());
    privateDirectory(state.location.workspacePath);
    const store = new RunStore(dataRoot(), state.tag); store.save(state);
    const before = readFileSync(join(store.dir, "pi-state.json"));
    process.env.TURING_DATA_ROOT = root;
    const saved = new RunStore(dataRoot(), state.tag).load();
    assert.deepEqual(requireLocation(saved, dataRoot()), state.location);
    assert.deepEqual(readFileSync(join(store.dir, "pi-state.json")), before);
    process.env.TURING_DATA_ROOT = join(root, "explicit-new-root");
    assert.equal(dataRoot(), canonicalPath(process.env.TURING_DATA_ROOT));
    assert.equal(dataRoot(root), canonicalPath(root), "Explicit arguments still take precedence");
    process.env.TURING_DATA_ROOT = "";
    assert.throws(() => dataRoot(), /TURING_DATA_ROOT.*absolute/);
  } finally {
    if (old.current === undefined) delete process.env.TURING_DATA_ROOT; else process.env.TURING_DATA_ROOT = old.current;
    if (old.legacy === undefined) delete process.env.HYPERRESEARCH_DATA_ROOT; else process.env.HYPERRESEARCH_DATA_ROOT = old.legacy;
    rmSync(root, { recursive: true, force: true });
  }
});

test("public dashboard branding and instructions use Turing", () => {
  const state = fixture(); state.status = "done"; state.report = "# Fixture";
  const html = renderDashboard(state);
  assert.match(html, /<title>Turing/);
  assert.match(html, /<b>◈<\/b> Turing<\/span>/);
  assert.match(html, /\/turing revise/);
  assert.doesNotMatch(html, /\/hyperresearch|>Hyperresearch/);
});

test("contact aliases retain approvals while canonical values take precedence", async () => {
  for (const env of [
    { TURING_CONTACT_EMAIL: "current@example.org" },
    { HYPERRESEARCH_CONTACT_EMAIL: "legacy@example.org" },
    { TURING_CONTACT_EMAIL: "current@example.org", HYPERRESEARCH_CONTACT_EMAIL: "legacy@example.org" },
  ]) {
    assert.equal(resolverCoverage(["unpaywall"], env)[0].available, true);
    const expected = env.TURING_CONTACT_EMAIL ?? env.HYPERRESEARCH_CONTACT_EMAIL;
    let calls = 0;
    const discovery = new ScholarlyDiscovery({ env, minIntervalMs: 0, fetchImpl: async (_url, options) => {
      calls++;
      assert.equal(new Headers(options?.headers).get("User-Agent"), `pi-turing mailto:${expected}`);
      return Response.json({ hits: { hits: [] } });
    } });
    const result = await discovery.search("fixture", ["edgar"], undefined, "filing");
    assert.equal(calls, 1); assert.equal(result.coverage[0].status, "ok");
  }
  const env = { TURING_CONTACT_EMAIL: "", HYPERRESEARCH_CONTACT_EMAIL: "legacy@example.org" };
  assert.equal(resolverCoverage(["unpaywall"], env)[0].available, false);
  assert.match(resolverCoverage(["unpaywall"], env)[0].reason!, /TURING_CONTACT_EMAIL/);
  const discovery = new ScholarlyDiscovery({ env, fetchImpl: async () => { throw new Error("Must not use the legacy value when explicitly disabled"); } });
  const result = await discovery.search("fixture", ["edgar"], undefined, "filing");
  assert.equal(result.coverage[0].status, "unavailable");
});

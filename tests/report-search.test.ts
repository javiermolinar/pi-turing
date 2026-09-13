import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RunStore } from "../src/store.ts";
import { searchReports } from "../src/report-search.ts";
import { fixture } from "./fixtures.ts";

test("report search is literal, case-insensitive, scoped to materialized Markdown, and read-only", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-report-search-"));
  const fetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error("Search must not access network"); };
  try {
    for (const tag of ["allowed", "private"]) { const state = fixture(); state.tag = tag; state.report = '# Title\n\nLiteral [.*] <script> untrusted'; new RunStore(root, tag).save(state); }
    const store = new RunStore(root, "allowed"); const before = readFileSync(join(store.dir, "pi-state.json"));
    writeFileSync(join(store.dir, "private-attachment.md"), "attachment-only");
    writeFileSync(store.reportPath, "# Materialized\nNeedle [.*] <script>\nneedle");
    const result = await searchReports(root, ["allowed"], "NEEDLE");
    assert.deepEqual(result.matches.map(match => [match.tag, match.line]), [["allowed", 2], ["allowed", 3]]);
    assert.equal((await searchReports(root, ["allowed"], "[.*]")).matches.length, 1);
    for (const query of ["Title", "attachment-only"]) assert.equal((await searchReports(root, ["allowed"], query)).matches.length, 0);
    assert.deepEqual(readFileSync(join(store.dir, "pi-state.json")), before);
  } finally { globalThis.fetch = fetch; rmSync(root, { recursive: true, force: true }); }
});

test("search bounds work/output, reports partial scans, handles deletions, cancels and rejects hostile paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-report-bounds-"));
  try {
    const state = fixture(); state.tag = "allowed"; state.report = "match\n".repeat(1000);
    const store = new RunStore(root, state.tag); store.save(state);
    const limited = await searchReports(root, [state.tag], "match", { maxResults: 3 });
    assert.equal(limited.matches.length, 3); assert.equal(limited.partial, true);
    assert.equal((await searchReports(root, [state.tag], "match", { maxBytes: 1 })).partial, true);
    await assert.rejects(searchReports(root, [state.tag], "match", { signal: AbortSignal.abort() }));
    for (const query of ["", "\n", "a".repeat(301)]) await assert.rejects(searchReports(root, [state.tag], query));
    await assert.rejects(searchReports(root, ["../escape"], "match"));
    rmSync(store.reportPath); assert.equal((await searchReports(root, [state.tag], "match")).matches.length, 0);
    const outside = join(root, "outside.md"); writeFileSync(outside, "match secret"); symlinkSync(outside, store.reportPath);
    const skipped = await searchReports(root, [state.tag], "match"); assert.equal(skipped.partial, true); assert.equal(skipped.matches.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

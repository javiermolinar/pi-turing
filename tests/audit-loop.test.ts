import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuditJournal, runEvidenceAudit, type AuditHost } from "../src/audit-loop.ts";
import { digestHash } from "../src/audit.ts";
import { fixture } from "./fixtures.ts";
import type { BackendAction } from "../src/backend.ts";
const body = "Observed throughput decreased by twenty percent in the tested workload.";
function setup(count = 12) {
  const state = fixture(); state.cost = 0; state.config.budgetUsd = 100;
  state.sources = [{ id: "study", title: "Measurement", url: "https://example.org/study", words: 12, fullRead: true, contentHash: digestHash(body) }];
  state.report = "# Findings\n\n" + Array.from({ length: count }, (_, index) => `Observation ${index + 1}: throughput decreased in this workload. [[study]]`).join("\n\n");
  const journal = createAuditJournal(); let calls = 0, saved = "", changedBody = false;
  const host: AuditHost = { state, journal, signal: new AbortController().signal,
    backend: { async call<T>(action: BackendAction, args?: Record<string, unknown>) {
      assert.equal(action, "check_passage"); const offset = body.indexOf(String(args!.text));
      return { matched: offset >= 0 && !changedBody, hash: changedBody ? "changed" : digestHash(body), offset: offset < 0 ? null : offset, units: "unicode" } as T;
    } },
    save() { saved = JSON.stringify({ state: host.state, journal: host.journal }); },
    async work(request) {
      calls++; host.state.cost += 0.1; host.save();
      request.coverage.add("study", digestHash(body), 0, body.length, body.length);
      if (request.kind === "correct") return { summary: "Correct numerical direction", edits: [{ oldText: "throughput increased", newText: "throughput decreased", reason: "The source reports a decrease" }] };
      const record = host.journal.records.at(-1)!;
      return { reviews: record.units.filter(unit => !record.reviews.some(review => review.unitId === unit.id)).slice(0, 10).map(unit => ({
        unitId: unit.id, verdict: unit.text.includes("increased") ? "contradicted" : "supported", reason: "Direction assessed against the complete observed source", passages: [{ sourceId: "study", quote: body }],
      })) };
    },
  };
  return { host, calls: () => calls, saved: () => JSON.parse(saved), changeBody: () => { changedBody = true; } };
}
test("bounded model assessments persist exact coverage and replay a passed audit without model calls", async () => {
  const env = setup(); const result = await runEvidenceAudit(env.host);
  assert.equal(result.status, "passed"); assert.equal(result.reviews.length, 12); assert.equal(env.calls(), 2);
  assert.equal(env.saved().journal.records[0].status, "passed");
  await runEvidenceAudit(env.host); assert.equal(env.calls(), 2);
});
test("corrections retain original findings and force a new complete audit of the patched report", async () => {
  const env = setup(); env.host.state.report = env.host.state.report!.replace("throughput decreased", "throughput increased");
  const result = await runEvidenceAudit(env.host);
  assert.equal(result.status, "passed"); assert.equal(env.host.journal.records.length, 2); assert.equal(env.host.journal.corrections.length, 1);
  assert.ok(env.host.journal.records[0].findings.some(finding => finding.kind === "contradicted"));
  assert.notEqual(env.host.journal.records[0].reportHash, result.reportHash);
  assert.equal(env.calls(), 5); // Two initial batches, one correction, two fresh assessment batches.
});
test("exhausted correction allowance preserves findings and blocks without a rewrite", async () => {
  const env = setup(); env.host.journal.maxCorrections = 0;
  env.host.state.report = env.host.state.report!.replace("throughput decreased", "throughput increased");
  await assert.rejects(runEvidenceAudit(env.host), /Unresolved evidence findings/);
  assert.equal(env.host.journal.records[0].status, "findings"); assert.equal(env.calls(), 2);
  assert.match(env.host.state.report!, /increased/);
});
test("pause/resume retains completed batches rather than repeating model assessments", async () => {
  const env = setup(23); const work = env.host.work;
  let attempts = 0; const controller = new AbortController(); env.host.signal = controller.signal;
  env.host.work = async request => { if (++attempts === 2) { controller.abort(new Error("paused")); controller.signal.throwIfAborted(); } return work(request); };
  await assert.rejects(runEvidenceAudit(env.host), /paused/);
  assert.equal(env.host.journal.records[0].reviews.length, 10); assert.equal(env.calls(), 1);
  const checkpoint = env.saved(); env.host.state = checkpoint.state; env.host.journal = checkpoint.journal;
  // Bind the resumed fixture worker to the restored host, as an actual runner does.
  env.host.signal = new AbortController().signal; env.host.work = work;
  const result = await runEvidenceAudit(env.host);
  assert.equal(result.reviews.length, 23); assert.equal(result.status, "passed"); assert.equal(env.calls(), 3);
});
test("pause after atomic patch publication resumes with re-audit, not another correction", async () => {
  const env = setup(); env.host.state.report = env.host.state.report!.replace("throughput decreased", "throughput increased");
  const controller = new AbortController(); env.host.signal = controller.signal; const save = env.host.save;
  env.host.save = () => { save(); if (env.host.journal.corrections.length) controller.abort(new Error("paused after patch")); };
  await assert.rejects(runEvidenceAudit(env.host), /paused after patch/);
  assert.equal(env.calls(), 3); assert.equal(env.host.journal.corrections.length, 1);
  const checkpoint = env.saved(); env.host.state = checkpoint.state; env.host.journal = checkpoint.journal;
  env.host.signal = new AbortController().signal; env.host.save = save;
  assert.equal((await runEvidenceAudit(env.host)).status, "passed"); assert.equal(env.calls(), 5);
  assert.equal(env.host.journal.corrections.length, 1);
});
test("pause during correction does not publish an unaccepted patch or reset spend", async () => {
  const env = setup(); env.host.state.report = env.host.state.report!.replace("throughput decreased", "throughput increased");
  const controller = new AbortController(); env.host.signal = controller.signal; const work = env.host.work;
  env.host.work = async request => { const result = await work(request); if (request.kind === "correct") controller.abort(new Error("paused during correction")); return result; };
  await assert.rejects(runEvidenceAudit(env.host), /paused during correction/);
  assert.equal(env.host.journal.corrections.length, 0); assert.match(env.host.state.report!, /increased/);
  const spent = env.host.state.cost; env.host.signal = new AbortController().signal; env.host.work = work;
  assert.equal((await runEvidenceAudit(env.host)).status, "passed"); assert.equal(env.calls(), 6);
  assert.ok(env.host.state.cost > spent); assert.equal(env.host.journal.corrections.length, 1);
});
test("budget exhaustion cannot mark required review complete or start a correction", async () => {
  const env = setup(); env.host.state.config.budgetUsd = 0.1;
  await assert.rejects(runEvidenceAudit(env.host), /cost ceiling/);
  assert.equal(env.calls(), 1); assert.equal(env.host.journal.records[0].status, "running"); assert.equal(env.host.journal.records[0].reviews.length, 0);
  assert.equal(env.host.journal.corrections.length, 0);
});
test("changed evidence invalidates a passed ledger before any new model request", async () => {
  const env = setup(); await runEvidenceAudit(env.host); env.changeBody();
  await assert.rejects(runEvidenceAudit(env.host), /Saved evidence changed/);
  assert.equal(env.host.journal.records[0].status, "incomplete"); assert.equal(env.calls(), 2);
});
test("changed saved unit coverage is not accepted as an exhaustive current audit", async () => {
  const env = setup(); await runEvidenceAudit(env.host); env.host.journal.records[0].units.pop();
  await assert.rejects(runEvidenceAudit(env.host), /coverage no longer matches/); assert.equal(env.calls(), 2);
});

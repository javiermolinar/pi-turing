import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { answerCoverage, assessmentMetric, assessmentIsCurrent, assessmentSchema, needsRepair, reportHash, requirementRating, validateAssessment } from "../src/assessment.ts";
import { renderDashboard } from "../src/dashboard.ts";
import { renderMain } from "../web/render.ts";
import { portableMarkdown } from "../src/export.ts";
import { scheduledSteps, stateSchema, stepIds } from "../src/types.ts";
import { fixture, assessmentFixture } from "./fixtures.ts";

function assessedState() {
  const state = fixture(); state.status = "done";
  state.report = "# Report\n\nA comparison with explicit limits. [[sqlite-wal]]";
  state.assessmentVersion = 1;
  state.steps = Object.fromEntries(stepIds.map(id => [id, "done"]));
  state.assessment = { reportHash: reportHash(state.report), assessedAt: state.updatedAt, sourceHashes: {}, result: assessmentFixture(state.report) };
  return state;
}

test("coverage distinguishes missing, partial and justified evidence limits without averaging central omissions", () => {
  const result = assessmentFixture("Report");
  assert.equal(answerCoverage(result), "Complete"); assert.equal(needsRepair(result), false);
  result.requirements[0].status = "evidence-limited";
  assert.equal(requirementRating(result.requirements[0].status), 2); assert.equal(answerCoverage(result), "Complete");
  result.requirements[0].status = "partial";
  assert.equal(answerCoverage(result), "Partial"); assert.equal(needsRepair(result), true);
  result.requirements.push({ ...result.requirements[0], status: "answered", importance: "supporting" });
  result.requirements[0].status = "missing";
  assert.equal(answerCoverage(result), "Incomplete");
});

test("main-row metric derives status without treating zero findings or absent checks as a perfect score", () => {
  const state = assessedState(); const result = state.assessment!.result;
  assert.equal(assessmentMetric(state).status, "partially-assessed");
  result.evidenceSupport.verdict = "pass";
  assert.equal(assessmentMetric(state).status, "partially-assessed", "No checked claims cannot become a clean assessment");
  result.claims = [{ passage: "A comparison with explicit limits.", sourceIds: ["sqlite-wal"], verdict: "supported", rationale: "Supported in the fixture." }];
  assert.deepEqual(assessmentMetric(state), { status: "no-issues-found", label: "No issues found", detail: "1/1 requirements · 1 claim checked" });
  result.requirements[0].status = "evidence-limited";
  assert.equal(assessmentMetric(state).status, "no-issues-found", "Justified evidence limits can answer a question");
  for (const dimension of [result.constraintFit, result.reasoning, result.evidenceSupport]) {
    dimension.verdict = "not-assessed"; assert.equal(assessmentMetric(state).status, "partially-assessed");
    dimension.verdict = "needs-attention"; assert.equal(assessmentMetric(state).status, "needs-attention");
    dimension.verdict = "pass";
  }
  result.requirements[0].status = "partial";
  assert.equal(assessmentMetric(state).status, "needs-attention");
  assert.match(assessmentMetric(state).detail!, /^0\/1 requirements/);
  result.requirements[0].status = "missing"; assert.equal(assessmentMetric(state).status, "needs-attention");
  result.requirements[0].status = "answered";
  result.findings.push({ category: "reasoning", passage: "", rationale: "Unresolved issue", suggestedFix: "Qualify the claim." });
  assert.equal(assessmentMetric(state).status, "needs-attention");
  result.findings = [];
  result.claims[0].verdict = "unclear"; assert.equal(assessmentMetric(state).status, "needs-attention");
  state.report += " Change";
  assert.deepEqual(assessmentMetric(state), { status: "stale", label: "Stale" }, "Stale results must not show current coverage counts");
});

test("main-row metric distinguishes pending, unassessed and legacy runs", () => {
  const state = fixture();
  assert.deepEqual(assessmentMetric(state), { status: "not-assessed", label: "Not assessed" });
  state.assessmentVersion = 1;
  for (const status of ["running", "paused", "blocked"] as const) {
    state.status = status; assert.equal(assessmentMetric(state).status, "pending");
  }
  for (const status of ["done", "failed", "aborted"] as const) {
    state.status = status; assert.equal(assessmentMetric(state).status, "not-assessed");
  }
  const archived = assessedState(); archived.profile = "full";
  assert.equal(assessmentMetric(archived).status, "not-assessed");
  assert.equal(parseHTML(renderMain(archived)).document.querySelector(".assessment-metric a"), null, "Historical runs have no final-assessment panel to link to");
});

test("assessment rejects fabricated passages, missing answer evidence and unsupported passing verdicts", () => {
  const result = assessmentFixture("Report"); const ids = new Set(["source-1"]);
  validateAssessment(result, "Report", ids, ids);
  result.requirements[0].passages = ["Not in the report"];
  assert.throws(() => validateAssessment(result, "Report", ids, ids), /exact report/);
  result.requirements[0].passages = [];
  assert.throws(() => validateAssessment(result, "Report", ids, ids), /require supporting/);
  result.requirements[0].passages = ["Report"];
  result.evidenceSupport.verdict = "pass";
  assert.throws(() => validateAssessment(result, "Report", ids, ids), /must be not-assessed/);
  result.claims = [{ passage: "Report", sourceIds: ["source-1"], verdict: "unsupported", rationale: "Contradicted by the source." }];
  assert.throws(() => validateAssessment(result, "Report", ids, ids), /cannot pass/);
  result.evidenceSupport.verdict = "needs-attention";
  assert.throws(() => validateAssessment(result, "Report", new Set(), ids), /requires a cited source/);
  validateAssessment(result, "Report", ids, ids);
  assert.throws(() => assessmentSchema.parse({ ...result, edits: [] }), /Unrecognized key/);
});

test("assessment records round-trip and become stale on report, evidence or steering changes", () => {
  const state = assessedState(); assert.ok(assessmentIsCurrent(state));
  assert.deepEqual(stateSchema.parse(state).assessment, state.assessment);
  state.report += " Changed"; assert.equal(assessmentIsCurrent(state), false);
  state.report = state.report!.replace(" Changed", "");
  state.assessment!.sourceHashes["sqlite-wal"] = "original";
  state.sources[0].contentHash = "changed"; assert.equal(assessmentIsCurrent(state), false);
  state.sources[0].contentHash = "original"; assert.ok(assessmentIsCurrent(state));
  state.feedback.push({ id: 1, text: "New requirement", status: "queued", createdAt: state.updatedAt });
  assert.equal(assessmentIsCurrent(state), false);
  assert.equal(scheduledSteps(fixture()).length, 5); assert.equal(scheduledSteps(state).length, 8);
});

test("dashboard shows separate final judgments and unresolved findings, escapes model text, and marks old runs unassessed", () => {
  const state = assessedState();
  const result = state.assessment!.result;
  result.requirements[0].status = "partial";
  result.reasoning.verdict = "needs-attention";
  result.findings.push({ category: "reasoning", passage: "", rationale: "<script>alert('x')</script>", suggestedFix: "Do not infer causation." });
  const { document } = parseHTML(renderMain(state));
  const metric = document.querySelector(".assessment-metric")!;
  assert.equal(document.querySelectorAll(".metrics > div").length, 5);
  assert.equal(metric.getAttribute("data-assessment-status"), "needs-attention");
  assert.equal(metric.querySelector("a")!.getAttribute("href"), "#final-assessment");
  assert.equal(metric.querySelector("a")!.getAttribute("data-open-details"), "final-assessment");
  assert.match(metric.textContent!, /Needs attention/);
  assert.match(metric.textContent!, /0\/1 requirements · 0 claims checked/);
  const panel = document.querySelector("#final-assessment")!;
  assert.ok(panel.hasAttribute("open"));
  assert.match(panel.textContent!, /Answer coverage: Partial/);
  assert.match(panel.textContent!, /Evidence support \(selected claims\): Not assessed/);
  assert.match(panel.textContent!, /Reasoning: Needs attention/);
  assert.equal(panel.querySelector("script"), null);
  assert.match(panel.textContent!, /not proof of factual accuracy/);
  assert.match(renderMain(fixture()), /Not assessed — original workflow/);
  assert.match(renderMain({ ...state, report: "Changed" }), /Stale — report, evidence or instructions changed/);
});

test("Markdown and offline HTML retain assessment limitations without changing the saved report", () => {
  const state = assessedState(); const original = state.report;
  const output = portableMarkdown(state);
  assert.match(output, /Final model assessment/);
  assert.match(output, /Evidence support \(selected claims\): not-assessed/);
  assert.match(output, /not a full citation audit/);
  const { document } = parseHTML(renderDashboard(state));
  assert.match(document.querySelector("#final-assessment > summary")!.textContent!, /Answer coverage: Complete/);
  assert.ok(!document.querySelector("#final-assessment > summary")!.textContent!.includes("Stale"));
  assert.equal(document.querySelector(".assessment-metric")!.getAttribute("data-assessment-status"), "partially-assessed");
  assert.equal(state.report, original);
});

test("assessment exports do not expose local source titles or attachment paths", () => {
  const state = assessedState();
  state.sources.push({ id: "local-evidence", origin: "local", title: "/private/internal-design.md", url: "file:///private/internal-design.md", words: 100, fullRead: true });
  state.assessment!.result.claims.push({ passage: "A comparison with explicit limits.", sourceIds: ["local-evidence"], verdict: "unclear", rationale: "Local evidence is not external corroboration." });
  const markdown = portableMarkdown(state);
  assert.ok(!markdown.includes("/private/internal-design.md"));
  assert.match(markdown, /Local\/nonportable evidence — not included/);
});

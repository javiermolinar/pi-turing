import { answerCoverage, assessmentDisclaimer, requirementRating, assessmentIsCurrent, assessmentMetric, type AssessmentRecord } from "../src/assessment.ts";
import type { RunState } from "../src/types.ts";

// All model text is escaped; nothing here is trusted HTML or Markdown.
export function renderAssessments(state: RunState, escape: (value: unknown) => string, finalCurrent = assessmentIsCurrent(state)): string {
  const e = escape;
  const card = (record: AssessmentRecord, final: boolean) => {
    const result = record.result;
    const coverage = answerCoverage(result);
    const label = (verdict: string) => ({ pass: "Pass", "needs-attention": "Needs attention", "not-assessed": "Not assessed" })[verdict] ?? verdict;
    const attention = coverage !== "Complete" || [result.constraintFit, result.reasoning, result.evidenceSupport].some(item => item.verdict === "needs-attention") || result.findings.length > 0;
    return `<details class="card supporting-panel assessment-panel" data-details-key="${final ? "final-assessment" : "draft-review"}" id="${final ? "final-assessment" : "draft-review"}"${final && attention ? " open" : ""}>
      <summary>${final ? "Final assessment" : "Post-draft review"} <span>${final && !finalCurrent ? "Stale — report, evidence or instructions changed" : `Answer coverage: ${e(coverage)} · Evidence: ${e(label(result.evidenceSupport.verdict))}`}</span></summary>
      <p class="footnote">${e(assessmentDisclaimer)}${final ? " This assessment is read-only; findings do not trigger automatic repairs." : " Historical draft findings, before repair and polish; not a grade of the final report."}</p>
      <p>${e(result.summary)}</p>
      <h3>Answer coverage: ${e(coverage)}</h3><p class="footnote">0 Missing · 1 Partial · 2 Addressed (including justified evidence limits). Central omissions cannot be averaged away.</p>
      <ol class="assessment-requirements">${result.requirements.map(item => `<li><strong>${requirementRating(item.status)}/2 · ${e(item.question)}</strong><small>${e(item.importance)} · ${e(item.status)}</small><p>${e(item.rationale)}</p>${item.passages.map(text => `<blockquote>${e(text)}</blockquote>`).join("")}</li>`).join("")}</ol>
      <h3>Separate judgments</h3>${([["Constraint fit", result.constraintFit], ["Reasoning", result.reasoning], ["Evidence support (selected claims)", result.evidenceSupport]] as const).map(([title, item]) => `<div class="assessment-judgment"><strong>${title}: ${e(label(item.verdict))}</strong><p>${e(item.rationale)}</p>${item.passages.map(text => `<blockquote>${e(text)}</blockquote>`).join("")}</div>`).join("")}
      ${result.findings.length ? `<h3>${final ? "Remaining findings" : "Repair findings"}</h3><ol>${result.findings.map(item => `<li><strong>${e(item.category)}</strong><p>${e(item.rationale)}</p>${item.passage ? `<blockquote>${e(item.passage)}</blockquote>` : ""}<p>Suggested correction: ${e(item.suggestedFix)}</p></li>`).join("")}</ol>` : ""}
      <details data-details-key="${final ? "final" : "draft"}-claim-checks"><summary>Source-support checks (${result.claims.length})</summary>${result.claims.length ? `<ol>${result.claims.map(item => `<li><strong>${e(item.verdict)}</strong><blockquote>${e(item.passage)}</blockquote><p>${e(item.rationale)}</p><small>Sources: ${item.sourceIds.map(id => e(state.sources.find(source => source.id === id)?.title ?? id)).join("; ")}</small></li>`).join("")}</ol>` : '<p class="empty">Evidence support was not assessed.</p>'}</details>
      <small>Recorded ${e(record.assessedAt)} · Report hash ${e(record.reportHash.slice(0, 12))}</small>
    </details>`;
  };
  return `${state.assessment ? card(state.assessment, true) : `<details class="card supporting-panel" data-details-key="final-assessment" id="final-assessment"><summary>Final assessment <span>${state.assessmentVersion ? assessmentMetric(state).label : "Not assessed — original workflow"}</span></summary><p class="footnote">${e(assessmentDisclaimer)}</p></details>`}${state.review ? card(state.review, false) : ""}${state.patches.repair ? `<details class="card supporting-panel" data-details-key="substantive-repair"><summary>Bounded repair <span>${state.patches.repair.edits.length} edits</span></summary><p>${e(state.patches.repair.summary)}</p></details>` : ""}`;
}

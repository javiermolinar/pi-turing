import { renderReport, reportSourceIds } from "../src/report.ts";
import { activityAge } from "../src/progress.ts";
import { feedbackSummary } from "../src/feedback.ts";
import type { FeedbackControl } from "../src/dashboard-controls.ts";
import { stepIds as lightSteps, stepNames, stages, isReadOnlyRun, type StepId, type RunState, type Worker } from "../src/types.ts";

export const escapeHtml = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const e = escapeHtml;
const money = (n: number) => `$${n.toFixed(2)}`;
const duration = (ms: number) => `${Math.floor(ms / 60_000)}m ${Math.floor(ms / 1000) % 60}s`;
const badge = (status: string) => `<span class="badge ${e(status)}">${e(status)}</span>`;
const stageMessages: Partial<Record<StepId, string>> = {
  "1": "Framing the question.", "2": "Following sources. Checking the gaps.",
  "10": "Turning the evidence into a draft.", "15": "Tightening the argument.", "16": "Giving the report a final read.",
};
function workerCards(state: RunState, workers: Worker[], running: boolean): string {
  return workers.map(worker => {
    const status = worker.status === "running" && !running ? "Recorded running; not live" : worker.status === "done" ? "Completed" : worker.status;
    const glyph = { done: "✓", running: "●", failed: "!", interrupted: "Ⅱ" }[worker.status];
    const share = state.pricingKnown && state.cost > 0 ? Math.max(0, Math.min(100, worker.cost / state.cost * 100)) : undefined;
    return `<details class="worker-card" data-details-key="worker-${e(worker.id)}"><summary><span class="worker-name"><span class="worker-state ${e(worker.status)}${running && worker.status === "running" ? " is-active" : ""}" role="img" aria-label="${e(status)}" title="${e(status)}">${glyph}</span><strong>${e(worker.id)}</strong></span><small>${worker.turns} turns · ${state.pricingKnown ? money(worker.cost) : "Cost unknown"}</small></summary>
      <p>${e(worker.task)}</p><p class="worker-activity">${e(worker.error ?? worker.activity ?? "No activity recorded.")}</p><small>${worker.tokens.toLocaleString("en-US")} tokens</small>
      <div class="worker-spend"><div class="spend-label"><span>${state.pricingKnown ? money(worker.cost) : "Unknown"}</span><small>${share === undefined ? "—" : `${Math.round(share)}% of run`}</small></div>${share === undefined ? `<span class="spend-unavailable">${state.pricingKnown ? "No spend yet" : "Pricing unavailable"}</span>` : `<meter min="0" max="100" value="${share.toFixed(2)}" aria-label="${e(worker.id)}: ${Math.round(share)}% of reported model spend" title="${money(worker.cost)} of ${money(state.cost)} reported model spend">${Math.round(share)}%</meter>`}</div></details>`;
  }).join("");
}
function pipelineStages(state: RunState, ids: readonly string[], stageName: (id: string) => string, running: boolean): string {
  const assigned = new Set<Worker>();
  const items = ids.map((id, index) => {
    const workers = state.workers.filter(worker => stages[worker.role] === id);
    workers.forEach(worker => assigned.add(worker));
    const active = running && state.steps[id] === "running";
    const complete = state.steps[id] === "done";
    const status = active ? '<span class="stage-dot" aria-hidden="true"></span> In progress' : e(state.steps[id] === "running" ? "Recorded running" : complete ? "" : "Pending");
    const warnings = ["failed", "interrupted"].map(status => { const count = workers.filter(worker => worker.status === status).length; return count ? `${count} ${status}` : ""; }).filter(Boolean);
    return `<li class="${e(state.steps[id])}${active ? " is-active" : ""}"${active ? ' aria-current="step"' : ""}><details data-details-key="stage-${e(id)}"><summary><span class="step-number" data-stage-number="${index + 1}"${complete ? ' role="img" aria-label="Complete"' : ""}>${complete ? "✓" : index + 1}</span><span class="stage-label"><strong>${e(stageName(id))}</strong><small>${status ? status + " · " : ""}${workers.length} ${workers.length === 1 ? "worker" : "workers"}</small>${warnings.length ? `<small class="stage-warning">${warnings.join(" · ")}</small>` : ""}</span></summary><div class="stage-workers">${workers.length ? workerCards(state, workers, running) : '<p class="empty">No workers recorded for this stage.</p>'}</div></details></li>`;
  }).join("");
  const unassigned = state.workers.filter(worker => !assigned.has(worker));
  return `<ol class="stage-list">${items}</ol>${unassigned.length ? `<details data-details-key="unassigned-workers"><summary>Other recorded workers (${unassigned.length})</summary>${workerCards(state, unassigned, running)}</details>` : ""}`;
}
function sourceLink(url: string, label: string): string {
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    return `<a href="${e(parsed.href)}" target="_blank" rel="noopener noreferrer">${e(label)}</a>`;
  } catch { return e(label); }
}

// Display-only matching, using the fetcher's URL identity rules: fragments do
// not identify different bytes, but query strings, paths, and schemes do.
function fetchUrlKey(raw: string): string | undefined {
  if (raw.length > 2048 || /[\x00-\x20\x7f]/.test(raw)) return;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
    url.hash = "";
    return url.href;
  } catch { return; }
}
function fetchHistory(state: RunState) {
  const available = new Set(state.sources.filter(source => (!source.origin || source.origin === "public") && !source.integration)
    .map(source => fetchUrlKey(source.url)).filter((url): url is string => url !== undefined));
  const attempts = state.failures.map(failure => {
    const key = fetchUrlKey(failure.url);
    return { ...failure, recovered: key !== undefined && available.has(key) };
  });
  const recovered = attempts.filter(attempt => attempt.recovered).length;
  return { attempts, recovered, unresolved: attempts.length - recovered };
}

export interface RevisionLinks {
  parent?: RunState;
  children: RunState[];
  partial?: boolean;
}
function runLink(run: RunState): string {
  return `<a href="?run=${e(encodeURIComponent(run.tag))}" data-related-run="${e(run.tag)}">${e(run.decomposition?.title ?? run.query)}</a>`;
}
function revisionHistory(state: RunState, links?: RevisionLinks): string {
  if (!state.revision && !links?.children.length && !links?.partial) return "";
  return `<details class="card revision-history" data-details-key="revision-history"><summary>Revision details</summary>
    ${state.revision ? `<p class="footnote">The parent report was supplied as context; its evidence was not rechecked.</p>${!links?.parent ? `<p class="footnote">Open the parent in Pi:</p><code class="command">/turing dashboard ${e(state.revision.parentTag)}</code>` : ""}${state.revision.instructions.length ? `<details data-details-key="inherited-steering"><summary>Inherited steering (${state.revision.instructions.length})</summary><ol>${state.revision.instructions.map(text => `<li>${e(text)}</li>`).join("")}</ol></details>` : ""}` : ""}
    ${links?.children.length ? `<div class="revision-entry"><strong>Follow-up revisions</strong><ul>${links.children.map(child => `<li>${runLink(child)}<small>${e(child.createdAt.slice(0, 10))} · ${e(child.status)}</small>${child.feedback[0] ? `<p class="revision-request">${e(child.feedback[0].text)}</p>` : ""}</li>`).join("")}</ul></div>` : ""}
    ${links?.partial ? `<p class="footnote">Partial inventory; some revisions may be missing.</p>` : ""}
  </details>`;
}

function feedbackComposer(state: RunState, control: FeedbackControl): string {
  const revision = state.status === "done";
  const label = revision ? "Revise or follow up" : "Steer research";
  const budget = control.spendingApproval ? control.spendingApproval.budgetUsd : state.config.budgetUsd;
  const ceiling = budget === null ? "No model ceiling" : `$${budget} model ceiling`;
  const explanation = control.reason ?? (revision
    ? `Clicking authorizes ${budget === null ? "unlimited model spending" : "new model spending at the displayed ceiling"}. The original report stays unchanged. Search fees are separate.${budget === null ? "" : " In-flight calls may exceed the ceiling."}${state.inputs ? " Renew private-context permissions separately in Pi." : ""}`
    : state.status === "paused" ? "Saves guidance on this investigation. Research stays paused until you resume it in Pi."
    : "Queues guidance for the next stage boundary on this investigation. Current workers continue; existing spend is retained.");
  return `<form class="feedback-composer" id="feedback-form" data-feedback-mode="${e(control.mode ?? "")}"${control.spendingApproval ? ` data-spending-approval="${e(JSON.stringify(control.spendingApproval))}"` : ""} data-context-approval="${!!state.inputs}">
    <label for="feedback-text">${label}</label><p class="footnote" id="feedback-help">${e(explanation)}</p>
    <textarea id="feedback-text" name="feedback" rows="5" maxlength="4000" required aria-describedby="feedback-help" placeholder="${revision ? "What should the next investigation change or explore?" : "What should this investigation focus on?"}"${control.mode ? "" : " disabled"}></textarea>
    <button type="submit" class="primary-action"${control.mode ? "" : " disabled"}>${revision ? `Start follow-up · ${e(ceiling)}` : state.status === "paused" ? "Save guidance" : "Queue guidance"}</button>
    ${revision ? `<details class="followup-settings" data-details-key="followup-settings"><summary>Uses saved model and search settings</summary><p class="footnote">Model: ${e(state.model)}. Role overrides: ${e(JSON.stringify(state.config.models))}. Search: ${e(state.config.searchProvider)}. Project: ${e(state.location?.projectPath ?? "Unavailable")}.</p></details>` : ""}
    <p id="feedback-status" class="footnote" role="status" aria-live="polite"></p>
  </form>`;
}

/** This HTML is generated only by the host. No source or model HTML is trusted. */
export function renderMain(state: RunState, runnerLive = false, revisions?: RevisionLinks, control?: FeedbackControl): string {
  const archived = isReadOnlyRun(state);
  if (archived) runnerLive = false;
  const stepIds: readonly string[] = archived ? Object.keys(state.steps) : lightSteps;
  const stageName = (id: string) => archived ? id : stepNames[id as StepId];
  const active = stepIds.find(id => state.steps[id] === "running");
  const read = state.sources.filter(s => s.fullRead).length;
  const cited = new Set(reportSourceIds(state.report ?? "", state.sources));
  const fetches = fetchHistory(state);
  const reportStatus = !state.report ? "Awaiting draft" : state.reportStale ? "Stale draft" : archived ? "Historical report" : state.checks.some(check => !check.ok) ? "Checks failed" : state.status === "done" && state.checks.length ? "Checks passed" : "Draft";
  const running = runnerLive && state.status === "running";
  const statusLabel = { running: running ? "In progress" : "Recorded running — not live", done: "Complete", paused: "Paused", aborted: "Cancelled", failed: "Failed", blocked: "Blocked" }[state.status];
  const statusIcon = { running: "○", done: "✓", paused: "Ⅱ", aborted: "×", failed: "!", blocked: "!" }[state.status];
  return `<div class="run-overview"><header class="run-header"><div class="eyebrow">Research notebook / ${e(state.profile)}${state.report ? `<a class="report-jump" href="#report-preview">Read report ↓</a>` : ""}</div><h1>${e(state.decomposition?.title ?? state.query)}</h1>
    <div class="run-status-row" data-run-live="${running}"><span class="run-state ${e(state.status)}"><span aria-hidden="true" class="${running ? "run-spinner is-active" : "status-icon"}">${running ? "" : statusIcon}</span><strong>${e(statusLabel)}</strong></span>${running && active ? `<span class="status-stage">${e(stageName(active))}</span>` : ""}<span class="stage-completion">${stepIds.filter(id => state.steps[id] === "done").length} of ${stepIds.length} stages complete</span></div>
    <p class="query">${e(state.query)}</p>
  </header>
  ${archived ? `<div class="notice">Read-only legacy run. Full/extended execution has been removed. Saved reports, costs and historical checks remain available; this version does not revalidate them.</div>` : ""}
  ${state.reason ? `<div class="notice" role="status">${e(state.reason)}</div>` : ""}
  <section class="metrics" aria-label="Run metrics">
    <div><span>Sources</span><strong class="source-count">${cited.size} cited<small> · ${read} read</small></strong>${fetches.attempts.length ? `<small><a class="${fetches.unresolved ? "metric-warning" : "metric-recovered"}" href="#failed-fetches" data-open-details="failed-fetches">${fetches.unresolved ? `! ${fetches.unresolved} unresolved fetch ${fetches.unresolved === 1 ? "attempt" : "attempts"}${fetches.recovered ? ` · ${fetches.recovered} recovered` : ""}` : `${fetches.recovered} recovered fetch ${fetches.recovered === 1 ? "attempt" : "attempts"}`}</a></small>` : ""}</div>
    <div><span><a href="#run-details" data-open-details="run-details">Model cost</a></span><strong class="numeric"${state.pricingKnown ? ` data-counter="cost" data-value="${state.cost}"` : ""}>${state.pricingKnown ? "~" + money(state.cost) : "Unknown"}</strong></div>
    <div><span>Tokens</span><strong class="numeric" data-counter="tokens" data-value="${state.tokens}">${state.tokens.toLocaleString("en-US")}</strong></div>
    <div><span>Run time</span><strong class="numeric">${duration(state.elapsedMs)}</strong></div>
  </section></div>
  <div class="layout">
  <aside class="pipeline sidebar" aria-label="Pipeline"><details class="sidebar-panel" data-details-key="pipeline-panel" open><summary>Pipeline</summary><div class="sidebar-body"><p class="sidebar-meta">${stepIds.length} stages · ${running ? `${state.workers.filter(w => w.status === "running").length} active workers` : `${state.workers.length} recorded workers`}</p>
    ${running ? `<div class="live-progress"><p class="stage-message">${e(active ? stageMessages[active as StepId] ?? "Working through the research." : "Checking the report’s required gates.")}<span class="working-ellipsis" aria-hidden="true"> · · ·</span></p><div class="activity-detail"><span>${e(state.activity?.text ?? "Waiting for worker activity")}</span><small data-activity-at="${e(state.activity?.at ?? "")}">${e(activityAge(state))}</small></div></div>` : ""}
    ${pipelineStages(state, stepIds, stageName, running)}
    <details class="card" data-details-key="pipeline-notes" id="run-details"><summary>Run details</summary><p class="footnote">Model: ${e(state.model)}. ${state.config.budgetUsd === null ? "No model-cost ceiling." : `Cost ceiling: ~${money(state.config.budgetUsd)}.`} Model usage updates after turns; search fees are excluded. Run time counts active execution.</p>${archived ? '<p class="footnote">Historical stage records; execution is unavailable.</p>' : ""}<p class="footnote">Worker bars use the entire run’s reported model spend. Activity shows turn counts and the latest update, not full transcripts.</p></details>
  </div></details></aside>
  <div class="content">
    <section class="card report-sheet" id="report-preview"><div class="section-header"><h2>Report</h2><span><a class="report-status" href="#verification" data-open-details="verification">${reportStatus}</a></span></div>${state.checks.some(check => !check.ok) ? `<p class="report-warning" role="status">Failed checks: ${state.checks.filter(check => !check.ok).map(check => e(check.name)).join(", ")}. <a href="#verification" data-open-details="verification">Review verification details</a>.</p>` : ""}${state.report ? `<article class="report">${renderReport(state.report, state.sources)}</article>` : `<div class="report-placeholder"><h3>The report will appear here</h3><p>${running ? "Research is in progress. Inspect stages in the pipeline while the first draft is prepared." : "No draft has been saved. Recorded progress is available in the pipeline."}</p></div>`}</section>
    ${state.discoveries?.length ? `<details class="card supporting-panel" data-details-key="scholarly-discovery"><summary>Scholarly discovery <span>${state.discoveries.length} queries · ${state.discoveries.flatMap(batch => batch.coverage).filter(provider => provider.status === "failed").length} failed provider calls</span></summary><p class="footnote">Metadata and abstracts are leads, never full-read evidence or independent corroboration. Complete provenance and coverage are retained in the checkpoint. Showing the latest five queries.</p>${state.discoveries.slice(-5).map((batch, index) => `<details data-details-key="discovery-${Math.max(0, state.discoveries!.length - 5) + index}"><summary>${e(batch.query)}</summary><ul>${batch.coverage.map(provider => `<li>${e(provider.provider)} ${badge(provider.status)} · ${provider.count} records${provider.cached ? " · cached" : ""}${provider.skipped ? ` · ${provider.skipped} skipped` : ""}${provider.error ? ` · ${e(provider.error)}` : ""}</li>`).join("")}</ul>${batch.results.length ? `<ul class="discovery-results">${batch.results.map(work => `<li>${sourceLink(work.url, work.title)} <small>${e(work.workType)} · ${e(work.version)} version${work.retracted ? " · Retracted" : ""}</small></li>`).join("")}</ul>` : `<p class="empty">No discovery results returned.</p>`}${batch.uncertainMatches.length ? `<p>${batch.uncertainMatches.length} uncertain/shared-identity matches; do not count them as independent sources.</p>` : ""}</details>`).join("")}</details>` : ""}
    <details class="card supporting-panel" data-details-key="sources" id="source-details"><summary>Sources <span>${cited.size} cited · ${read} read · ${state.sources.length} collected</span></summary><p class="footnote">Cited counts distinct saved sources referenced by citations or resolved Markdown links in this report, including local/private evidence. Repeated references count once.</p>
      <div class="table-wrap"><table id="sources"><thead><tr><th>Source</th><th>Retrieved</th><th>Words</th><th>Read</th></tr></thead><tbody>${state.sources.map((s, index) => `<tr><td>[${index + 1}] ${sourceLink(s.url, s.title)}${cited.has(s.id) ? '<small class="source-cited">Cited in report</small>' : ""}${s.origin === "local" ? "<small>Local evidence — not independent external corroboration</small>" : s.integration ? `<small>Scoped document · ${e(s.integration.bindingId)} · ${e(s.integration.version ?? "version unknown")} · ${e(s.integration.visibility)}</small>` : ""}<small>${e(s.url)}</small>${s.oa ? `<small class="oa">Open-access copy · see source note for version/provenance</small>` : ""}${s.extraction ? `<details data-details-key="source-${e(s.id)}-extraction"><summary>${e(s.extraction.reader)} · ${e(s.extraction.status)}</summary><small>Acquired: ${e(s.extraction.actualUrl)} · version ${e(s.extraction.version)}${s.extraction.pages !== undefined ? ` · ${s.extraction.textPages ?? "unknown"}/${s.extraction.pages} pages with text` : ""}</small><small>${e(s.extraction.warnings.join("; "))}</small></details>` : ""}</td><td>${e(s.retrievedAt?.slice(0, 10) ?? "unknown")}</td><td>${s.words.toLocaleString("en-US")}</td><td>${badge(s.fullRead ? "done" : "pending")}</td></tr>`).join("")}</tbody></table></div>
      ${state.sources.length ? "" : `<p class="empty">Sources will appear as workers read vault notes.</p>`}
      ${fetches.attempts.length ? `<details data-details-key="failed-fetches" id="failed-fetches"><summary>Failed fetch attempts <span>${fetches.unresolved} unresolved · ${fetches.recovered} recovered</span></summary><p class="footnote">Recovered URLs are available in saved public sources. This does not establish a complete read or factual accuracy. Earlier errors are retained.</p><ul class="failures">${fetches.attempts.map((f, index) => `<li data-fetch-status="${f.recovered ? "recovered" : "unresolved"}"><strong class="fetch-status ${f.recovered ? "recovered" : "unresolved"}">${f.recovered ? "Recovered" : "Unresolved"}</strong> ${sourceLink(f.url, f.url)}<small>Attempt: ${e(f.at)}</small>${f.recovered ? `<details data-details-key="fetch-error-${index}"><summary>Earlier error</summary><small>${e(f.error)}</small></details>` : `<small>${e(f.error)}</small>`}</li>`).join("")}</ul></details>` : ""}
    </details>
    <details class="card supporting-panel" data-details-key="verification" id="verification"><summary>Verification <span>${state.checks.length ? `${state.checks.filter(check => !check.ok).length} failed / ${state.checks.length} checks` : "Not checked"}</span></summary>${state.checks.length ? `<ul class="checks">${state.checks.map(c => `<li><span class="check-icon ${c.ok ? "done" : "failed"}">${c.ok ? "✓" : "!"}</span><div><strong>${e(c.name)}</strong><small>${e(c.detail)}</small></div></li>`).join("")}</ul>` : `<p class="empty">No checks recorded.</p>`}<p class="footnote">Checks cover structure and quote matching, not factual accuracy.${state.reportStale ? " These results precede the latest steering; the draft awaits replacement." : ""}</p></details>
  </div>
  <aside class="revision sidebar" aria-label="Revision"><details class="sidebar-panel" data-details-key="revision-panel" open><summary>Revision</summary><div class="sidebar-body">
    ${state.revision ? `<div class="revision-entry">${state.feedback[0] ? `<strong>Revision request</strong><p class="revision-request">${e(state.feedback[0].text)}</p>` : ""}<div class="revision-parent"><small>Parent</small>${revisions?.parent ? runLink(revisions.parent) : `<span>${e(state.revision.parentTag)}</span><small>Unavailable in this view</small>`}</div></div>` : ""}
    ${archived ? "" : control ? feedbackComposer(state, control) : `<details class="card revision-guide" data-details-key="revision-command"><summary>${state.status === "done" ? "Revise in Pi" : "Steer in Pi"}</summary><p>${state.status === "done" ? "Starts a new paid run with a fresh cost ceiling. The original report is preserved." : "Select this investigation in Pi first. Steering applies at the next stage boundary and retains existing spend."}</p><code class="command">${state.status === "done" ? `/turing revise ${e(state.tag)} &lt;feedback&gt;` : "/turing steer &lt;feedback&gt;"}</code></details>`}
    ${revisionHistory(state, revisions)}
    <details class="card steering-history" data-details-key="steering-history"${control && state.feedback.length ? " open" : ""}><summary>Steering <span>${e(feedbackSummary(state))}</span></summary>${state.feedback.length ? `<ol class="feedback">${state.feedback.map(f => `<li>${badge(f.status)} <strong>Feedback ${f.id}</strong><p>${e(f.text)}</p><small>${e(f.status === "applied" ? `Replan scheduled at ${f.appliedAt}` : `Queued at ${f.createdAt}`)}</small></li>`).join("")}</ol>` : `<p class="empty">No explicit feedback submitted.</p>`}<p class="footnote">Applied feedback is included in worker instructions and schedules a replan.</p></details>
    ${state.inputs ? `<details class="card" data-details-key="approved-context"><summary>Approved context</summary><p class="footnote">${state.inputs.files.length} file snapshots · ${state.inputs.bindings?.length ?? 0} scoped readers · model use approved · public search disclosure ${state.inputs.grant.disclosure.search ? "approved" : "not approved"} · export ${state.inputs.grant.disclosure.export && !state.disclosure?.exportBlocked ? "approved" : "not approved"}. Source attachments are never bundled. ${state.disclosure?.searchBlocked ? "Further public requests are disabled after private context use." : ""}</p></details>` : ""}
  </div></details></aside>
  </div><footer>Run: <span class="run-id">${e(state.tag)}</span> · Snapshot written ${e(state.updatedAt)} · Model: ${e(state.model)} · Search: ${e(state.config.searchProvider)} · ${control ? "Private-context permissions remain in Pi." : "Controls remain in Pi."}</footer>`;
}

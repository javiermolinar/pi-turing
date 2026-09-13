import { renderReport } from "../src/report.ts";
import { activityAge } from "../src/progress.ts";
import { feedbackSummary } from "../src/feedback.ts";
import { stepIds, stepNames, type RunState } from "../src/types.ts";

export const escapeHtml = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const e = escapeHtml;
const money = (n: number) => `$${n.toFixed(2)}`;
const duration = (ms: number) => `${Math.floor(ms / 60_000)}m ${Math.floor(ms / 1000) % 60}s`;
const badge = (status: string) => `<span class="badge ${e(status)}">${e(status)}</span>`;
function sourceLink(url: string, label: string): string {
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    return `<a href="${e(parsed.href)}" target="_blank" rel="noopener noreferrer">${e(label)}</a>`;
  } catch { return e(label); }
}

/** This HTML is generated only by the host. No source or model HTML is trusted. */
export function renderMain(state: RunState, runnerLive = false): string {
  const active = stepIds.find(id => state.steps[id] === "running");
  const read = state.sources.filter(s => s.fullRead).length;
  return `<header class="run-header"><div><div class="eyebrow">LIGHT PIPELINE · ${e(state.tag)}</div><h1>${e(state.decomposition?.title ?? state.query)}</h1><p class="query">${e(state.query)}</p></div>${badge(state.status)}</header>
  ${state.reason ? `<div class="notice" role="status">${e(state.reason)}</div>` : ""}
  ${state.inputs ? `<div class="notice">Approved context: ${state.inputs.files.length} snapshots · model use approved · public search disclosure ${state.inputs.grant.disclosure.search ? "approved" : "not approved"} · export ${state.inputs.grant.disclosure.export && !state.disclosure?.exportBlocked ? "approved" : "not approved"}. Source attachments are never bundled. ${state.disclosure?.searchBlocked ? "Further public requests are disabled after private context use." : ""}</div>` : ""}
  ${state.revision ? `<div class="notice">Revision of ${e(state.revision.parentTag)} · Parent report preserved · This run has its own cost ceiling.</div>` : ""}
  <section class="card live-progress"><div><span aria-hidden="true" class="run-spinner${runnerLive && state.status === "running" ? " is-active" : ""}"></span><strong>${runnerLive && state.status === "running" ? "Research is running" : "Saved research activity"}</strong><small data-activity-at="${e(state.activity?.at ?? "")}">${e(activityAge(state))}</small></div><p>${e(state.activity?.text ?? "No worker activity recorded")}</p><small>Chat stays separate. Use /hyperresearch steer &lt;feedback&gt; to queue a change, or /hyperresearch pause to stop workers.</small></section>
  <section class="metrics" aria-label="Run metrics">
    <div><span>Current stage</span><strong>${e(active ? stepNames[active] : state.status === "done" ? "Verified" : "Not running")}</strong><small>${stepIds.filter(id => state.steps[id] === "done").length} of 5 stages complete</small></div>
    <div><span>Sources read</span><strong>${read}<small> / ${state.sources.length} collected</small></strong><small>${state.failures.length} failed fetch attempts</small></div>
    <div><span>Model cost estimate</span><strong>${state.pricingKnown ? "~" + money(state.cost) : "Unknown"}</strong><small>${state.config.budgetUsd === null ? "No model-cost ceiling" : `Ceiling ~${money(state.config.budgetUsd)}`} · excludes search fees</small></div>
    <div><span>Active run time</span><strong>${duration(state.elapsedMs)}</strong><small>${state.tokens.toLocaleString("en-US")} tokens reported</small></div>
  </section>
  <div class="layout"><aside class="card pipeline"><h2>Pipeline</h2><ol>${stepIds.map(id => `<li class="${e(state.steps[id])}"><span class="step-number">${id}</span><div><strong>${stepNames[id]}</strong><small>${e(state.steps[id])}</small></div></li>`).join("")}</ol><p class="footnote">Light mode has no adversarial critic suite or sentence-level citation audit.</p></aside>
  <div class="content">
    <section class="card"><div class="section-header"><h2>Workers</h2><span>${state.workers.filter(w => w.status === "running").length} ${runnerLive ? "active" : "recorded running"}</span></div>
      ${state.workers.length ? `<div class="table-wrap"><table><thead><tr><th>Role / task</th><th>Activity</th><th>Status</th><th>Usage</th></tr></thead><tbody>${state.workers.slice(-30).map(w => `<tr><td><strong>${e(w.role)}</strong><small>${e(w.task)}</small></td><td>${e(w.error ?? w.activity ?? "—")}</td><td>${badge(w.status)}</td><td>${w.turns} turns<small>${money(w.cost)}</small></td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">No workers dispatched yet.</p>`}
    </section>
    ${state.discoveries?.length ? `<section class="card"><div class="section-header"><h2>Scholarly discovery</h2><span>${state.discoveries.length} queries · ${state.discoveries.flatMap(batch => batch.coverage).filter(provider => provider.status === "failed").length} failed provider calls</span></div><p class="footnote">Metadata and abstracts are leads, never full-read evidence or independent corroboration. Complete provenance and coverage are retained in the checkpoint. Showing the latest five queries.</p>${state.discoveries.slice(-5).map(batch => `<details><summary>${e(batch.query)}</summary><ul>${batch.coverage.map(provider => `<li>${e(provider.provider)} ${badge(provider.status)} · ${provider.count} records${provider.cached ? " · cached" : ""}${provider.skipped ? ` · ${provider.skipped} skipped` : ""}${provider.error ? ` · ${e(provider.error)}` : ""}</li>`).join("")}</ul>${batch.uncertainMatches.length ? `<p>${batch.uncertainMatches.length} uncertain/shared-identity matches; do not count them as independent sources.</p>` : ""}</details>`).join("")}</section>` : ""}
    <section class="card"><div class="section-header"><h2>Sources</h2><span>${state.sources.length} collected</span></div>
      <div class="table-wrap"><table id="sources"><thead><tr><th>Source</th><th>Retrieved</th><th>Words</th><th>Read</th></tr></thead><tbody>${state.sources.map((s, index) => `<tr><td>[${index + 1}] ${sourceLink(s.url, s.title)}${s.origin === "local" ? "<small>Local evidence — not independent external corroboration</small>" : ""}<small>${e(s.url)}</small>${s.oa ? `<small class="oa">Open-access copy · see source note for version/provenance</small>` : ""}${s.extraction ? `<details><summary>${e(s.extraction.reader)} · ${e(s.extraction.status)}</summary><small>Acquired: ${e(s.extraction.actualUrl)} · version ${e(s.extraction.version)}${s.extraction.pages !== undefined ? ` · ${s.extraction.textPages ?? "unknown"}/${s.extraction.pages} pages with text` : ""}</small><small>${e(s.extraction.warnings.join("; "))}</small></details>` : ""}</td><td>${e(s.retrievedAt?.slice(0, 10) ?? "unknown")}</td><td>${s.words.toLocaleString("en-US")}</td><td>${badge(s.fullRead ? "done" : "pending")}</td></tr>`).join("")}</tbody></table></div>
      ${state.sources.length ? "" : `<p class="empty">Sources will appear as workers read vault notes.</p>`}
      ${state.failures.length ? `<details><summary>Failed fetch attempts (${state.failures.length})</summary><ul class="failures">${state.failures.map(f => `<li>${sourceLink(f.url, f.url)}<small>${e(f.error)}</small></li>`).join("")}</ul></details>` : ""}
    </section>
    <section class="card"><div class="section-header"><h2>Steering</h2><span>${e(feedbackSummary(state))}</span></div>${state.feedback.length ? `<ol class="feedback">${state.feedback.map(f => `<li>${badge(f.status)} <strong>Feedback ${f.id}</strong><p>${e(f.text)}</p><small>${e(f.status === "applied" ? `Replan scheduled at ${f.appliedAt}` : `Queued at ${f.createdAt}`)}</small></li>`).join("")}</ol>` : `<p class="empty">No explicit feedback submitted.</p>`}<p class="footnote">Queued feedback waits for the next stage boundary, then replans all stages. Applied means included in worker instructions, not verified fulfillment. Existing spend remains counted.</p></section>
    <section class="card"><h2>Verification</h2>${state.checks.length ? `<ul class="checks">${state.checks.map(c => `<li><span class="check-icon ${c.ok ? "done" : "failed"}">${c.ok ? "✓" : "!"}</span><div><strong>${e(c.name)}</strong><small>${e(c.detail)}</small></div></li>`).join("")}</ul>` : `<p class="empty">Not checked yet. A finished draft is not a verified report.</p>`}<p class="footnote">Structural checks and quote matching cannot establish factual accuracy.</p></section>
    <section class="card"><div class="section-header"><h2>Report preview</h2><span>${state.reportStale ? "Stale draft · awaiting replacement after steering" : state.status === "done" ? "Verified by light-mode gate" : "Unverified draft"}</span></div>${state.report ? `<article class="report">${renderReport(state.report, state.sources)}</article>` : `<p class="empty">The report will appear after drafting.</p>`}</section>
  </div></div><footer>Snapshot written ${e(state.updatedAt)} · Model: ${e(state.model)} · Search: ${e(state.config.searchProvider)} · Controls remain in Pi.</footer>`;
}

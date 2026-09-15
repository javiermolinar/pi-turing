import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { renderMain } from "../web/render.ts";
import { fixture } from "./fixtures.ts";

const documentFor = (state: ReturnType<typeof fixture>, live = false) => parseHTML(renderMain(state, live)).document;

test("title, question and metrics lead a report-centered three-column layout", () => {
  const state = fixture(); state.checks = [{ name: "Quote matching", ok: false, detail: "Missing quote" }];
  state.revision = { parentTag: "parent", report: "# Parent", sourceIds: [], instructions: [] };
  const document = documentFor(state);
  const layout = document.querySelector(".layout")!;
  assert.deepEqual([...layout.children].map(node => node.className), ["pipeline sidebar", "content", "revision sidebar"]);
  assert.equal(layout.previousElementSibling!.className, "run-overview");
  assert.ok(document.querySelector('.run-overview > .run-header'));
  assert.ok(document.querySelector('.run-overview > .metrics'));
  assert.equal(document.querySelector(".content")!.firstElementChild!.id, "report-preview");
  assert.ok(document.querySelector(".run-header h1"));
  assert.ok(document.querySelector(".run-header .query"));
  assert.match(document.querySelector(".report-warning")!.textContent!, /Quote matching/);
  assert.ok(document.querySelector(".revision .revision-history"));
  assert.ok(document.querySelector(".revision .steering-history"));
  assert.equal(document.querySelectorAll('.content details[open], .stage-list details[open]').length, 0);
  assert.equal(document.querySelectorAll(".workers-section").length, 0);
  state.report = undefined;
  assert.match(documentFor(state).querySelector(".report-placeholder")!.textContent!, /No draft has been saved/);
});

test("report status distinguishes completion from recorded verification results", () => {
  const state = fixture(); state.status = 'done';
  const status = () => documentFor(state).querySelector('.report-status')!.textContent;
  assert.equal(status(), 'Awaiting draft');
  state.report = '# Draft';
  assert.equal(status(), 'Draft');
  state.checks = [{ name: 'Quotes', ok: true, detail: 'Matched' }];
  assert.equal(status(), 'Checks passed');
  state.status = 'running';
  assert.equal(status(), 'Draft');
  state.status = 'done'; state.checks[0].ok = false;
  assert.equal(status(), 'Checks failed');
  state.reportStale = true;
  assert.equal(status(), 'Stale draft');
  assert.ok(documentFor(state).querySelector('.report-warning'));
  state.reportStale = false; state.profile = 'full';
  assert.equal(status(), 'Historical report');
});

test("metrics count report references rather than collected sources and only failures get a sublabel", () => {
  const state = fixture(); state.report = '[[sqlite-wal]] [[sqlite-wal]]';
  let document = documentFor(state);
  assert.equal(document.querySelector('.source-count')!.textContent, '1 cited · 1 read');
  assert.equal(document.querySelectorAll('.source-cited').length, 1);
  assert.equal(document.querySelectorAll('.metrics > div > small').length, 1);
  assert.equal(document.querySelector('.metric-warning')!.getAttribute('data-open-details'), 'failed-fetches');
  state.failures = []; state.report = '[web](https://www.postgresql.org/docs/current/mvcc.html)';
  document = documentFor(state);
  assert.equal(document.querySelector('.source-count')!.textContent, '1 cited · 1 read');
  assert.equal(document.querySelectorAll('.metrics > div > small').length, 0);
});

test("fetch history distinguishes recovered attempts without discarding errors or claiming complete reads", () => {
  const state = fixture();
  state.sources = [{ ...state.sources[0], url: "https://example.org/evidence?version=1", fullRead: false }];
  state.failures = [
    { url: "HTTPS://EXAMPLE.ORG:443/evidence?version=1#section", error: "Invalid suggestedBy <script>bad()</script>", at: state.createdAt },
    { url: "https://example.org/missing", error: "HTTP 403", at: state.createdAt },
  ];
  const before = structuredClone(state);
  let document = documentFor(state);
  assert.equal(document.querySelector('.metric-warning')!.textContent, '! 1 unresolved fetch attempt · 1 recovered');
  assert.deepEqual([...document.querySelectorAll('.failures li')].map(el => el.getAttribute('data-fetch-status')), ['recovered', 'unresolved']);
  const recovered = document.querySelector('[data-fetch-status="recovered"]')!;
  assert.equal(recovered.querySelector('.fetch-status')!.textContent, 'Recovered');
  assert.equal(recovered.querySelector('details')!.hasAttribute('open'), false);
  assert.match(recovered.textContent!, /Invalid suggestedBy <script>bad\(\)<\/script>/);
  assert.equal(recovered.querySelector('script'), null);
  assert.match(document.querySelector('#failed-fetches')!.textContent!, /does not establish a complete read/);
  assert.equal(document.querySelector('#sources .badge')!.textContent, 'pending');
  assert.deepEqual(state, before, 'Recovery is derived for display; saved evidence and history stay unchanged');

  state.sources.push({ ...state.sources[0], id: 'second-source', url: 'https://example.org/missing' });
  document = documentFor(state);
  assert.equal(document.querySelector('.metric-warning'), null);
  assert.equal(document.querySelector('.metric-recovered')!.textContent, '2 recovered fetch attempts');
  assert.equal(document.querySelector('.metric-recovered')!.getAttribute('data-open-details'), 'failed-fetches');
  assert.match(document.querySelector('#failed-fetches > summary')!.textContent!, /0 unresolved · 2 recovered/);
  assert.equal(document.querySelectorAll('.failures li').length, 2);
});

test("recovery matches saved public URLs, not query variants, local/scoped documents or malformed URLs", () => {
  const state = fixture();
  state.sources = [
    { ...state.sources[0], url: 'https://example.org/evidence?version=1' },
    { ...state.sources[0], id: 'local-source', url: 'https://example.org/local', origin: 'local' },
    { ...state.sources[0], id: 'scoped-source', url: 'https://example.org/scoped', origin: 'integration' },
    { ...state.sources[0], id: 'malformed-source', url: 'not a URL' },
  ];
  state.failures = ['https://example.org/evidence?version=2', 'http://example.org/evidence?version=1',
    'https://example.org/local', 'https://example.org/scoped', 'not a URL', 'javascript:alert(1)']
    .map(url => ({ url, error: 'Fixture error', at: state.createdAt }));
  const document = documentFor(state);
  assert.equal(document.querySelectorAll('[data-fetch-status="recovered"]').length, 0);
  assert.equal(document.querySelector('.metric-warning')!.textContent, '! 6 unresolved fetch attempts');
  assert.equal(document.querySelector('.failures a[href^="javascript:"]'), null);
});

test("revision request and parent stay visible while commands and provenance are disclosed", () => {
  const state = fixture(); state.status = 'done';
  state.revision = { parentTag: 'original', report: '# Parent', sourceIds: [], instructions: ['Be precise'] };
  state.feedback = [{ id: 1, text: 'Compare alternatives', status: 'applied', createdAt: state.createdAt }];
  const parent = fixture(); parent.tag = 'original';
  const document = parseHTML(renderMain(state, false, { parent, children: [] })).document;
  assert.equal(document.querySelector('.revision-request')!.textContent, 'Compare alternatives');
  const link = document.querySelector('.revision-parent a')!;
  assert.equal(link.getAttribute('data-related-run'), 'original');
  assert.equal(link.closest('details')!.getAttribute('data-details-key'), 'revision-panel');
  assert.equal(document.querySelector('.command')!.closest('details')!.getAttribute('data-details-key'), 'revision-command');
  assert.equal(document.querySelectorAll('.revision .sidebar-body details[open]').length, 0);
  assert.doesNotMatch(document.querySelector('.revision')!.textContent!, /This dashboard is read-only|Only revisions accessible|own cost ceiling/);
  assert.doesNotMatch(document.querySelector('.report-sheet')!.textContent!, /not proof of truth/);
});

test("historical workers without a corresponding stage remain inspectable",  () => {
  const state = fixture(); state.profile = "full"; state.steps = { legacy: "done" };
  const document = documentFor(state);
  assert.equal(document.querySelectorAll('[data-details-key="unassigned-workers"] .worker-card').length, state.workers.length);
});

test("visible stages are sequential without changing internal stage identifiers", () => {
  const state = fixture(); const before = structuredClone(state.steps);
  const document = documentFor(state, true);
  assert.deepEqual([...document.querySelectorAll(".step-number")].map(node => node.getAttribute('data-stage-number')), ["1", "2", "3", "4", "5"]);
  assert.match(document.querySelector(".pipeline")!.textContent!, /5 stages/);
  assert.equal(document.querySelector('[aria-current="step"] strong')!.textContent, "Width sweep");
  assert.equal(document.querySelector('.stage-list .done .step-number')!.textContent, '✓');
  assert.equal(document.querySelector('.stage-list .done .step-number')!.getAttribute('aria-label'), 'Complete');
  assert.doesNotMatch(document.querySelector('.stage-list .done > details > summary')!.textContent!, /Complete/);
  assert.deepEqual(state.steps, before);
});

test("workers nest under their stages and meters use total spend, not the ceiling", () => {
  const state = fixture(); state.cost = 5.99; state.config.budgetUsd = 15;
  state.workers[0].cost = 2.28; state.workers[0].status = "done";
  state.workers[1].status = "failed"; state.workers[1].error = "Fixture failure";
  const document = documentFor(state);
  assert.equal(document.querySelector("#workers"), null);
  assert.equal(document.querySelectorAll('[data-details-key="stage-2"] .worker-card').length, 2);
  assert.equal(document.querySelectorAll('[data-details-key="stage-1"] .worker-card').length, 0);
  const meter = document.querySelector(".worker-card meter")!;
  assert.equal(Number(meter.getAttribute("value")), 38.06);
  assert.match(meter.getAttribute("aria-label")!, /38% of reported model spend/);
  assert.equal(document.querySelector('.worker-state[aria-label="Completed"]')!.textContent, "✓");
  assert.equal(document.querySelector('.worker-state[aria-label="failed"]')!.textContent, "!");
  assert.match(document.querySelector(".pipeline")!.textContent!, /Fixture failure/);
  assert.match(document.querySelector('[data-details-key="stage-2"] > summary')!.textContent!, /1 failed/);
  assert.equal(document.querySelectorAll(".worker-card .badge").length, 0);
  state.workers = Array.from({ length: 31 }, (_, i) => ({ ...state.workers[0], id: `worker-${i}`, cost: 0.1 }));
  state.cost = 3.1;
  const allWorkers = documentFor(state);
  assert.equal(allWorkers.querySelectorAll(".worker-card").length, 31);
  assert.equal(Number(allWorkers.querySelector("meter")!.getAttribute("value")), 3.23);
  assert.match(allWorkers.querySelector(".pipeline")!.textContent!, /entire run’s reported model spend/);
});

test("zero or unknown spend has no fabricated cost-share meter", () => {
  const state = fixture(); state.cost = 0;
  assert.equal(documentFor(state).querySelectorAll("meter").length, 0);
  assert.match(documentFor(state).querySelector(".pipeline")!.textContent!, /No spend yet/);
  state.cost = 5.99; state.pricingKnown = false;
  const document = documentFor(state);
  assert.equal(document.querySelectorAll("meter").length, 0);
  assert.match(document.querySelector(".pipeline")!.textContent!, /Pricing unavailable/);
  assert.equal(document.querySelector('[data-counter="cost"]'), null);
});

test("compact status shares the title header and metrics retain usage caveats", () => {
  const state = fixture(); state.activity = { text: "Research complete", at: state.updatedAt };
  for (const [status, label, icon] of [
    ["done", "Complete", "✓"], ["aborted", "Cancelled", "×"], ["paused", "Paused", "Ⅱ"],
    ["failed", "Failed", "!"], ["blocked", "Blocked", "!"], ["running", "Recorded running — not live", "○"],
  ] as const) {
    state.status = status;
    const document = documentFor(state);
    assert.equal(document.querySelector("h1")!.nextElementSibling!.className, "run-status-row");
    assert.equal(document.querySelector(".run-state strong")!.textContent, label);
    assert.equal(document.querySelector(".status-icon")!.textContent, icon);
    assert.equal(document.querySelector(".status-icon")!.getAttribute("aria-hidden"), "true");
    assert.equal(document.querySelectorAll(".live-progress, [data-activity-at], .run-actions").length, 0);
    assert.equal(document.querySelectorAll(".metrics > div").length, 4);
    assert.match(document.querySelector('.metrics')!.textContent!, /Run time/);
    assert.doesNotMatch(document.querySelector('.metrics')!.textContent!, /Active run time|Usage updates|ceiling|excludes/);
    assert.match(document.querySelector('#run-details')!.textContent!, /Cost ceiling: ~\$15.00/);
    assert.match(document.querySelector('#run-details')!.textContent!, /search fees are excluded/);
    assert.equal(document.querySelector('.run-header .run-id'), null);
    assert.equal(document.querySelector('footer .run-id')!.textContent, state.tag);
    assert.doesNotMatch(renderMain(state), /Saved research activity|No live workers in this view|Research complete/);
  }
  state.status = "running";
  const live = documentFor(state, true);
  assert.equal(live.querySelector(".run-state strong")!.textContent, "In progress");
  assert.equal(live.querySelector(".status-stage")!.textContent, "Width sweep");
  assert.equal(live.querySelectorAll(".live-progress [data-activity-at]").length, 1);
});

test("live treatment follows actual runner ownership, never a saved running status", () => {
  const state = fixture();
  const live = documentFor(state, true);
  assert.equal(live.querySelectorAll(".stage-dot").length, 1);
  assert.equal(live.querySelector('[data-run-live="true"]') !== null, true);
  assert.equal(live.querySelector('[data-counter="tokens"]')!.getAttribute("data-value"), String(state.tokens));
  for (const status of ["running", "done", "paused", "failed", "blocked", "aborted"] as const) {
    state.status = status;
    const saved = documentFor(state, false);
    assert.equal(saved.querySelectorAll(".is-active, .stage-dot, .working-ellipsis").length, 0, status);
    if (status !== "running") assert.equal(documentFor(state, true).querySelectorAll(".is-active, .stage-dot").length, 0, status);
  }
});

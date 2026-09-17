// Synthetic fixtures only; no model calls, real investigations or external requests.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { startDashboard } from "../src/server.ts";
import { fixture, assessmentFixture } from "../tests/fixtures.ts";
import { reportHash } from "../src/assessment.ts";
import { stepIds } from "../src/types.ts";

const state = fixture();
state.status = "done"; state.assessmentVersion = 1;
state.steps = Object.fromEntries(stepIds.map(id => [id, "done"]));
state.workers = []; state.failures = [];
state.reason = "Synthetic assessment preview — not a research result.";
state.checks = [{ name: "fixture-structure", ok: true, detail: "Synthetic structural check only." }];
state.report = "# Storage decision\n\nFor a single writer, start by evaluating SQLite.\n\nThe available evidence does not establish performance under this workload. Test recovery and concurrent writes before choosing a database. [[sqlite-wal]]";
const result = assessmentFixture(state.report);
result.summary = "The draft discusses the comparison but leaves the workload-specific recommendation unresolved.";
result.requirements = [
  { question: "Choose a database for the stated workload", importance: "central", status: "partial", passages: ["For a single writer, start by evaluating SQLite."], rationale: "The recommendation needs explicit recovery and concurrency criteria." },
  { question: "Explain the evidence limits", importance: "supporting", status: "evidence-limited", passages: ["The available evidence does not establish performance under this workload."], rationale: "The report directly identifies the missing workload evidence." },
];
result.reasoning = { verdict: "needs-attention", rationale: "The recommendation is provisional, not a demonstrated winner.", passages: ["For a single writer, start by evaluating SQLite."] };
result.findings = [{ category: "coverage", passage: "For a single writer, start by evaluating SQLite.", rationale: "The central decision is only partially answered.", suggestedFix: "Name the recovery and concurrency conditions that would change the recommendation." }];
state.assessment = { reportHash: reportHash(state.report), assessedAt: state.updatedAt, sourceHashes: {}, result };
state.review = structuredClone(state.assessment);
state.patches.repair = { summary: "No safe evidence-backed repair was available. Workload measurements remain necessary.", edits: [] };
const output = resolve("artifacts"); mkdirSync(output, { recursive: true });
const server = await startDashboard(state, false);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = []; const requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("request", request => requests.push(request.url()));
  await page.goto(server.url);
  await page.getByText("Connected · saved activity", { exact: false }).waitFor();
  assert.equal(await page.locator(".stage-list > li").count(), 8);
  assert.match(await page.locator("#final-assessment > summary").textContent() ?? "", /Answer coverage: Partial · Evidence: Not assessed/);
  assert.equal(await page.locator(".metrics > div").count(), 5);
  assert.match(await page.locator(".assessment-metric").textContent() ?? "", /Needs attention.*1\/2 requirements · 0 claims checked/s);
  await page.locator("#final-assessment > summary").click();
  await page.getByRole("link", { name: "Assessment: Needs attention. Open details", exact: true }).click();
  assert.ok(await page.locator("#final-assessment").evaluate(element => (element as HTMLDetailsElement).open));
  assert.ok(await page.getByText("Reasoning: Needs attention", { exact: true }).first().isVisible());
  await page.locator("#final-assessment").screenshot({ path: resolve(output, "assessment-desktop.png") });
  await page.locator(".run-overview").screenshot({ path: resolve(output, "assessment-metric-desktop.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator("#final-assessment").screenshot({ path: resolve(output, "assessment-dark.png") });
  await page.locator(".run-overview").screenshot({ path: resolve(output, "assessment-metric-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => !document.querySelector(".sidebar-panel[open]"));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Assessment must not overflow mobile width");
  await page.locator("#final-assessment").screenshot({ path: resolve(output, "assessment-mobile.png") });
  await page.locator(".run-overview").screenshot({ path: resolve(output, "assessment-metric-mobile.png") });
  await page.locator("#final-assessment > summary").click();
  state.tokens++; server.publish(state, false);
  await page.locator(`[data-counter="tokens"][data-value="${state.tokens}"]`).waitFor();
  assert.equal(await page.locator("#final-assessment").evaluate(element => (element as HTMLDetailsElement).open), false, "User disclosure choice survives updates");
  // No report regeneration: the metric follows existing assessment judgments on each render.
  result.requirements[0].status = "answered"; result.reasoning.verdict = "pass"; result.findings = [];
  server.publish(state, false);
  await page.locator('.assessment-metric[data-assessment-status="partially-assessed"]').waitFor();
  result.evidenceSupport.verdict = "pass";
  result.claims = [{ passage: "For a single writer, start by evaluating SQLite.", sourceIds: ["sqlite-wal"], verdict: "supported", rationale: "Synthetic check, not research." }];
  server.publish(state, false);
  await page.locator('.assessment-metric[data-assessment-status="no-issues-found"]').waitFor();
  assert.match(await page.locator(".assessment-metric").textContent() ?? "", /No issues found.*2\/2 requirements · 1 claim checked/s);
  for (const width of [390, 820, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Metrics must fit at ${width}px`);
  }
  await page.locator(".run-overview").screenshot({ path: resolve(output, "assessment-metric-clean.png") });
  state.report += "\\n\\nChanged report."; server.publish(state, false);
  await page.locator('.assessment-metric[data-assessment-status="stale"]').waitFor();
  assert.equal(await page.locator(".assessment-metric small").count(), 0);
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith("http://127.0.0.1:")));
  console.log(`Assessment previews passed: ${output}`);
} finally { await browser.close(); await server.close(); }

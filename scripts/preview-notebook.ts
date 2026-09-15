// Synthetic design specimen. No real investigations, models, or external requests.
import { chromium, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { startDashboard } from "../src/server.ts";
import { fixture } from "../tests/fixtures.ts";
import type { Role } from "../src/types.ts";

async function checkHeadingBaselines(page: Page) {
  const baselines = await page.locator('.sidebar-panel > summary, .report-sheet > .section-header h2').evaluateAll(headings => headings.map(heading => {
    // A zero-height inline block exposes the text baseline, not just the element's top edge.
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    heading.append(probe);
    const y = probe.getBoundingClientRect().top;
    probe.remove();
    return y;
  }));
  assert.equal(baselines.length, 3);
  assert.ok(Math.max(...baselines) - Math.min(...baselines) < .5, `All three section headings share a text baseline: ${baselines}`);
}

async function checkSurfaces(page: Page) {
  const palette = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return Object.fromEntries(['bg', 'surface', 'paper', 'text', 'muted', 'metadata', 'accent', 'on-accent', 'soft', 'bad'].map(key => [key, root.getPropertyValue('--' + key).trim()]));
  });
  assert.notEqual(palette.bg, palette.paper, 'Only the report gets a distinct paper surface');
  assert.notEqual(palette.accent, palette.bad, 'Errors remain distinct from the forest-green accent');
  const luminance = (hex: string) => {
    const rgb = hex.slice(1).match(/../g)!.map(part => parseInt(part, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  for (const [foreground, background] of [
    ['text', 'paper'], ['text', 'surface'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'paper'], ['muted', 'soft'],
    ['accent', 'paper'], ['accent', 'bg'], ['on-accent', 'accent'], ['metadata', 'bg'], ['bad', 'paper'], ['bad', 'surface'],
  ]) {
    const a = luminance(palette[foreground]); const b = luminance(palette[background]);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${foreground} on ${background} meets normal-text contrast`);
  }
  for (const selector of ['.run-overview', '.sidebar', '.supporting-panel', '.metrics > div', '.stage-list > li', '.revision .card']) {
    assert.ok(await page.locator(selector).evaluateAll(elements => elements.every(el => {
      const style = getComputedStyle(el);
      return style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.boxShadow === 'none' && style.borderRightWidth === '0px';
    })), `${selector} remains part of the continuous canvas, not a floating card`);
  }
  assert.ok(await page.locator('.metrics, .metrics *').evaluateAll(elements => elements.every(el => getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)')), 'Every metric label and value sits directly on the canvas');
  assert.ok(await page.locator('.metrics > div + div').evaluateAll(elements => elements.every(el => {
    const pipe = getComputedStyle(el, '::before');
    return pipe.width === '1px' && pipe.height === '20px' && getComputedStyle(el).borderLeftWidth === '0px';
  })), 'Metric separators are short pipes, not card edges');
  assert.ok(await page.locator('.report-sheet').evaluate(el => {
    const style = getComputedStyle(el);
    return style.backgroundColor !== 'rgba(0, 0, 0, 0)' && ['top', 'right', 'bottom', 'left'].every(side => style.getPropertyValue('border-' + side + '-width') === '1px');
  }), 'The report keeps a soft, single-pixel paper edge');
  assert.ok(await page.locator('.layout').evaluate(el => ['::before', '::after'].every(pseudo => {
    const style = getComputedStyle(el, pseudo);
    return style.width === '1px' && Math.abs(parseFloat(style.height) - el.getBoundingClientRect().height) < 1;
  })), 'Column rules extend through the full layout, not just the sidebar content');
  assert.ok(await page.locator('.step-number').evaluateAll(nodes => nodes.every(el => getComputedStyle(el).borderRadius === '50%')), 'Timeline nodes are round');
  assert.ok(await page.locator('.stage-list > li').evaluateAll(nodes => nodes.every((el, i) => {
    const line = getComputedStyle(el, '::before');
    const node = el.querySelector('.step-number')!.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const alpha = Number(line.backgroundColor.match(/[\d.]+/g)?.[3] ?? 1);
    return alpha >= .16 && alpha <= .2 && line.width === '1px' && Math.abs(rect.x + parseFloat(line.left) + .5 - (node.x + node.width / 2)) < 1
      && (i === nodes.length - 1 || (Math.abs(parseFloat(line.top) + parseFloat(line.height) - rect.height) < 1
        && Math.abs(rect.bottom - nodes[i + 1].getBoundingClientRect().top) < 1));
  })), 'Timeline segments join behind the step centers');
  assert.equal(await page.locator('#export-markdown').evaluate(el => getComputedStyle(el).backgroundColor), await page.locator('.run-state.done').evaluate(el => getComputedStyle(el).color), 'Primary export and completion share one accent');
}

const output = resolve("artifacts"); mkdirSync(output, { recursive: true });
const state = fixture();
state.status = "done"; state.cost = 5.99; state.tokens = 184320; state.elapsedMs = 1_872_000;
state.reason = "Design fixture — synthetic run data, not a research result.";
state.decomposition!.title = "Choosing a store for a research vault";
state.query = "Compare SQLite and PostgreSQL for a small, single-writer research vault.";
state.updatedAt = new Date().toISOString();
state.activity = { text: "Report saved. Ready for your review.", at: new Date(Date.now() - 90_000).toISOString() };
for (const id of Object.keys(state.steps)) state.steps[id] = "done";
const workers: [Role, string, string, number, number][] = [
  ["decompose", "decompose-1", "Frame the workload and research questions", .14, 4200],
  ["research", "research-1", "Primary sources and storage constraints", 1.72, 55000],
  ["research", "research-2", "Counter-evidence and operational trade-offs", 2.28, 72000],
  ["draft", "draft-1", "Write the evidence-grounded report", 1.13, 34000],
  ["polish", "polish-1", "Tighten the argument and citations", .39, 10920],
  ["readability", "readability-1", "Final reading pass", .33, 8200],
];
state.workers = workers.map(([role, id, task, cost, tokens], i) => ({
  role, id, task, cost, tokens, status: "done", startedAt: state.createdAt, endedAt: state.updatedAt, turns: [2, 18, 24, 4, 2, 2][i],
  activity: ["3 questions scoped", "Primary documentation reviewed", "Limitations cross-checked", "Draft written", "Citations reviewed", "Reading pass complete"][i],
}));
state.failures = [];
state.feedback = [{ id: 1, text: "Prioritize operational simplicity for a one-person team. Make the migration boundary explicit.", status: "applied", createdAt: state.createdAt, appliedAt: state.updatedAt }];
state.checks = [{ name: "Illustrative verification row", ok: true, detail: "Design specimen only. These fixtures do not establish factual accuracy." }];
state.report = `# A decision starts with the workload

This is a reading-layout specimen, not a research recommendation. The example asks how a small team might compare an embedded database with a separate database service. Its purpose here is to show the shape of a finished document: a clear argument, readable paragraphs, and references that stay close to the claims they support.

## Start with the operating model

The useful comparison is not a list of features. It is a description of the work the team must do each week. Who owns backups? Where do writes originate? What happens when the process restarts? A report should answer those questions before presenting a preferred option.

For this illustrative workload, the notebook tracks a single writer, local storage, and a modest collection of source documents. That framing gives the reader something concrete to challenge. A change in any of those assumptions should be visible in the final decision, rather than hidden inside a general claim about database performance.

> The recommendation should state the boundary at which it stops being useful.

## Keep the evidence inspectable

Source links belong beside the discussion, not in a separate trail of application logs. The specimen links to the recorded [SQLite documentation](https://www.sqlite.org/wal.html) and [[postgres-concurrency]] to demonstrate the reference treatment. No benchmark results or research conclusions are implied by this preview.

A practical follow-up would record a representative workload, define the recovery requirements, and compare both options against the same tests. The report should preserve uncertainty where the available evidence does not settle the choice.

## What to decide next

- Name the person responsible for backup and recovery.
- Describe the expected number of concurrent writers.
- Define the workload change that would trigger a new evaluation.

The final artifact should be easy to read away from the dashboard. Worker activity, spending, and pipeline state explain how the document was produced; they should not compete with the document itself.
`;
const server = await startDashboard(state, false);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, colorScheme: "light" });
  const requests: string[] = []; page.on("request", req => requests.push(req.url()));
  await page.goto(server.url);
  await page.getByText("Connected · saved activity", { exact: false }).waitFor();
  assert.equal(await page.locator('.worker-card .worker-state[aria-label="Completed"]').count(), 6);
  assert.equal(await page.locator('.worker-card meter').nth(2).getAttribute('value'), '38.06');
  const pipeline = page.locator('.pipeline'); const report = page.locator('.report-sheet'); const revision = page.locator('.revision');
  const left = (await pipeline.boundingBox())!; const center = (await report.boundingBox())!; const right = (await revision.boundingBox())!;
  assert.ok(left.x + left.width < center.x && center.x + center.width < right.x);
  assert.ok(center.width > left.width * 2 && center.width > right.width * 2);
  assert.ok(center.y < 400, 'The compact header and banner leave the report near the top');
  assert.ok((await page.locator('.metrics').boundingBox())!.height < 75, 'Desktop metrics form a compact strip');
  const title = (await page.locator('.run-header h1').boundingBox())!;
  const status = (await page.locator('.run-status-row').boundingBox())!;
  assert.ok(status.x >= title.x + title.width && status.y < title.y + title.height, 'Status sits beside the title');
  assert.equal(await page.locator('.report').evaluate(el => getComputedStyle(el).fontSize), '19px');
  assert.match(await page.locator('.report h1').evaluate(el => getComputedStyle(el).fontFamily), /Charter/);
  for (const selector of ['.run-header h1', '.sidebar-panel > summary', '.stage-label strong']) {
    assert.doesNotMatch(await page.locator(selector).first().evaluate(el => getComputedStyle(el).fontFamily), /Charter|Georgia/);
  }
  assert.ok(await page.locator('.metrics > div > span').evaluateAll(elements => elements.every(el => getComputedStyle(el).textTransform === 'uppercase')), 'Small uppercase metric labels contrast with larger values');
  assert.equal(await page.locator('.metrics strong').first().evaluate(el => getComputedStyle(el).fontSize), '20px');
  for (const selector of ['.eyebrow', '.report-sheet > .section-header h2']) {
    assert.ok(await page.locator(selector).evaluateAll(elements => elements.every(el => {
      const style = getComputedStyle(el); return style.textTransform === 'none' && ['normal', '0px'].includes(style.letterSpacing);
    })), 'Chrome labels use sentence case without tracking');
  }
  assert.ok(await page.locator('details > summary').evaluateAll(elements => elements.every(el => {
    const before = getComputedStyle(el, '::before');
    return getComputedStyle(el).listStyleType === 'none' && before.width === '6px' && before.borderRightStyle === 'solid' && getComputedStyle(el, '::after').content === 'none';
  })), 'All disclosures use the same CSS chevron');
  assert.equal(await page.locator('.source-count').textContent(), '2 cited · 1 read');
  assert.equal(await page.locator('.metrics > div > small').count(), 0);
  assert.equal(await page.locator('.report-status').textContent(), 'Checks passed');
  assert.equal(await page.locator('.command:visible').count(), 0);
  console.log(`Compact specimen: desktop report starts at ${Math.round(center.y)}px`);
  assert.equal(await page.locator('.stage-list details[open]').count(), 0);
  assert.equal(await page.locator('.is-active, .stage-dot').count(), 0);
  assert.equal(await page.locator('.run-state strong').textContent(), 'Complete');
  assert.equal(await page.locator('.live-progress, [data-activity-at]').count(), 0);
  await checkSurfaces(page);
  await checkHeadingBaselines(page);
  await page.screenshot({ path: resolve(output, "notebook-completed-desktop.png"), fullPage: true });
  await page.locator('.run-header').screenshot({ path: resolve(output, "notebook-status-complete.png") });
  await page.locator('[data-details-key="stage-1"] > summary').focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-details-key="worker-decompose-1"] > summary').click();
  assert.ok(await page.getByText('3 questions scoped', { exact: true }).isVisible());
  assert.deepEqual(await report.boundingBox(), center, 'Expanding workers must not move the report');
  await checkSurfaces(page);
  await pipeline.screenshot({ path: resolve(output, "notebook-workers.png") });
  await page.locator('[data-details-key="stage-1"] > summary').click();
  await page.locator('[data-details-key="pipeline-panel"] > summary').click();
  assert.ok((await report.boundingBox())!.width >= center.width, 'Collapsing a sidebar preserves the report’s reading width');
  await page.locator('[data-details-key="pipeline-panel"] > summary').click();
  await page.getByRole('link', { name: 'Read report ↓' }).click();
  await page.locator('.report-sheet').screenshot({ path: resolve(output, "notebook-report.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await checkSurfaces(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await checkHeadingBaselines(page);
  await page.screenshot({ path: resolve(output, "notebook-completed-dark.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  // Match the wide desktop screenshot, including a long title and revision request.
  const originalTitle = state.decomposition!.title;
  state.decomposition!.title = 'Choosing a research vault: storage, recovery, and migration boundaries for a small team';
  state.revision = { parentTag: 'previous-design-specimen', report: '# Previous specimen', sourceIds: [], instructions: [] };
  server.publish(state, false);
  await page.getByRole('heading', { name: state.decomposition!.title, exact: true }).waitFor();
  for (const width of [1920, 2560, 2828]) {
    await page.setViewportSize({ width, height: 1521 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await checkHeadingBaselines(page);
    const layout = (await page.locator('.layout').boundingBox())!;
    const sheet = (await report.boundingBox())!;
    const body = (await page.locator('.report').boundingBox())!;
    const heading = (await page.locator('.report-sheet > .section-header').boundingBox())!;
    assert.ok(layout.width < 1450, 'Wide monitors must not stretch the notebook');
    assert.ok(Math.abs(layout.x - (width - layout.x - layout.width)) < 1, 'The complete notebook is centered');
    assert.ok(sheet.width <= 800 && body.x - sheet.x < 48, `No oversized blank margins inside the report sheet: ${JSON.stringify({ sheet, body })}`);
    assert.ok(Math.abs(heading.x - body.x) < 1, 'Report header aligns with its reading column');
    assert.ok((await revision.boundingBox())!.width >= 300, 'Revision requests have a comfortable column');
    const overview = (await page.locator('.run-overview').boundingBox())!;
    assert.ok(Math.abs(overview.x - layout.x) < 1 && Math.abs(overview.width - layout.width) < 1, 'Overview shares the notebook boundaries');
    const header = (await page.locator('.run-header').boundingBox())!;
    const metrics = (await page.locator('.metrics').boundingBox())!;
    assert.ok(Math.abs(header.x - metrics.x) < 1 && Math.abs(header.width - metrics.width) < 1, 'Title and metrics share the overview’s inner boundaries');
    assert.ok(await page.locator('.report').evaluate(el => {
      const measure = document.createElement('span'); measure.style.cssText = 'display:block;width:68ch'; el.append(measure);
      const max = measure.getBoundingClientRect().width; measure.remove();
      return el.getBoundingClientRect().width <= max + 1;
    }), 'The reading measure remains bounded on wide screens');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  }
  assert.ok(await page.locator('.revision-request').isVisible());
  assert.equal(await page.locator('.revision .footnote:visible, .command:visible').count(), 0);
  await page.locator('[data-details-key="steering-history"] > summary').click();
  assert.ok(await page.locator('.revision-entry, .feedback li').evaluateAll(elements => elements.every(el => {
    const style = getComputedStyle(el);
    return style.borderLeftWidth === '2px' && style.borderTopWidth === '0px' && style.backgroundColor === 'rgba(0, 0, 0, 0)';
  })), 'Revision requests and steering logs use only an accent stroke');
  await revision.screenshot({ path: resolve(output, 'notebook-revision-notes.png') });
  await page.locator('[data-details-key="steering-history"] > summary').click();
  await page.screenshot({ path: resolve(output, 'notebook-completed-ultrawide.png') });
  await page.locator('main').screenshot({ path: resolve(output, 'notebook-ultrawide-detail.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, 'notebook-ultrawide-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  // Collapsing both sidebars must not reintroduce an oversized report panel.
  await page.locator('[data-details-key="pipeline-panel"] > summary').click();
  await page.locator('[data-details-key="revision-panel"] > summary').click();
  assert.ok((await report.boundingBox())!.width <= 800);
  await checkHeadingBaselines(page);
  await page.locator('[data-details-key="pipeline-panel"] > summary').click();
  await page.locator('[data-details-key="revision-panel"] > summary').click();
  state.decomposition!.title = originalTitle; state.revision = undefined;
  server.publish(state, false);
  await page.getByRole('heading', { name: originalTitle, exact: true }).waitFor();
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.waitForFunction(() => !document.querySelector('.sidebar-panel[open]'));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: resolve(output, "notebook-completed-tablet.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => !document.querySelector('.sidebar-panel[open]'));
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(await page.locator('.layout').evaluate(el => getComputedStyle(el, '::before').display), 'none', 'Stacked mobile layout removes desktop column rules');
  assert.ok(await page.locator('.metrics > div').evaluateAll(elements => elements.every(el => getComputedStyle(el).borderBottomWidth === '0px')), 'Wrapped mobile metrics remain unboxed');
  const mobileReport = (await report.boundingBox())!;
  console.log(`Compact specimen: mobile report starts at ${Math.round(mobileReport.y)}px`);
  assert.ok(mobileReport.y < 780, 'Compact mobile chrome exposes the report in the first screen');
  assert.equal(await page.locator('.report').evaluate(el => getComputedStyle(el).fontSize), '18px');
  await page.screenshot({ path: resolve(output, "notebook-completed-mobile.png"), fullPage: true });
  await page.locator('.run-header').screenshot({ path: resolve(output, "notebook-status-complete-mobile.png") });
  await page.locator('[data-details-key="pipeline-panel"] > summary').click();
  await page.locator('[data-details-key="stage-1"] > summary').click();
  await pipeline.screenshot({ path: resolve(output, "notebook-workers-mobile.png") });
  await page.locator('[data-details-key="pipeline-panel"] > summary').click();
  await page.getByRole('link', { name: 'Model cost', exact: true }).click();
  assert.ok(await page.locator('#run-details .footnote').first().isVisible(), 'Cost details open their collapsed sidebar');
  await page.locator('#run-details > summary').click();
  state.tokens++;
  server.publish(state, false);
  await page.locator(`[data-counter="tokens"][data-value="${state.tokens}"]`).waitFor();
  assert.equal(await page.locator('[data-details-key="pipeline-panel"]').evaluate(el => (el as HTMLDetailsElement).open), true);
  assert.equal(await page.locator('[data-details-key="revision-panel"]').evaluate(el => (el as HTMLDetailsElement).open), false);
  assert.ok(await page.getByText('3 questions scoped', { exact: true }).isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.ok(await page.locator('.worker-card meter:visible').evaluateAll(meters => meters.length > 0 && meters.every(meter => {
    const box = meter.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth;
  })), 'Worker spend bars must be visible without horizontal scrolling on mobile');
  assert.ok(requests.every(url => url.startsWith('http://127.0.0.1:')));
  console.log(`Notebook design previews passed. Screenshots: ${output}`);
} finally { await browser.close(); await server.close(); }

// Deterministic browser smoke test and screenshots. No model calls or external pages.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startDashboard } from "../src/server.ts";
import { renderDashboard } from "../src/dashboard.ts";
import { discoveryFixture, fixture } from "../tests/fixtures.ts";

const output = resolve("artifacts"); mkdirSync(output, { recursive: true });
const state = fixture();
state.discoveries = Array.from({ length: 5 }, (_, i) => discoveryFixture(`Graph similarity query ${i + 1}`));
state.activity = { text: 'research-1: Reading sqlite-wal', at: new Date(Date.now() - 65_000).toISOString() };
state.feedback.push({ id: 1, text: 'Prefer primary sources. <script>window.hacked=true</script>', status: 'queued', createdAt: new Date().toISOString() });
state.query = 'Compare local SQLite and PostgreSQL for a small research vault. (Fixture preview — not a real run.)';
state.report = '# Draft preview\n\nFor a local, single-writer vault, **SQLite** has a smaller operational footprint. This fixture illustrates the dashboard, not a research conclusion.\n\n## Trade-offs\n\n- SQLite embeds the database in the application.\n- PostgreSQL provides a separate database service.\n\n<img src="https://attacker.invalid/pixel" onerror="window.hacked=true"><script>window.hacked=true</script>';
state.report += String.raw`

## Links and equations

Recorded source [[sqlite-wal]], [vault note](notes/postgres-concurrency.md), and [this section](#links-and-equations).

\[
\partial_t u+(u\cdot\nabla)u=-\nabla p+\nu\Delta u+f,\qquad \nabla\cdot u=0.
\]

Here, \(u\) is velocity and $\nu>0$ is viscosity.

$$\frac{1}{2}+\sqrt{x}$$

\(\href{https://attacker.invalid}{unsafe math link}\)
\(\includegraphics{https://attacker.invalid/pixel}\)
`;
const snapshot = resolve(output, "dashboard.html"); writeFileSync(snapshot, renderDashboard(state));
const server = await startDashboard(state);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, colorScheme: "light" });
  const requests: string[] = []; page.on("request", req => requests.push(req.url()));
  await page.goto(server.url);
  await page.waitForFunction(() => document.getElementById("connection")?.textContent?.includes("Live"));
  assert.ok(!await page.evaluate(() => (window as any).hacked));
  assert.equal(await page.locator('.run-spinner.is-active').count(), 1);
  assert.equal(await page.locator('.run-spinner').evaluate(el => getComputedStyle(el).animationPlayState), 'running');
  assert.match(await page.locator('[data-activity-at]').textContent() ?? '', /Last activity 1m/);
  assert.deepEqual(await page.locator('.step-number').allTextContents(), ['✓', '2', '3', '4', '5']);
  assert.equal(await page.locator('.stage-dot').evaluate(el => getComputedStyle(el).animationName), 'ink-pulse');
  assert.equal(await page.locator('#workers').count(), 0);
  const stage = page.locator('[data-details-key="stage-2"]');
  const worker = page.locator('[data-details-key="worker-research-1"]');
  await stage.locator(':scope > summary').click();
  await worker.locator('summary').click();
  const reportStyle = await page.locator('.report').evaluate(el => {
    const style = getComputedStyle(el);
    const measure = document.createElement('span'); measure.style.cssText = 'display:block;width:68ch'; el.append(measure);
    const max = measure.getBoundingClientRect().width; measure.remove();
    return { width: el.getBoundingClientRect().width, max, font: style.fontFamily, line: parseFloat(style.lineHeight) / parseFloat(style.fontSize) };
  });
  assert.ok(reportStyle.width <= reportStyle.max + 1);
  assert.match(reportStyle.font, /Charter/); assert.ok(reportStyle.line >= 1.7);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.run-spinner').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await page.locator('.stage-dot').evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await page.locator('.report a.citation').getAttribute('href'), state.sources[0].url);
  assert.equal(await page.getByRole('link', { name: 'vault note', exact: true }).getAttribute('href'), state.sources[1].url);
  await page.getByRole('link', { name: 'this section', exact: true }).click();
  assert.ok(new URL(page.url()).hash === '#report-links-and-equations');
  assert.equal(await page.locator('.report math[display="block"]').count(), 2);
  assert.equal(await page.locator('.report mfrac').count(), 1);
  assert.ok(await page.locator('.report math').first().isVisible());
  assert.equal(await page.locator('.report [data-report-fragment], .report img, .report script, .report a[href*="attacker"]').count(), 0);
  await page.locator('.report').screenshot({ path: resolve(output, 'report-desktop.png') });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(output, "dashboard-desktop.png"), fullPage: true });
  await page.locator('.run-header').screenshot({ path: resolve(output, 'notebook-status-running.png') });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: resolve(output, "dashboard-dark.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  state.tokens += 1243; state.workers[0].tokens += 1243;
  state.cost += 0.07; state.workers[0].cost += 0.07;
  server.publish(state);
  await page.locator('[data-counter="tokens"][data-value="51243"]').waitFor();
  assert.equal(await page.locator('[data-counter="tokens"]').evaluate(el => el.classList.contains('counter-changed')), true);
  assert.equal(await page.locator('[data-counter="cost"]').evaluate(el => el.classList.contains('counter-changed')), true);
  assert.ok(await page.locator('.counter-changed').evaluateAll(counters => counters.every(el => {
    const animation = el.getAnimations()[0];
    if (!animation) return false;
    animation.pause();
    const transparent = [0, 350, 700, 1399].every(time => {
      animation.currentTime = time;
      return getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)';
    });
    animation.finish();
    return transparent;
  })), 'Live counter updates change ink only, never add a background rectangle');
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('[data-counter="tokens"]').textContent(), '51,243', 'No simulated token increments between reports');
  assert.equal(await page.locator('.source-count').textContent(), '2 cited · 1 read');
  await page.locator('.metric-warning').click();
  assert.ok(await page.getByText('HTTP 403; browser access required', { exact: true }).isVisible());
  await page.locator('#failed-fetches > summary').click();
  await page.getByLabel("Filter sources").fill("PostgreSQL");
  assert.equal(await page.locator("#sources tbody tr:visible").count(), 1);
  await page.locator('[data-details-key="scholarly-discovery"] > summary').click();
  const discovery = page.locator('details[data-details-key="discovery-4"]');
  const failures = page.locator('details[data-details-key="failed-fetches"]');
  await discovery.locator('summary').click();
  await failures.locator('summary').click();
  assert.equal(await discovery.getByRole('link', { name: 'Fixture paper: graph similarity' }).getAttribute('href'), 'https://example.org/paper');
  // New sections and a shifted latest-five window must not transfer open state by position.
  state.discoveries.push(discoveryFixture('Newly appended query'));
  state.failures.push({ ...state.failures[0], url: 'https://example.org/another-blocked' });
  state.reason = "Live update arrived without a reload."; state.status = "blocked";
  state.report += '\n\nLive math: \\(z^3\\) and [[postgres-concurrency]].';
  state.steps["2"] = "pending";
  state.feedback[0].status = 'applied'; state.feedback[0].appliedAt = new Date().toISOString();
  state.reportStale = true;
  state.checks = [{ name: 'Fixture quote check', ok: false, detail: 'A fixture quote did not match.' }];
  for (const worker of state.workers) worker.status = "interrupted";
  server.publish(state);
  await page.getByText("Live update arrived without a reload.").waitFor();
  assert.equal(await page.locator('.stage-dot, .counter-changed').count(), 0);
  assert.match(await page.locator('#connection').textContent() ?? '', /Connected · saved activity/);
  assert.equal(await stage.evaluate(el => (el as HTMLDetailsElement).open), true);
  assert.equal(await worker.evaluate(el => (el as HTMLDetailsElement).open), true);
  assert.equal(await discovery.evaluate(el => (el as HTMLDetailsElement).open), true);
  assert.equal(await failures.evaluate(el => (el as HTMLDetailsElement).open), true);
  assert.equal(await page.locator('details[data-details-key="discovery-5"]').evaluate(el => (el as HTMLDetailsElement).open), false);
  assert.equal(await failures.locator('summary').evaluate(el => el === document.activeElement), true);
  // Explicitly closing a section must also survive subsequent updates.
  await discovery.locator('summary').click();
  for (let i = 0; i < 3; i++) {
    state.reason = `Collapsible regression update ${i}`; server.publish(state);
    await page.getByText(state.reason, { exact: true }).waitFor();
    assert.equal(await discovery.evaluate(el => (el as HTMLDetailsElement).open), false);
    assert.equal(await failures.evaluate(el => (el as HTMLDetailsElement).open), true);
  }
  await discovery.locator('summary').click();
  await discovery.screenshot({ path: resolve(output, 'scholarly-discovery-expanded.png') });
  assert.equal(await page.locator('.run-spinner.is-active').count(), 0);
  assert.ok(await page.locator('.report-warning').isVisible());
  await page.getByRole('link', { name: 'Review verification details' }).click();
  assert.ok(await page.getByText('A fixture quote did not match.', { exact: true }).isVisible());
  await page.getByText('0 queued · 1 applied', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Stale draft', exact: true }).waitFor();
  assert.equal(await page.locator('.report a.citation').count(), 2);
  assert.match(await page.locator('.report math').last().textContent() ?? '', /z/);
  assert.equal(await page.locator("#sources tbody tr:visible").count(), 1);
  await page.getByLabel("Filter sources").fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, "dashboard-mobile.png"), fullPage: true });
  await page.locator('.report').screenshot({ path: resolve(output, 'report-mobile.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  // Recovery updates are derived from saved sources, without deleting attempts
  // or losing open details. A successful fetch is not necessarily a full read.
  const failureHistory = JSON.stringify(state.failures);
  state.sources.push({ ...state.sources[0], id: 'recovered-first', url: state.failures[0].url, fullRead: false });
  server.publish(state);
  await page.locator('.metric-warning', { hasText: '1 unresolved fetch attempt · 1 recovered' }).waitFor();
  assert.equal(await failures.evaluate(el => (el as HTMLDetailsElement).open), true);
  const recoveredError = page.locator('[data-fetch-status="recovered"] [data-details-key="fetch-error-0"]');
  assert.equal(await recoveredError.evaluate(el => (el as HTMLDetailsElement).open), false);
  await recoveredError.locator('summary').click();
  assert.ok(await recoveredError.getByText('HTTP 403; browser access required', { exact: true }).isVisible());
  state.sources.push({ ...state.sources[0], id: 'recovered-second', url: state.failures[1].url });
  server.publish(state);
  await page.locator('.metric-recovered', { hasText: '2 recovered fetch attempts' }).waitFor();
  assert.equal(await page.locator('.metric-warning').count(), 0);
  assert.equal(await recoveredError.evaluate(el => (el as HTMLDetailsElement).open), true);
  assert.equal(await page.locator('[data-fetch-status="recovered"]').count(), 2);
  assert.equal(JSON.stringify(state.failures), failureHistory);
  await recoveredError.locator('summary').click();
  await failures.screenshot({ path: resolve(output, 'fetch-recovery-mobile.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await failures.screenshot({ path: resolve(output, 'fetch-recovery-desktop.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await failures.screenshot({ path: resolve(output, 'fetch-recovery-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  const htmlDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export HTML', exact: true }).click();
  const htmlDownload = await htmlDownloadPromise;
  const exportedHtml = resolve(output, 'dashboard-export.html'); await htmlDownload.saveAs(exportedHtml);
  state.status = 'running'; state.steps['2'] = 'running'; server.publish(state, false);
  await page.getByText('Recorded running — not live', { exact: true }).waitFor();
  assert.equal(await page.locator('.live-progress, [data-activity-at]').count(), 0);
  assert.equal(await page.locator('.run-spinner.is-active').count(), 0);
  server.publish(state, true);
  await page.locator('.run-spinner.is-active').waitFor();
  await server.close();
  await page.waitForFunction(() => document.getElementById("connection")?.textContent?.includes("Disconnected"));
  assert.equal(await page.locator('.run-spinner').evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
  assert.equal(await page.locator('.stage-dot').evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
  await page.goto(pathToFileURL(exportedHtml).href);
  assert.equal(await page.locator('.run-spinner.is-active').count(), 0);
  assert.ok(await page.getByText("Offline snapshot", { exact: false }).isVisible());
  await page.locator('.metric-recovered').click();
  assert.ok(await page.locator('#failed-fetches > summary').isVisible());
  assert.equal(await page.locator('[data-fetch-status="recovered"]').count(), 2);
  assert.equal(await page.locator('.metric-warning').count(), 0);
  assert.ok(!await page.evaluate(() => (window as any).hacked));
  assert.equal(await page.locator('.report math[display="block"]').count(), 2);
  assert.equal(await page.locator('.report a').filter({ hasText: /^1$/ }).first().getAttribute('href'), state.sources[0].url);
  const markdownPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Markdown', exact: true }).click();
  const markdown = await markdownPromise; const exportedMd = resolve(output, 'report-export.md'); await markdown.saveAs(exportedMd);
  const portable = readFileSync(exportedMd, 'utf8');
  assert.ok(portable.includes('STALE DRAFT')); assert.ok(portable.includes(String.raw`\partial_t u`));
  assert.ok(!portable.includes('[[sqlite-wal]]')); assert.ok(portable.includes(state.sources[0].url));
  assert.ok(requests.every(url => url.startsWith("http://127.0.0.1:") || url.startsWith("file://")), requests.join("\n"));
  console.log(`Browser smoke test passed. Screenshots: ${output}`);
} finally { await browser.close(); await server.close(); }

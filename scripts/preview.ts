// Deterministic browser smoke test and screenshots. No model calls or external pages.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startDashboard } from "../src/server.ts";
import { renderDashboard } from "../src/dashboard.ts";
import { fixture } from "../tests/fixtures.ts";

const output = resolve("artifacts"); mkdirSync(output, { recursive: true });
const state = fixture();
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.run-spinner').evaluate(el => getComputedStyle(el).animationName), 'none');
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
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: resolve(output, "dashboard-dark.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByLabel("Filter sources").fill("PostgreSQL");
  assert.equal(await page.locator("#sources tbody tr:visible").count(), 1);
  state.reason = "Live update arrived without a reload."; state.status = "blocked";
  state.report += '\n\nLive math: \\(z^3\\) and [[postgres-concurrency]].';
  state.steps["2"] = "pending";
  state.feedback[0].status = 'applied'; state.feedback[0].appliedAt = new Date().toISOString();
  state.reportStale = true;
  for (const worker of state.workers) worker.status = "interrupted";
  server.publish(state);
  await page.getByText("Live update arrived without a reload.").waitFor();
  assert.equal(await page.locator('.run-spinner.is-active').count(), 0);
  await page.getByText('0 queued · 1 applied', { exact: true }).waitFor();
  await page.getByText('Stale draft · awaiting replacement after steering', { exact: true }).waitFor();
  assert.equal(await page.locator('.report a.citation').count(), 2);
  assert.match(await page.locator('.report math').last().textContent() ?? '', /z/);
  assert.equal(await page.locator("#sources tbody tr:visible").count(), 1);
  await page.getByLabel("Filter sources").fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, "dashboard-mobile.png"), fullPage: true });
  await page.locator('.report').screenshot({ path: resolve(output, 'report-mobile.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const htmlDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export HTML', exact: true }).click();
  const htmlDownload = await htmlDownloadPromise;
  const exportedHtml = resolve(output, 'dashboard-export.html'); await htmlDownload.saveAs(exportedHtml);
  state.status = 'running'; server.publish(state, false);
  await page.getByText('Saved research activity', { exact: true }).waitFor();
  assert.equal(await page.locator('.run-spinner.is-active').count(), 0);
  server.publish(state, true);
  await page.locator('.run-spinner.is-active').waitFor();
  await server.close();
  await page.waitForFunction(() => document.getElementById("connection")?.textContent?.includes("Disconnected"));
  assert.equal(await page.locator('.run-spinner').evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
  await page.goto(pathToFileURL(exportedHtml).href);
  assert.equal(await page.locator('.run-spinner.is-active').count(), 0);
  assert.ok(await page.getByText("Offline snapshot", { exact: false }).isVisible());
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

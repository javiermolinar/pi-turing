// Offline fixture data + loopback browser tests only; never reads real runs.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startInventory } from "../src/server.ts";
import { RunStore } from "../src/store.ts";
import { approveContext, previewContext } from "../src/context.ts";
import { createLocation } from "../src/paths.ts";
import { fixture } from "../tests/fixtures.ts";
const root = mkdtempSync(join(tmpdir(), "hpr-browser-inventory-"));
const output = resolve("artifacts"); mkdirSync(output, { recursive: true });
for (const tag of ["alpha", "beta", "private"]) {
  const state = fixture(); state.tag = tag; state.query = `Investigation ${tag}`; state.decomposition = undefined;
  state.status = "paused"; state.report = `# ${tag}\n\nneedle ${tag} <script>window.hacked=true</script>\n\nMath: $x^2$`;
  if (tag === "beta") {
    state.revision = { parentTag: "alpha", report: "# alpha", sourceIds: [], instructions: ["Prefer primary sources"] };
    state.feedback = [{ id: 1, text: "Compare alternatives when shape and cardinality matter.", status: "applied", createdAt: state.createdAt, appliedAt: state.updatedAt }];
    writeFileSync(join(root, "selected-context.md"), "Private attachment body is not a downloadable source bundle.");
    state.location = createLocation(root, root, "beta-context");
    state.inputs = approveContext(state.location.workspacePath, previewContext(root, { instructions: "", files: [{ path: "selected-context.md", purpose: "background" }] }), { model: true, search: false, export: false });
  }
  new RunStore(root, tag).save(state);
}
const server = await startInventory(root, new Set(["alpha", "beta"]));
const fullInventory = await startInventory(root);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requests: string[] = []; page.on("request", request => requests.push(request.url()));
  await page.addInitScript(() => {
    const Original = window.EventSource;
    (window as any).oldSnapshots = [];
    window.EventSource = class extends Original {
      addEventListener(type: any, listener: any, options?: any) {
        if (type === "snapshot") (window as any).oldSnapshots.push(listener);
        return super.addEventListener(type, listener, options);
      }
    };
  });
  await page.goto(server.url);
  await page.getByRole("link", { name: "Investigation alpha", exact: true }).waitFor();
  assert.equal(await page.locator("#run-list .run-row").count(), 2);
  assert.equal(await page.getByText("Investigation private").count(), 0);
  await page.getByLabel("Filter runs", { exact: true }).fill("beta");
  assert.equal(await page.locator("#run-list .run-row").count(), 1);
  await page.getByLabel("Filter runs", { exact: true }).fill("");
  await page.getByRole("link", { name: "Investigation alpha", exact: true }).click();
  await page.locator("#main h1").first().waitFor();
  await page.waitForFunction(() => (window as any).oldSnapshots.length > 0);
  const failures = page.locator('details[data-details-key="failed-fetches"]');
  const inherited = page.locator('details[data-details-key="inherited-steering"]');
  await page.locator('[data-details-key="sources"] > summary').click();
  await failures.locator('summary').click();
  const revisions = page.locator('[data-details-key="revision-history"]');
  await revisions.locator(':scope > summary').click();
  await revisions.getByRole("link", { name: "Investigation beta", exact: true }).click();
  await page.getByRole("heading", { name: "Investigation beta", exact: true }).waitFor();
  assert.match(page.url(), /\?run=beta$/);
  assert.equal(await failures.evaluate(el => (el as HTMLDetailsElement).open), false, 'Expansion must not leak between runs');
  await revisions.locator(':scope > summary').click();
  await inherited.locator('summary').click();
  await page.locator('.revision-parent').getByRole("link", { name: "Investigation alpha", exact: true }).click();
  await page.getByRole("heading", { name: "Investigation alpha", exact: true }).waitFor();
  assert.equal(await failures.evaluate(el => (el as HTMLDetailsElement).open), true);
  await page.goBack();
  await page.getByRole("heading", { name: "Investigation beta", exact: true }).waitFor();
  await page.waitForTimeout(1200); // Persisted activity-age polling also replaces snapshots.
  assert.equal(await inherited.evaluate(el => (el as HTMLDetailsElement).open), true);
  assert.equal(await failures.evaluate(el => (el as HTMLDetailsElement).open), false);
  assert.match(await page.locator(".revision-request").textContent() ?? "", /shape and cardinality/);
  await page.screenshot({ path: join(output, "revision-history-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.locator('[data-details-key="revision-panel"] > summary').click();
  await page.screenshot({ path: join(output, "revision-history-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await page.locator("#export-markdown").isDisabled(), true);
  assert.equal(await page.locator("#export-html").isDisabled(), true);
  assert.notEqual((await page.request.get(new URL("markdown?id=beta", server.url).href)).status(), 200);
  assert.notEqual((await page.request.get(new URL("html?id=beta", server.url).href)).status(), 200);
  assert.equal(await page.getByText("Private attachment body is not a downloadable source bundle.").count(), 0);
  await page.screenshot({ path: join(output, "context-permissions.png"), fullPage: true });
  await page.evaluate(() => (window as any).oldSnapshots[0]({ data: JSON.stringify({ tag: "alpha", html: "STALE ALPHA EVENT", at: new Date().toISOString() }) }));
  assert.equal(await page.getByText("STALE ALPHA EVENT").count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Investigation beta", exact: true }).count(), 1);
  await page.getByRole("button", { name: "Investigations", exact: true }).click();
  await page.getByLabel("Search reports", { exact: true }).fill("NEEDLE");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText(/2 matches · 2 reports scanned/).waitFor();
  assert.equal(await page.locator("#search-results script").count(), 0);
  assert.ok(!await page.evaluate(() => (window as any).hacked));
  await page.screenshot({ path: join(output, "inventory-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, "inventory-mobile.png"), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByRole("link", { name: "alpha · line 3", exact: true }).click();
  await page.locator("#report-match").waitFor();
  assert.match(await page.locator("#report-match pre").textContent() ?? "", /needle alpha/);
  await page.waitForTimeout(1100); // A polled snapshot must preserve the linked location.
  assert.equal(await page.locator("#report-match").count(), 1);
  await page.goBack(); await page.getByRole("heading", { name: "Saved investigations", exact: true }).waitFor();
  await page.getByLabel("Search reports", { exact: true }).fill(".*");
  await page.getByLabel("Search reports", { exact: true }).press("Enter");
  await page.getByText(/0 matches · 2 reports scanned/).waitFor();
  await page.route("**/search?*", async route => { await new Promise(resolve => setTimeout(resolve, 300)); await route.continue().catch(() => {}); });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByText("Search cancelled.", { exact: true }).waitFor();
  await page.unrouteAll({ behavior: "wait" });
  // Normal dashboard entry: a selected run changes the initial view, not inventory scope.
  await page.goto(new URL('?run=beta', fullInventory.url).href);
  await page.getByRole('heading', { name: 'Investigation beta', exact: true }).waitFor();
  assert.equal(await page.locator('#inventory').isVisible(), false);
  assert.equal(await page.locator('#export-markdown').isDisabled(), true, 'Full inventory does not bypass per-report export permissions');
  await page.reload();
  await page.getByRole('heading', { name: 'Investigation beta', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Investigations', exact: true }).click();
  await page.getByRole('link', { name: 'Investigation private', exact: true }).waitFor();
  assert.equal(await page.locator('#run-list .run-row').count(), 3);
  assert.equal(new URL(page.url()).search, '');
  await page.goBack();
  await page.getByRole('heading', { name: 'Investigation beta', exact: true }).waitFor();
  await page.goForward();
  await page.getByRole('link', { name: 'Investigation private', exact: true }).click();
  await page.getByRole('heading', { name: 'Investigation private', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('run'), 'private');
  assert.ok(requests.every(url => url.startsWith("http://127.0.0.1:")), requests.join("\n"));
  console.log(`Inventory browser tests passed. Screenshots: ${output}`);
} finally { await browser.close(); await server.close(); await fullInventory.close(); rmSync(root, { recursive: true, force: true }); }

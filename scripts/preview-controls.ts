// Synthetic dashboard controls specimen. No real runs, Pi approvals, or model calls.
import { chromium, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startInventory } from "../src/server.ts";
import { RunStore } from "../src/store.ts";
import { queueFeedback } from "../src/feedback.ts";
import { fixture } from "../tests/fixtures.ts";
import type { DashboardAction, DashboardControls } from "../src/dashboard-controls.ts";
import { revisionSpendingOffer, assertRevisionSpendingApproval } from "../src/revision-approval.ts";
import { approveContext, previewContext } from "../src/context.ts";
import { createLocation } from "../src/paths.ts";

async function checkComposerContrast(page: Page) {
  const luminance = (color: string) => {
    const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(n => n / 255)
      .map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const contrast = ([a, b]: string[]) => {
    const x = luminance(a); const y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  };
  const checks = await page.locator('#feedback-form').evaluate(form => {
    const canvas = getComputedStyle(document.body).backgroundColor;
    const field = form.querySelector('textarea')!;
    const input = getComputedStyle(field); const placeholder = getComputedStyle(field, '::placeholder');
    const button = getComputedStyle(form.querySelector('button')!);
    return {
      text: [input.color, input.backgroundColor],
      placeholder: [placeholder.color, input.backgroundColor],
      borderInside: [input.borderColor, input.backgroundColor],
      borderOutside: [input.borderColor, canvas],
      button: [button.color, button.backgroundColor],
      labels: [...form.querySelectorAll('label, .footnote')].map(el => [getComputedStyle(el).color, canvas]),
      opacity: [input.opacity, placeholder.opacity, button.opacity],
      helpSize: getComputedStyle(form.querySelector('#feedback-help')!).fontSize,
    };
  });
  for (const ratio of [checks.text, checks.placeholder, checks.button, ...checks.labels].map(contrast)) assert.ok(ratio >= 4.5, `Composer text contrast must reach 4.5:1; got ${ratio}`);
  for (const ratio of [checks.borderInside, checks.borderOutside].map(contrast)) assert.ok(ratio >= 3, `Textarea edge contrast must reach 3:1; got ${ratio}`);
  assert.deepEqual(checks.opacity, ['1', '1', '1'], 'Placeholder and disabled controls stay readable instead of fading');
  assert.equal(checks.helpSize, '12px');
}

const root = mkdtempSync(join(tmpdir(), "hpr-controls-browser-"));
const output = resolve("artifacts"); mkdirSync(output, { recursive: true });
const parent = fixture(); parent.tag = "controls-parent"; parent.failures = [];
parent.decomposition!.title = "Choosing a store for a research vault";
parent.report = "# Start with the workload\n\nThis synthetic report demonstrates reading, steering, and linked follow-ups. No research recommendation is implied.\n\n## Questions to resolve\n\nWho owns recovery? How many writers are expected? What would trigger a migration?";
const other = fixture(); other.tag = "controls-other"; other.status = "done";
other.decomposition!.title = "Another saved investigation"; other.report = "# Another report";
other.location = createLocation(root, root, "private-context-fixture");
other.inputs = approveContext(other.location.workspacePath, previewContext(root, { instructions: "Private synthetic background", files: [] }), { model: true, search: false, export: false });
other.location.approvalRefs = [other.inputs.grant.id];
for (const state of [parent, other]) new RunStore(root, state.tag).save(state);
let activeTag: string | undefined = parent.tag;
let hidden = false;
let gate = Promise.resolve();
let release = () => {};
let actionReady = Promise.resolve();
let entered = () => {};
const hold = () => { gate = new Promise<void>(resolve => { release = resolve; }); actionReady = new Promise<void>(resolve => { entered = resolve; }); };
const calls: DashboardAction[] = [];
const controls: DashboardControls = {
  feedback: state => hidden ? { reason: "Controls closed" } : state.status === "done" ? { mode: "revise", spendingApproval: revisionSpendingOffer(state) } : { mode: "steer" },
  session: () => ({ activeTag, preparing: false, hidden }),
  async execute(action) {
    calls.push(action); entered(); await gate;
    if (action.kind === "close") { hidden = true; if (action.mode === "pause") activeTag = undefined; return { kind: "closed", message: activeTag ? "Research UI hidden. Work continues in Pi." : "Research UI closed. Saved investigations are preserved." }; }
    const state = new RunStore(root, action.tag).load();
    if (action.kind === "steer") {
      queueFeedback(state, action.text); new RunStore(root, state.tag).save(state); server.publish(state, true);
      return { kind: "queued", message: "Guidance queued for the next stage boundary." };
    }
    assertRevisionSpendingApproval(state, action.spendingApproval);
    if (state.inputs) return { kind: "cancelled", message: "Private-context reuse was not approved in Pi. No new investigation started; your feedback is retained here." };
    const child = structuredClone(state); child.tag = "linked-child"; child.status = "running";
    child.decomposition!.title = "Follow-up: recovery options";
    child.report = undefined; child.cost = 0; child.tokens = 0; child.elapsedMs = 0; child.workers = [];
    Object.keys(child.steps).forEach((id, index) => { child.steps[id] = index === 0 ? 'running' : 'pending'; });
    child.revision = { parentTag: state.tag, report: state.report!, sourceIds: [], instructions: [] };
    child.feedback = []; queueFeedback(child, action.text); activeTag = child.tag;
    new RunStore(root, child.tag).save(child); server.publish(child, true);
    return { kind: "revision", tag: child.tag, message: "Linked revision started." };
  },
  afterClose: async () => {},
};
const server = await startInventory(root, undefined, controls); server.publish(parent, true);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, colorScheme: "light" });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const requests: string[] = []; page.on("request", req => requests.push(req.url()));
  await page.goto(new URL(`?run=${parent.tag}`, server.url).href);
  await page.getByLabel("Steer research", { exact: true }).waitFor();
  const field = page.locator('#feedback-text');
  await checkComposerContrast(page); // Empty field and disabled action.
  const draft = "Prioritize recovery and a one-person operating model.\nKeep uncertainty explicit.";
  await field.fill(draft);
  await checkComposerContrast(page); // Filled field and enabled action.
  await field.evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(11, 19); });
  parent.tokens++; new RunStore(root, parent.tag).save(parent); server.publish(parent, true);
  await page.locator(`[data-counter="tokens"][data-value="${parent.tokens}"]`).waitFor();
  assert.equal(await field.inputValue(), draft);
  assert.deepEqual(await field.evaluate((el: HTMLTextAreaElement) => [el === document.activeElement, el.selectionStart, el.selectionEnd]), [true, 11, 19]);
  await page.getByRole('button', { name: 'Investigations', exact: true }).click();
  await page.getByRole('link', { name: other.decomposition!.title, exact: true }).click();
  await page.getByLabel('Revise or follow up', { exact: true }).fill('A separate draft');
  await page.goBack(); await page.goBack();
  await page.getByRole('heading', { name: parent.decomposition!.title, exact: true }).waitFor();
  assert.equal(await field.inputValue(), draft, 'Drafts stay with their investigation');
  hold();
  await page.getByRole('button', { name: 'Queue guidance', exact: true }).click();
  await page.getByText('Queuing guidance…', { exact: true }).waitFor();
  assert.equal(await field.evaluate((el: HTMLTextAreaElement) => el.readOnly), true);
  parent.tokens++; new RunStore(root, parent.tag).save(parent); server.publish(parent, true);
  await page.locator(`[data-counter="tokens"][data-value="${parent.tokens}"]`).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Queue guidance', exact: true }).isDisabled(), true);
  assert.equal(await field.inputValue(), draft);
  release();
  await page.getByText('Guidance queued for the next stage boundary.', { exact: true }).waitFor();
  assert.equal(await field.inputValue(), ''); assert.equal(calls.length, 1);
  assert.equal(new RunStore(root, parent.tag).load().feedback.length, 1);
  assert.ok(await page.getByText(draft, { exact: true }).isVisible(), 'Submitted guidance stays visible below the composer');
  await page.screenshot({ path: join(output, 'dashboard-steering-desktop.png'), fullPage: true });

  // Losing the response after commit must not duplicate guidance when the user retries.
  await field.fill('A second instruction');
  await page.route('**/actions', async route => { await route.fetch(); await route.abort(); });
  await page.getByRole('button', { name: 'Queue guidance', exact: true }).click();
  await page.getByText(/Connection lost; the request may have completed/).waitFor();
  await page.unroute('**/actions');
  await page.getByRole('button', { name: 'Queue guidance', exact: true }).click();
  await page.getByText('Guidance queued for the next stage boundary.', { exact: true }).waitFor();
  assert.equal(new RunStore(root, parent.tag).load().feedback.length, 2);
  assert.equal(calls.length, 2, 'Retry reuses the accepted request ID');

  const completed = new RunStore(root, parent.tag).load(); completed.status = 'done';
  completed.feedback.forEach(note => { note.status = 'applied'; note.appliedAt = completed.updatedAt; });
  Object.keys(completed.steps).forEach(id => { completed.steps[id] = 'done'; });
  new RunStore(root, completed.tag).save(completed); activeTag = undefined; server.publish(completed, false);
  await page.getByLabel('Revise or follow up', { exact: true }).waitFor();
  await checkComposerContrast(page);
  await page.locator('.feedback-composer').screenshot({ path: join(output, 'dashboard-followup-empty-light.png') });
  await field.fill('Compare recovery options under a multi-writer workload.');
  await checkComposerContrast(page);
  await page.screenshot({ path: join(output, 'dashboard-followup-desktop.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkComposerContrast(page);
  await page.screenshot({ path: join(output, 'dashboard-followup-dark.png'), fullPage: true });
  const followup = await field.inputValue(); await field.fill('');
  await checkComposerContrast(page);
  await page.locator('.feedback-composer').screenshot({ path: join(output, 'dashboard-followup-empty-dark.png') });
  hidden = true; server.publish(completed, false);
  await page.waitForFunction(() => (document.getElementById('feedback-text') as HTMLTextAreaElement).disabled);
  await checkComposerContrast(page); // Unavailable controls remain legible too.
  await page.emulateMedia({ colorScheme: 'light' });
  await checkComposerContrast(page);
  hidden = false; server.publish(completed, false);
  await page.waitForFunction(() => !(document.getElementById('feedback-text') as HTMLTextAreaElement).disabled);
  await field.fill(followup);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-details-key="revision-panel"] > summary').click();
  await page.screenshot({ path: join(output, 'dashboard-followup-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  // Private-context renewal is still a separate decision, without a duplicate cost dialog.
  await page.getByRole('button', { name: 'Investigations', exact: true }).click();
  await page.getByRole('link', { name: other.decomposition!.title, exact: true }).click();
  await page.getByLabel('Revise or follow up', { exact: true }).waitFor();
  if (!await page.locator('[data-details-key="revision-panel"]').evaluate(el => (el as HTMLDetailsElement).open)) await page.locator('[data-details-key="revision-panel"] > summary').click();
  assert.equal(await field.inputValue(), 'A separate draft');
  hold();
  await page.getByRole('button', { name: 'Start follow-up · $15 model ceiling', exact: true }).click();
  await page.getByText(/Waiting for private-context permission in Pi/).waitFor();
  release();
  await page.getByText(/Private-context reuse was not approved in Pi/).waitFor();
  assert.equal(await field.inputValue(), 'A separate draft');
  await page.getByRole('button', { name: 'Investigations', exact: true }).click();
  await page.getByRole('link', { name: parent.decomposition!.title, exact: true }).click();
  await page.getByLabel('Revise or follow up', { exact: true }).waitFor();
  assert.equal(await field.inputValue(), 'Compare recovery options under a multi-writer workload.');
  hold();
  await page.getByRole('button', { name: 'Start follow-up · $15 model ceiling', exact: true }).click();
  await page.getByText('Starting follow-up with your approved spending terms…', { exact: true }).waitFor();
  assert.equal(await page.getByText(/Waiting for.*Pi/).count(), 0);
  await actionReady;
  assert.deepEqual((calls.at(-1) as Extract<DashboardAction, { kind: 'revise' }>).spendingApproval, revisionSpendingOffer(new RunStore(root, parent.tag).load()));
  release();
  await page.getByRole('heading', { name: 'Follow-up: recovery options', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('run'), 'linked-child');
  assert.equal(new RunStore(root, completed.tag).load().report, completed.report);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.locator('.revision-parent').getByRole('link', { name: parent.decomposition!.title, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close research UI', exact: true }).click();
  await page.getByRole('button', { name: 'Hide UI, keep running', exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'dashboard-close-dialog.png') });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(hidden, false);
  await page.getByRole('button', { name: 'Close research UI', exact: true }).click();
  await page.getByRole('button', { name: 'Hide UI, keep running', exact: true }).click();
  await page.getByText(/Research UI hidden. Work continues in Pi. Reopen/).waitFor();
  assert.equal(activeTag, 'linked-child');
  assert.equal(await page.locator('#feedback-form').count(), 0);
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith('http://127.0.0.1:')));
  console.log(`Dashboard controls browser checks passed. Screenshots: ${output}`);
} finally { release(); await browser.close(); await server.close(); rmSync(root, { recursive: true, force: true }); }

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDashboard, startInventory, type DashboardServer } from "../src/server.ts";
import { RunStore } from "../src/store.ts";
import { renderDashboard } from "../src/dashboard.ts";
import { fixture } from "./fixtures.ts";

async function html(server: DashboardServer, tag: string): Promise<string> {
  const response = await fetch(new URL(`run?id=${tag}`, server.url));
  assert.equal(response.status, 200);
  return (await response.json()).html;
}
function family(root: string) {
  const parent = fixture(); parent.tag = "original"; parent.status = "done";
  const child = fixture(); child.tag = "revision";
  child.revision = { parentTag: parent.tag, report: "# Original report", sourceIds: [], instructions: ["Prefer primary evidence"] };
  child.feedback = [{ id: 1, text: "Compare <MinHash> & alternatives", status: "queued", createdAt: child.createdAt }];
  for (const state of [parent, child]) new RunStore(root, state.tag).save(state);
  return { parent, child };
}

test("inventory links parent and revisions both ways and includes the exact escaped revision request", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-revision-links-"));
  const { parent, child } = family(root); const server = await startInventory(root);
  try {
    const original = await html(server, parent.tag);
    assert.match(original, /Follow-up revisions/);
    assert.match(original, /href="\?run=revision"/);
    assert.match(original, /Compare &lt;MinHash&gt; &amp; alternatives/);
    const revised = await html(server, child.tag);
    assert.match(revised, /href="\?run=original"/);
    assert.match(revised, /Revision request/);
    assert.match(revised, /Prefer primary evidence/);
    assert.doesNotMatch(revised, /<MinHash>/);
    const offline = renderDashboard(child);
    assert.match(offline, /original/);
    assert.doesNotMatch(offline, /data-related-run=/);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

test("revision references do not broaden single-run or selected-run capabilities", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-revision-scope-"));
  const { parent, child } = family(root);
  const single = await startDashboard(child, false, root);
  const parentsOnly = await startInventory(root, new Set([parent.tag]));
  const childrenOnly = await startInventory(root, new Set([child.tag]));
  try {
    for (const server of [single, childrenOnly]) {
      const page = await html(server, child.tag);
      assert.match(page, /Unavailable in this view/);
      assert.match(page, /\/hyperresearch dashboard original/);
      assert.doesNotMatch(page, /data-related-run=/);
      assert.equal((await fetch(new URL("run?id=original", server.url))).status, 404);
    }
    const original = await html(parentsOnly, parent.tag);
    assert.doesNotMatch(original, /Follow-up revisions|Compare &lt;MinHash&gt;/);
    assert.equal((await fetch(new URL("run?id=revision", parentsOnly.url))).status, 404);
  } finally { await Promise.all([single.close(), parentsOnly.close(), childrenOnly.close()]); rmSync(root, { recursive: true, force: true }); }
});

test("missing parents retain a readable reference; new revisions refresh parent links on publish", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-revision-refresh-"));
  const { parent, child } = family(root); const server = await startInventory(root);
  try {
    rmSync(new RunStore(root, parent.tag).dir, { recursive: true });
    assert.match(await html(server, child.tag), /Unavailable in this view/);
    const next = fixture(); next.tag = "next-revision";
    next.revision = { parentTag: child.tag, report: "# Previous", sourceIds: [], instructions: [] };
    new RunStore(root, next.tag).save(next); server.publish(next, false);
    assert.match(await html(server, child.tag), /href="\?run=next-revision"/);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

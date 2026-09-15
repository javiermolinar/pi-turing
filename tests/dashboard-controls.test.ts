import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDashboard, startInventory } from "../src/server.ts";
import { RunStore } from "../src/store.ts";
import { fixture } from "./fixtures.ts";
import type { DashboardControls } from "../src/dashboard-controls.ts";
import { revisionSpendingOffer } from "../src/revision-approval.ts";

const controls = (execute: DashboardControls["execute"]): DashboardControls => ({
  feedback: () => ({ mode: "steer" }), session: () => ({ preparing: false, hidden: false }), execute, afterClose: async () => {},
});

test("dashboard writes require a separate secret, exact origin, JSON, bounded input, and an allowed target", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-control-boundary-"));
  const state = fixture(); state.report = "# Report"; new RunStore(root, state.tag).save(state);
  let calls = 0;
  const server = await startInventory(root, new Set([state.tag]), controls(async () => { calls++; return { kind: "queued", message: "Queued" }; }));
  const readonly = await startDashboard(state, false);
  try {
    const html = await (await fetch(server.url)).text();
    const secret = /data-control-token="([a-f0-9]+)"/.exec(html)![1];
    assert.ok(secret);
    const headers = { Origin: new URL(server.url).origin, "Content-Type": "application/json", "X-Hyperresearch-Control": secret };
    const action = { id: randomUUID(), kind: "steer", tag: state.tag, text: "Prioritize evidence" };
    const post = (body: unknown, custom = headers, url = new URL("actions", server.url)) => fetch(url, { method: "POST", headers: custom, body: JSON.stringify(body) });
    assert.equal((await fetch(new URL("actions", server.url), { headers })).status, 403);
    assert.equal((await post(action, { ...headers, Origin: "https://evil.example" })).status, 403);
    assert.equal((await post(action, { ...headers, Origin: "null" })).status, 403);
    assert.equal((await post(action, { ...headers, Origin: "" })).status, 403);
    assert.equal((await post(action, { ...headers, "X-Hyperresearch-Control": "wrong" })).status, 403);
    assert.equal((await post(action, { ...headers, "Content-Type": "text/plain" })).status, 403);
    assert.equal((await post(action, headers, new URL("run?id=" + state.tag, server.url))).status, 403);
    assert.equal((await post({ ...action, tag: "not-authorized" })).status, 404);
    assert.equal((await post({ ...action, text: " " })).status, 400);
    assert.equal((await post({ ...action, text: "a".repeat(4001) })).status, 400);
    assert.equal((await post({ ...action, text: "a".repeat(25_000) })).status, 400);
    assert.equal((await post({ ...action, command: "rm -rf" })).status, 400);
    assert.equal(calls, 0);
    const response = await post(action); assert.equal(response.status, 200); assert.equal(calls, 1);
    for (const path of [`run?id=${state.tag}`, `html?id=${state.tag}`, `markdown?id=${state.tag}`, "runs"]) {
      const body = await (await fetch(new URL(path, server.url))).text();
      assert.ok(!body.includes(secret), path);
    }
    assert.ok(!(await (await fetch(readonly.url)).text()).includes('data-control-token='));
    assert.equal((await post(action, { ...headers, Origin: new URL(readonly.url).origin }, new URL("actions", readonly.url))).status, 403);
  } finally { await server.close(); await readonly.close(); rmSync(root, { recursive: true, force: true }); }
});

test("a disconnected close request still runs cleanup once, including on retry", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-close-disconnect-"));
  let entered!: () => void; let release!: () => void; let cleaned!: () => void; let cleanups = 0;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const cleanup = new Promise<void>(resolve => { cleaned = resolve; });
  const bridge = controls(async () => { entered(); await hold; return { kind: "closed", message: "Closed" }; });
  bridge.afterClose = async () => { cleanups++; cleaned(); };
  const server = await startInventory(root, undefined, bridge);
  try {
    const secret = /data-control-token="([a-f0-9]+)"/.exec(await (await fetch(server.url)).text())![1];
    const headers = { Origin: new URL(server.url).origin, "Content-Type": "application/json", "X-Hyperresearch-Control": secret };
    const body = JSON.stringify({ id: randomUUID(), kind: "close", mode: "hide" });
    const abort = new AbortController();
    const request = fetch(new URL("actions", server.url), { method: "POST", headers, body, signal: abort.signal });
    await ready; abort.abort(); await assert.rejects(request); release();
    await cleanup;
    const retry = await fetch(new URL("actions", server.url), { method: "POST", headers, body });
    assert.equal(retry.status, 200); await retry.json();
    assert.equal(cleanups, 1);
  } finally { release(); await server.close(); rmSync(root, { recursive: true, force: true }); }
});

test("action IDs deduplicate pending and completed work and cannot change payload", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-action-id-"));
  const state = fixture(); state.status = "done"; state.report = "# Parent"; new RunStore(root, state.tag).save(state);
  let calls = 0; let release!: () => void; let entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const server = await startInventory(root, undefined, controls(async () => { calls++; entered(); await pending; return { kind: "revision", tag: "child", message: "Started" }; }));
  try {
    const secret = /data-control-token="([a-f0-9]+)"/.exec(await (await fetch(server.url)).text())![1];
    const headers = { Origin: new URL(server.url).origin, "Content-Type": "application/json", "X-Hyperresearch-Control": secret };
    const action = { id: randomUUID(), kind: "revise", tag: state.tag, text: "Compare alternatives", spendingApproval: revisionSpendingOffer(state) };
    const post = (body: unknown) => fetch(new URL("actions", server.url), { method: "POST", headers, body: JSON.stringify(body) });
    const first = post(action); await ready;
    const duplicate = post(action);
    assert.equal((await post({ ...action, text: "Different" })).status, 409);
    assert.equal((await post({ ...action, id: randomUUID() })).status, 409);
    release();
    assert.deepEqual(await (await first).json(), await (await duplicate).json());
    assert.equal((await post(action)).status, 200);
    assert.equal(calls, 1);
  } finally { release(); await server.close(); rmSync(root, { recursive: true, force: true }); }
});

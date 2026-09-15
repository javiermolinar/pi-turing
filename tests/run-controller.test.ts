import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RunController } from "../src/run-controller.ts";
import { ResearchRunner } from "../src/runner.ts";
import { ResearchServices } from "../src/services.ts";
import { lockDataRoot, lockWorkspace, writerLocked } from "../src/locks.ts";
import { fixture, forbiddenEvidence } from "./fixtures.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function runner(root: string) {
  return new ResearchRunner(root, fixture(), new ResearchServices(forbiddenEvidence()), {
    checkModels: async () => true,
    run: async () => { throw new Error("No paid work in controller tests"); },
  });
}

test("controller owns both locks through cancellation and worker settlement", async t => {
  const root = mkdtempSync(join(tmpdir(), "hpr-controller-"));
  const controller = new RunController();
  const worker = runner(root);
  const settled = deferred();
  const entered = deferred();
  const stopped = deferred();
  try {
    t.mock.method(worker, "run", async () => {
      entered.resolve();
      await new Promise<void>(resolve => worker.abortController.signal.addEventListener("abort", () => { stopped.resolve(); resolve(); }, { once: true }));
      await settled.promise;
    });
    const started = await controller.start(async scope => {
      await scope.acquire(root, join(root, "workspace"));
      return worker;
    });
    await entered.promise;
    assert.equal(controller.active, worker);
    await assert.rejects(controller.start(async () => worker), /already active/);
    const stopping = controller.stop("paused");
    await stopped.promise;
    assert.equal(await writerLocked(root), true);
    assert.equal(controller.busy, true);
    await assert.rejects(lockWorkspace(join(root, "workspace")), /already being held/);
    settled.resolve();
    await stopping;
    await started!.done;
    assert.equal(controller.busy, false);
    assert.equal(await writerLocked(root), false);
    const unlock = await lockWorkspace(join(root, "workspace"));
    await unlock();
  } finally { settled.resolve(); await controller.shutdown(); rmSync(root, { recursive: true, force: true }); }
});

test("failed workspace lock and failed setup both release an acquired root lock", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-controller-setup-"));
  const controller = new RunController();
  const workspace = join(root, "workspace");
  let unlock: (() => Promise<void>) | undefined;
  try {
    unlock = await lockWorkspace(workspace);
    await assert.rejects(controller.start(async scope => { await scope.acquire(root, workspace); return runner(root); }), /already being held/);
    assert.equal(await writerLocked(root), false);
    await unlock(); unlock = undefined;
    await assert.rejects(controller.start(async scope => {
      await scope.acquire(root, workspace);
      throw new Error("Fixture setup failure");
    }), /Fixture setup failure/);
    assert.equal(controller.busy, false);
    assert.equal(await writerLocked(root), false);
    const rootUnlock = await lockDataRoot(root);
    await rootUnlock();
  } finally { await unlock?.(); await controller.shutdown(); rmSync(root, { recursive: true, force: true }); }
});

test("shutdown cancels startup and waits before releasing its locks", async t => {
  const root = mkdtempSync(join(tmpdir(), "hpr-controller-shutdown-"));
  const controller = new RunController();
  const worker = runner(root);
  const entered = deferred();
  const settled = deferred();
  let calls = 0;
  try {
    t.mock.method(worker, "run", async () => { calls++; });
    const startup = controller.start(async scope => {
      await scope.acquire(root, join(root, "workspace"));
      entered.resolve();
      await settled.promise; // A slow setup adapter may not cooperate with abort.
      return worker;
    });
    await entered.promise;
    const rejected = assert.rejects(startup);
    const shutdown = controller.shutdown();
    assert.equal(controller.signal.aborted, true);
    assert.equal(await writerLocked(root), true);
    settled.resolve();
    await shutdown;
    await rejected;
    assert.equal(calls, 0);
    assert.equal(controller.busy, false);
    assert.equal(await writerLocked(root), false);
    await controller.shutdown();
    await assert.rejects(controller.start(async () => worker));
  } finally { settled.resolve(); await controller.shutdown(); rmSync(root, { recursive: true, force: true }); }
});

test("tool cancellation reaches startup without ending the session controller", async () => {
  const controller = new RunController();
  const abort = new AbortController();
  const entered = deferred();
  try {
    const startup = controller.start(async scope => {
      entered.resolve();
      await new Promise<void>(resolve => scope.signal.addEventListener("abort", () => resolve(), { once: true }));
      scope.signal.throwIfAborted();
      return undefined;
    }, abort.signal);
    await entered.promise;
    abort.abort();
    await assert.rejects(startup);
    assert.equal(controller.signal.aborted, false);
    assert.equal(controller.busy, false);
    assert.equal(await controller.start(async () => undefined), undefined);
  } finally { await controller.shutdown(); }
});

test("shutdown tracks non-worker mutations and rejects concurrent startup", async () => {
  const controller = new RunController();
  const entered = deferred();
  const settled = deferred();
  const mutation = controller.exclusive(async () => { entered.resolve(); await settled.promise; });
  await entered.promise;
  await assert.rejects(controller.start(async () => undefined), /already active/);
  let complete = false;
  const shutdown = controller.shutdown().then(() => { complete = true; });
  await Promise.resolve();
  assert.equal(complete, false);
  settled.resolve();
  await mutation;
  await shutdown;
  assert.equal(controller.busy, false);
});

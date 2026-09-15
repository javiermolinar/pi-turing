import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLocation, dataRoot, packageRoot, privateDirectory, requireLocation } from "../src/paths.ts";
import { inventory, RunStore } from "../src/store.ts";
import { lockDataRoot, lockWorkspace } from "../src/locks.ts";
import { fixture } from "./fixtures.ts";
import { execute } from "../src/process.ts";
import { pathToFileURL } from "node:url";

test("central identity and inventory preserve saved context without materializing or starting work", () => {
  const dir = mkdtempSync(join(tmpdir(), "hpr-central-"));
  try {
    const project = join(dir, "project"); privateDirectory(project);
    const root = join(dir, "data");
    const state = fixture(); state.location = createLocation(project, root);
    privateDirectory(state.location.workspacePath);
    const store = new RunStore(root, state.tag); store.save(state);
    const before = readFileSync(join(store.dir, "pi-state.json"));
    const otherProject = join(dir, "other"); privateDirectory(otherProject);
    // Neither cwd nor the package's installation path enters the central resolver.
    assert.equal(new RunStore(root, state.tag).load().location?.projectPath, state.location.projectPath);
    assert.equal(requireLocation(store.load(), root).workspacePath, state.location.workspacePath);
    assert.equal(inventory(root).runs[0].tag, state.tag);
    assert.deepEqual(readFileSync(join(store.dir, "pi-state.json")), before);
    assert.equal(existsSync(join(project, "research")), false);
    assert.equal(existsSync(join(otherProject, "research")), false);
    assert.equal(statSync(store.dir).mode & 0o777, 0o700);
    assert.equal(statSync(join(store.dir, "pi-state.json")).mode & 0o777, 0o600);
    assert.notEqual(packageRoot, root);
    assert.throws(() => dataRoot("relative"), /absolute/);
    assert.throws(() => requireLocation(fixture(), root), /Legacy/);
    rmSync(state.location.workspacePath, { recursive: true });
    assert.equal(inventory(root).runs.length, 1); // Viewing does not require a backend.
    assert.throws(() => requireLocation(store.load(), root));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("relocated package loads central state and native backend without Python, uv, or PATH tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-relocation-"));
  try {
    const pkg = join(root, "package"); privateDirectory(pkg);
    cpSync(join(packageRoot, "src"), join(pkg, "src"), { recursive: true });
    cpSync(join(packageRoot, "web"), join(pkg, "web"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), '{"type":"module"}');
    symlinkSync(join(packageRoot, "node_modules"), join(pkg, "node_modules"));
    const state = fixture(); const data = join(root, "data"); new RunStore(data, state.tag).save(state);
    const code = `import { RunStore } from ${JSON.stringify(pathToFileURL(join(pkg, "src/store.ts")).href)}; import { NativeBackend } from ${JSON.stringify(pathToFileURL(join(pkg, "src/backend.ts")).href)}; process.env.PATH = ""; console.log(JSON.stringify({ tag: new RunStore(${JSON.stringify(data)}, ${JSON.stringify(state.tag)}).load().tag, profile: await new NativeBackend(${JSON.stringify(join(root, "workspace"))}).initialize() }));`;
    const result = await execute(process.execPath, ["--import", pathToFileURL(join(packageRoot, "node_modules/tsx/dist/loader.mjs")).href, "--input-type=module", "-e", code], { cwd: root });
    assert.equal(result.code, 0, result.stderr);
    const loaded = JSON.parse(result.stdout); assert.equal(loaded.tag, state.tag); assert.equal(loaded.profile.sourceMin, 10);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("inventory exposes corrupt checkpoints and refuses symlink paths and mismatched IDs", () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-inventory-"));
  try {
    const store = new RunStore(root, "test-run"); const state = fixture(); state.tag = "test-run"; store.save(state);
    const bad = join(root, "runs", "broken"); privateDirectory(bad); writeFileSync(join(bad, "pi-state.json"), "{");
    symlinkSync(store.dir, join(root, "runs", "alias"));
    const result = inventory(root);
    assert.equal(result.runs.length, 1); assert.equal(result.issues.length, 2);
    assert.throws(() => new RunStore(root, "../escape"));
    assert.throws(() => store.save({ ...state, tag: "other" }), /match/);
    assert.throws(() => new RunStore(root, "missing").load());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("writer and workspace locks reject competing owners and can be reacquired after release", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-locks-"));
  try {
    for (const acquire of [lockDataRoot, lockWorkspace]) {
      const release = await acquire(root);
      try { await assert.rejects(acquire(root), /lock/i); }
      finally { await release(); }
      await (await acquire(root))();
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

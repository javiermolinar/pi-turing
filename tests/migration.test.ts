import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { migrateLegacy, previewMigration, rollbackMigration } from "../src/migration.ts";
import { privateDirectory } from "../src/paths.ts";
import { lockWorkspace } from "../src/locks.ts";
import { inventory, RunStore } from "../src/store.ts";
import { execute } from "../src/process.ts";
import { fixture } from "./fixtures.ts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "hpr-migration-"));
  const source = join(dir, "checkout"); const root = join(dir, "data");
  privateDirectory(join(source, ".hyperresearch"));
  privateDirectory(join(source, "research", "raw"));
  privateDirectory(join(source, "research", "notes"));
  writeFileSync(join(source, ".hyperresearch", "config.toml"), 'research_dir = "research"');
  writeFileSync(join(source, "research", "raw", "source.pdf"), "immutable asset");
  for (const tag of ["parent", "child"]) {
    const state = fixture(); state.tag = tag; state.status = "done";
    if (tag === "child") state.revision = { parentTag: "parent", report: "Original", sourceIds: [state.sources[0].id], instructions: [] };
    const path = join(source, "research", "runs", tag); privateDirectory(path);
    writeFileSync(join(path, "pi-state.json"), JSON.stringify(state));
    writeFileSync(join(path, "draft-before-feedback-1.md"), "preserved draft");
    writeFileSync(join(source, "research", "notes", `final_report_${tag}.md`), state.report ?? "");
  }
  return { dir, source, root, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("preview is read-only; migration copies a shared workspace once and preserves identity, evidence and originals", async () => {
  const env = setup();
  try {
    const preview = previewMigration(env.source, env.root);
    assert.equal(existsSync(env.root), false); assert.deepEqual(preview.tags, ["child", "parent"]);
    const original = readFileSync(join(env.source, "research", "runs", "parent", "pi-state.json"));
    const id = await migrateLegacy(preview);
    assert.equal(inventory(env.root).runs.length, 2);
    const parent = new RunStore(env.root, "parent").load(); const child = new RunStore(env.root, "child").load();
    assert.equal(parent.location?.workspaceId, child.location?.workspaceId);
    assert.equal(child.revision?.parentTag, "parent"); assert.deepEqual(parent.sources, fixture().sources);
    assert.equal(readFileSync(join(preview.workspacePath, "research", "raw", "source.pdf"), "utf8"), "immutable asset");
    assert.equal(readFileSync(join(env.root, "runs", "parent", "draft-before-feedback-1.md"), "utf8"), "preserved draft");
    assert.deepEqual(readFileSync(join(env.source, "research", "runs", "parent", "pi-state.json")), original);
    assert.throws(() => previewMigration(env.source, env.root), /collision/);
    await rollbackMigration(env.root, id);
    assert.equal(inventory(env.root).runs.length, 0); assert.equal(existsSync(preview.workspacePath), false);
    assert.deepEqual(readFileSync(join(env.source, "research", "runs", "parent", "pi-state.json")), original);
  } finally { env.cleanup(); }
});

test("migration rolls back partial publication and refuses symlinks, collisions, active writers and changing previews", async () => {
  const env = setup();
  try {
    const preview = previewMigration(env.source, env.root);
    const unlock = await lockWorkspace(env.source);
    try { await assert.rejects(migrateLegacy(preview), /lock/i); } finally { await unlock(); }
    await assert.rejects(migrateLegacy(preview, { afterPublish: () => { throw new Error("Injected interruption"); } }), /Injected/);
    assert.equal(existsSync(preview.workspacePath), false); assert.equal(inventory(env.root).runs.length, 0);
    writeFileSync(join(env.source, "research", "notes", "changed.md"), "change");
    await assert.rejects(migrateLegacy(preview), /preview changed/);
    symlinkSync(join(env.source, "research", "raw", "source.pdf"), join(env.source, "research", "raw", "alias"));
    assert.throws(() => previewMigration(env.source, env.root), /symlink/);
    assert.throws(() => previewMigration(env.source, join(env.source, "nested")), /overlap/);
    const alias = join(env.dir, "source-alias"); symlinkSync(env.source, alias);
    assert.throws(() => previewMigration(env.source, join(alias, "nested-data")), /overlap/);
  } finally { env.cleanup(); }
});

test("rollback refuses new work in a migrated destination instead of destroying it", async () => {
  const env = setup();
  try {
    const id = await migrateLegacy(previewMigration(env.source, env.root));
    writeFileSync(join(env.root, "runs", "parent", "new-work.md"), "keep me");
    await assert.rejects(rollbackMigration(env.root, id), /changed destination/);
    assert.equal(inventory(env.root).runs.length, 2);
  } finally { env.cleanup(); }
});

test("hard crash leaves unpublished inventory hidden and stale-lock recovery can roll back safely", async () => {
  const env = setup();
  try {
    const module = pathToFileURL(join(process.cwd(), "src", "migration.ts")).href;
    const code = `import { migrateLegacy, previewMigration } from ${JSON.stringify(module)}; await migrateLegacy(previewMigration(${JSON.stringify(env.source)}, ${JSON.stringify(env.root)}), { afterPublish(key) { if (key === 'child') process.kill(process.pid, 'SIGKILL'); } });`;
    const result = await execute(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: process.cwd() });
    assert.equal(result.code, 1);
    assert.equal(inventory(env.root).runs.length, 0); assert.equal(inventory(env.root).issues.length, 1);
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(env.root, ".writer.lock"), old, old);
    utimesSync(join(env.source, ".hyperresearch-runner.lock"), old, old);
    const id = readdirSync(join(env.root, "migrations"))[0].replace(/\.json$/, "");
    await rollbackMigration(env.root, id);
    assert.equal(inventory(env.root).issues.length, 0);
    assert.equal(existsSync(join(env.source, "research", "runs", "child", "pi-state.json")), true);
  } finally { env.cleanup(); }
});

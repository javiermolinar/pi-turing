import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, lstatSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { chmod, copyFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalPath, createLocation, legacyWorkspaceId, privateDirectory, safePath, validateId } from "./paths.ts";
import { lockDataRoot, lockWorkspace } from "./locks.ts";
import { atomicWrite, RunStore } from "./store.ts";
import { stateSchema } from "./types.ts";

export interface MigrationPreview {
  source: string; root: string; workspaceId: string; workspacePath: string;
  tags: string[]; files: number; bytes: number; warnings: string[];
}
type Manifest = Record<string, string>;
interface Journal {
  version: 1; id: string; preview: MigrationPreview;
  status: "copying" | "publishing" | "complete" | "rolled-back";
  published: string[]; manifests: Record<string, Manifest>;
}
const uuid = (id: string) => { if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid migration ID"); return id; };
const journalPath = (root: string, id: string) => safePath(root, "migrations", `${uuid(id)}.json`);
const stagePath = (root: string, id: string) => safePath(root, `.migration-stage-${uuid(id)}`);

function files(root: string): { path: string; size: number }[] {
  const result: { path: string; size: number }[] = [];
  let bytes = 0;
  function visit(path: string) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Migration refuses symlinks: ${path}`);
    if (stat.isDirectory()) { for (const name of readdirSync(path)) visit(join(path, name)); }
    else {
      if (!stat.isFile()) throw new Error(`Migration refuses nonregular files: ${path}`);
      bytes += stat.size;
      if (stat.size > 1_000_000_000 || bytes > 5_000_000_000 || result.length >= 100_000) throw new Error("Migration size limit exceeded");
      // A raw copy of an active WAL database is not a consistent SQLite snapshot.
      if (path.endsWith(".db-wal") && stat.size > 0) throw new Error("SQLite WAL is nonempty. Stop all writers and checkpoint the database before migration.");
      result.push({ path: relative(root, path), size: stat.size });
    }
  }
  visit(root); return result;
}
function legacyState(source: string, tag: string) {
  const file = safePath(source, "research", "runs", validateId(tag), "pi-state.json");
  if (lstatSync(file).size > 8_000_000) throw new Error("Oversized checkpoint");
  const state = stateSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  if (state.tag !== tag || state.location) throw new Error(`Not a checkout-local checkpoint: ${tag}`);
  return state;
}
export function previewMigration(source: string, root: string): MigrationPreview {
  safePath(source); safePath(root);
  source = canonicalPath(source); root = canonicalPath(root);
  const overlap = (a: string, b: string) => { const rel = relative(a, b); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)); };
  if (overlap(source, root) || overlap(root, source)) throw new Error("Migration source and destination must not overlap");
  safePath(source); safePath(root);
  const runs = safePath(source, "research", "runs");
  const tags = existsSync(runs) ? readdirSync(runs).sort().filter(tag => {
    validateId(tag); safePath(runs, tag);
    return existsSync(join(runs, tag, "pi-state.json"));
  }) : [];
  const warnings: string[] = ["Stop upstream CLI writers too; they do not honor Pi locks. Originals are preserved, not synchronized after migration."];
  for (const tag of tags) {
    const state = legacyState(source, tag);
    if (state.status === "running") warnings.push(`${tag} was saved as running; migration never resumes it.`);
    if (existsSync(safePath(root, "runs", tag))) throw new Error(`Run collision: ${tag}`);
  }
  const workspaceId = legacyWorkspaceId(source);
  const workspacePath = safePath(root, "workspaces", workspaceId);
  if (existsSync(workspacePath)) throw new Error(`Workspace collision: ${workspaceId}`);
  let count = 0; let bytes = 0;
  if (tags.length) {
    for (const part of [".hyperresearch", "research"]) {
      const entries = files(safePath(source, part)); count += entries.length;
      bytes += entries.reduce((n, file) => n + file.size, 0);
    }
  }
  return { source, root, workspaceId, workspacePath, tags, files: count, bytes, warnings };
}
async function hash(path: string, signal?: AbortSignal): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal })) digest.update(chunk);
  return digest.digest("hex");
}
async function manifest(root: string, signal?: AbortSignal): Promise<Manifest> {
  const result: Manifest = Object.create(null);
  for (const file of files(root)) { signal?.throwIfAborted(); result[file.path] = await hash(join(root, file.path), signal); }
  return result;
}
async function copyTree(source: string, target: string, signal: AbortSignal): Promise<void> {
  privateDirectory(target);
  for (const file of files(source)) {
    signal.throwIfAborted();
    const destination = join(target, file.path);
    privateDirectory(resolve(destination, ".."));
    await copyFile(join(source, file.path), destination, 1); // COPYFILE_EXCL
    await chmod(destination, 0o600);
  }
}
function equal(a: Manifest, b: Manifest): boolean {
  const keys = Object.keys(a).sort();
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}
function destination(journal: Journal, key: string): string {
  return key === "_workspace" ? safePath(journal.preview.root, "workspaces", validateId(journal.preview.workspaceId))
    : safePath(journal.preview.root, "runs", validateId(key));
}
function saveJournal(journal: Journal): void { atomicWrite(journalPath(journal.preview.root, journal.id), JSON.stringify(journal, null, 2) + "\n"); }
async function rollback(journal: Journal): Promise<void> {
  // Verify every published tree before deleting any. Never remove changed work.
  for (const key of journal.published) {
    const target = destination(journal, key);
    if (existsSync(target) && (!journal.manifests[key] || !equal(await manifest(target), journal.manifests[key]))) {
      throw new Error(`Rollback refuses changed destination: ${target}. Originals remain at ${journal.preview.source}`);
    }
  }
  for (const key of [...journal.published].reverse()) rmSync(destination(journal, key), { recursive: true, force: true });
  rmSync(stagePath(journal.preview.root, journal.id), { recursive: true, force: true });
  journal.status = "rolled-back"; saveJournal(journal);
}
export async function migrateLegacy(preview: MigrationPreview, options: { signal?: AbortSignal; afterPublish?: (key: string) => void } = {}): Promise<string> {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, options.signal ?? new AbortController().signal, AbortSignal.timeout(300_000)]);
  const unlockRoot = await lockDataRoot(preview.root, error => controller.abort(error));
  let unlockSource: (() => Promise<void>) | undefined;
  let journal: Journal | undefined;
  try {
    unlockSource = await lockWorkspace(preview.source, error => controller.abort(error));
    const current = previewMigration(preview.source, preview.root);
    if (JSON.stringify(current) !== JSON.stringify(preview)) throw new Error("Migration preview changed; preview again before copying");
    if (!preview.tags.length) throw new Error("No checkout-local Pi runs to migrate");
    const id = randomUUID();
    privateDirectory(join(preview.root, "migrations"));
    journal = { version: 1, id, preview, status: "copying", published: [], manifests: {} }; saveJournal(journal);
    const stage = stagePath(preview.root, id); privateDirectory(stage);
    const workspace = join(stage, "_workspace"); privateDirectory(workspace);
    const sourceManifests: Record<string, Manifest> = {};
    for (const part of [".hyperresearch", "research"]) {
      const source = join(preview.source, part); const target = join(workspace, part);
      const before = await manifest(source, signal); sourceManifests[part] = before;
      await copyTree(source, target, signal);
      if (!equal(before, await manifest(target, signal)) || !equal(before, await manifest(source, signal))) throw new Error(`Source changed or copy validation failed: ${source}`);
    }
    for (const tag of preview.tags) {
      const target = join(stage, tag);
      await copyTree(join(workspace, "research", "runs", tag), target, signal);
      const state = legacyState(workspace, tag);
      state.location = createLocation(preview.source, preview.root, preview.workspaceId);
      state.migrationId = id;
      stateSchema.parse(state);
      atomicWrite(join(target, "pi-state.json"), JSON.stringify(state, null, 2) + "\n");
      if (state.report !== undefined) atomicWrite(join(target, "report.md"), state.report);
    }
    journal.manifests._workspace = await manifest(workspace, signal);
    for (const tag of preview.tags) journal.manifests[tag] = await manifest(join(stage, tag), signal);
    for (const part of [".hyperresearch", "research"]) {
      if (!equal(sourceManifests[part], await manifest(join(preview.source, part), signal))) throw new Error(`Source changed before publication: ${part}`);
    }
    journal.status = "publishing"; saveJournal(journal);
    for (const key of ["_workspace", ...preview.tags]) {
      signal.throwIfAborted();
      const target = destination(journal, key); privateDirectory(resolve(target, ".."));
      if (existsSync(target)) throw new Error(`Migration collision: ${target}`);
      // Write ownership intent before rename so crash recovery covers either side.
      journal.published.push(key); saveJournal(journal);
      renameSync(join(stage, key), target);
      options.afterPublish?.(key);
    }
    signal.throwIfAborted();
    journal.status = "complete"; saveJournal(journal); // Visibility commit for all runs.
    for (const tag of preview.tags) new RunStore(preview.root, tag).load();
    rmSync(stage, { recursive: true });
    return id;
  } catch (error) {
    if (journal) {
      try { await rollback(journal); }
      catch (failure) { throw new AggregateError([error, failure], `Migration interrupted; inspect ${journalPath(preview.root, journal.id)}. Originals preserved.`); }
    }
    throw error;
  } finally { try { await unlockSource?.(); } finally { await unlockRoot(); } }
}
export async function rollbackMigration(root: string, id: string): Promise<void> {
  safePath(root); root = canonicalPath(root);
  const release = await lockDataRoot(root);
  try {
    const journal = JSON.parse(readFileSync(journalPath(root, id), "utf8")) as Journal;
    if (journal.version !== 1 || journal.id !== id || resolve(journal.preview.root) !== resolve(root) ||
      journal.preview.workspaceId !== legacyWorkspaceId(journal.preview.source) || !journal.published.every(key => key === "_workspace" || journal.preview.tags.includes(key))) throw new Error("Invalid migration journal");
    const unlock = await lockWorkspace(journal.preview.source);
    try { await rollback(journal); } finally { await unlock(); }
  } finally { await release(); }
}

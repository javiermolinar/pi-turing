import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunState } from "./types.ts";

export const packageRoot = fileURLToPath(new URL("../", import.meta.url));
/** Resolve existing ancestor aliases even when the selected directory is new. */
export function canonicalPath(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  if (dirname(absolute) === absolute) throw new Error(`No existing filesystem ancestor: ${absolute}`);
  return join(canonicalPath(dirname(absolute)), basename(absolute));
}
export function dataRoot(override = process.env.TURING_DATA_ROOT ?? process.env.HYPERRESEARCH_DATA_ROOT): string {
  if (override !== undefined && !isAbsolute(override)) throw new Error("TURING_DATA_ROOT (or legacy HYPERRESEARCH_DATA_ROOT) must be an absolute path");
  // Keep the storage identity and writer locks stable across the product rename.
  // Existing runs pin their absolute workspace paths; no implicit move or rewrite.
  const root = resolve(override ?? join(homedir(), ".pi", "hyperresearch"));
  safePath(root);
  return canonicalPath(root);
}
export function validateId(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)) throw new Error("Invalid run tag or workspace ID");
  return id;
}
// Check every component below the caller-selected root. Ancestor symlinks (e.g.
// macOS /var -> /private/var) are canonicalized once, not mistaken for escapes.
export function safePath(root: string, ...parts: string[]): string {
  let path = resolve(root);
  for (const part of ["", ...parts]) {
    path = join(path, part);
    try { if (lstatSync(path).isSymbolicLink()) throw new Error(`Refusing symlink: ${path}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return path;
}
export function privateDirectory(path: string): void {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Refusing unsafe directory: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    privateDirectory(dirname(path));
    mkdirSync(path, { mode: 0o700 });
  }
}
export function createLocation(project: string, root = dataRoot(), workspaceId: string = randomUUID()): NonNullable<RunState["location"]> {
  validateId(workspaceId);
  safePath(root); root = canonicalPath(root);
  return { projectPath: realpathSync(project), dataRoot: root, workspaceId,
    workspacePath: join(root, "workspaces", workspaceId), contextRefs: [], approvalRefs: [] };
}
export function legacyWorkspaceId(project: string): string {
  return `legacy-${createHash("sha256").update(realpathSync(project)).digest("hex").slice(0, 24)}`;
}
export function requireLocation(state: RunState, root: string): NonNullable<RunState["location"]> {
  const location = state.location;
  if (!location) throw new Error("Legacy checkpoint has no saved workspace identity. Migrate it explicitly before resuming.");
  safePath(root); root = canonicalPath(root);
  if (canonicalPath(location.dataRoot) !== root || canonicalPath(location.workspacePath) !== join(root, "workspaces", validateId(location.workspaceId))) {
    throw new Error("Saved workspace location does not match the configured data root; explicit migration is required");
  }
  const workspace = safePath(root, "workspaces", location.workspaceId);
  if (!lstatSync(workspace).isDirectory()) throw new Error(`Missing workspace: ${workspace}`);
  safePath(workspace, ".pi-research"); safePath(workspace, ".hyperresearch"); safePath(workspace, "research");
  return location;
}

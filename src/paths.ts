import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunState } from "./types.ts";

export const packageRoot = fileURLToPath(new URL("../", import.meta.url));
export function dataRoot(override = process.env.HYPERRESEARCH_DATA_ROOT): string {
  if (override !== undefined && !isAbsolute(override)) throw new Error("HYPERRESEARCH_DATA_ROOT must be an absolute path");
  return resolve(override ?? join(homedir(), ".pi", "hyperresearch"));
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
export function createLocation(project: string, root = dataRoot(), workspaceId = randomUUID()): NonNullable<RunState["location"]> {
  validateId(workspaceId);
  return { projectPath: realpathSync(project), dataRoot: resolve(root), workspaceId,
    workspacePath: join(resolve(root), "workspaces", workspaceId), contextRefs: [], approvalRefs: [] };
}
export function legacyWorkspaceId(project: string): string {
  return `legacy-${createHash("sha256").update(realpathSync(project)).digest("hex").slice(0, 24)}`;
}
export function requireLocation(state: RunState, root: string): NonNullable<RunState["location"]> {
  const location = state.location;
  if (!location) throw new Error("Legacy checkpoint has no saved workspace identity. Migrate it explicitly before resuming.");
  if (resolve(location.dataRoot) !== resolve(root) || location.workspacePath !== join(resolve(root), "workspaces", validateId(location.workspaceId))) {
    throw new Error("Saved workspace location does not match the configured data root; explicit migration is required");
  }
  const workspace = safePath(root, "workspaces", location.workspaceId);
  if (!lstatSync(workspace).isDirectory()) throw new Error(`Missing workspace: ${workspace}`);
  safePath(workspace, ".hyperresearch"); safePath(workspace, "research");
  return location;
}

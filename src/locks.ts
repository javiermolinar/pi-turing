import { join } from "node:path";
import lockfile from "proper-lockfile";
import { privateDirectory, safePath } from "./paths.ts";

/** Conservative single writer per data root while the Python adapter is retained. */
export async function lockDataRoot(root: string, onCompromised?: (error: Error) => void): Promise<() => Promise<void>> {
  privateDirectory(root);
  safePath(root, ".writer.lock");
  return lockfile.lock(root, { lockfilePath: join(root, ".writer.lock"), retries: 0,
    stale: 30_000, update: 10_000, onCompromised });
}
export async function lockWorkspace(workspace: string, onCompromised?: (error: Error) => void): Promise<() => Promise<void>> {
  privateDirectory(workspace);
  safePath(workspace, ".hyperresearch-runner.lock");
  return lockfile.lock(workspace, { lockfilePath: join(workspace, ".hyperresearch-runner.lock"), retries: 0,
    stale: 30_000, update: 10_000, onCompromised });
}

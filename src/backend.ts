import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execute } from "./process.ts";
import { searchProviderSchema, webSearch } from "./search.ts";

export type BackendAction = "doctor" | "init" | "create_run" | "set_step" | "set_status" | "finish" | "retractions" | "vault_search" | "scholar_search" | "web_search" | "fetch_source" | "read_source";
export interface Backend {
  call<T = unknown>(action: BackendAction, args?: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
}
export const backendDir = fileURLToPath(new URL("../backend/", import.meta.url));
const python = join(backendDir, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

export async function setupBackend(cwd: string, signal?: AbortSignal): Promise<void> {
  const result = await execute("uv", ["sync", "--project", backendDir, "--locked", "--python", "3.13"],
    { cwd, signal, timeoutMs: 600_000 });
  if (result.code !== 0) throw new Error(`Backend setup failed: ${result.stderr.slice(-3000)}`);
}

export class PythonBackend implements Backend {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly cwd: string) {}
  call<T>(action: BackendAction, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const operation = this.queue.then(async () => {
      signal?.throwIfAborted();
      if (action === "web_search") {
        // Search goes directly to the selected service in Node, never through upstream providers.
        return await webSearch(searchProviderSchema.parse(args.provider), args.query as string, { signal }) as T;
      }
      try { await access(python); } catch { throw new Error("Python backend missing. Run /hyperresearch setup first (requires uv)."); }
      const result = await execute(python, [join(backendDir, "bridge.py")], {
        cwd: this.cwd, input: JSON.stringify({ action, args }), signal,
      });
      let envelope: { ok: boolean; error?: string; data: T };
      try { envelope = JSON.parse(result.stdout); }
      catch { throw new Error(`Invalid backend response (${action}): ${result.stderr.slice(-1500)}`); }
      if (!envelope.ok || result.code !== 0) throw new Error(envelope.error ?? `Backend ${action} failed`);
      return envelope.data;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

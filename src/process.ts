import { spawn } from "node:child_process";

/** Bounded, shell-free process execution. Cancellation waits for process exit. */
export function execute(command: string, args: string[], options: {
  cwd: string; input?: string; signal?: AbortSignal; timeoutMs?: number; maxBytes?: number;
}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted();
    const child = spawn(command, args, { cwd: options.cwd, shell: false,
      detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", bytes = 0, failure: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* Process already exited. */ }
    };
    const stop = (reason: string) => {
      if (failure) return;
      failure = new Error(reason);
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 1500);
    };
    const abort = () => stop("Cancelled");
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop("Process timed out"), options.timeoutMs ?? 180_000);
    const cleanup = () => {
      clearTimeout(timer); clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
    };
    for (const [stream, name] of [[child.stdout, "stdout"], [child.stderr, "stderr"]] as const) {
      stream.setEncoding("utf8");
      stream.on("data", (text: string) => {
        bytes += Buffer.byteLength(text);
        if (bytes > (options.maxBytes ?? 2_000_000)) { stop("Process output exceeded limit"); return; }
        if (name === "stdout") stdout += text; else stderr += text;
      });
    }
    child.once("error", error => { cleanup(); reject(error); });
    child.once("close", code => { if (failure) kill("SIGKILL"); cleanup(); failure ? reject(failure) : resolve({ stdout, stderr, code: code ?? 1 }); });
    child.stdin.on("error", () => { /* EPIPE is reported by the exit status. */ });
    child.stdin.end(options.input ?? "");
    if (options.signal?.aborted) abort();
  });
}

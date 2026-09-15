import { lockDataRoot, lockWorkspace } from "./locks.ts";
import type { ResearchRunner } from "./runner.ts";

export interface LaunchScope {
  signal: AbortSignal;
  acquire(root: string, workspace: string): Promise<void>;
}
export interface StartedRun { runner: ResearchRunner; done: Promise<void> }

/** One owner for startup, active work, cancellation, and lock release. No Pi UI. */
export class RunController {
  private lifecycle = new AbortController();
  private pending?: Promise<unknown>;
  private running?: StartedRun;
  constructor(private onLockLost: (error: Error) => void = () => {}) {}

  get signal() { return this.lifecycle.signal; }
  get active() { return this.running?.runner; }
  get preparing() { return !!this.pending; }
  get busy() { return !!this.pending || !!this.running; }

  /** Also tracks non-worker mutations so shutdown waits for them to settle. */
  exclusive<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.busy) return Promise.reject(new Error("A run or state change is already active. Pause or cancel it first."));
    const signal = this.signal;
    const operation = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return work(signal);
    }).finally(() => {
      if (this.pending === operation) this.pending = undefined;
    });
    this.pending = operation;
    return operation;
  }

  start(prepare: (scope: LaunchScope) => Promise<ResearchRunner | undefined>, requestSignal?: AbortSignal): Promise<StartedRun | undefined> {
    return this.exclusive(async lifecycleSignal => {
      const signal = requestSignal ? AbortSignal.any([lifecycleSignal, requestSignal]) : lifecycleSignal;
      const releases: (() => Promise<void>)[] = [];
      const release = async () => {
        // Attempt every release even if a lock has already been compromised.
        const failures: unknown[] = [];
        while (releases.length) {
          try { await releases.pop()!(); } catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, "Runner lock release failed");
      };
      const lost = (error: Error) => {
        this.lifecycle.abort(error);
        this.active?.stop("paused");
        this.onLockLost(error);
      };
      try {
        signal.throwIfAborted();
        const runner = await prepare({
          signal,
          acquire: async (root, workspace) => {
            signal.throwIfAborted();
            releases.push(await lockDataRoot(root, lost));
            signal.throwIfAborted();
            releases.push(await lockWorkspace(workspace, lost));
            signal.throwIfAborted();
          },
        });
        if (!runner) { await release(); return; }
        if (signal.aborted) { runner.stop("paused"); signal.throwIfAborted(); }
        const stop = () => runner.stop("paused");
        signal.addEventListener("abort", stop, { once: true });
        const started: StartedRun = {
          runner,
          done: Promise.resolve().then(() => runner.run()).finally(async () => {
            signal.removeEventListener("abort", stop);
            // Keep ownership until both workers and lock cleanup have settled.
            try { await release(); }
            finally { if (this.running === started) this.running = undefined; }
          }),
        };
        this.running = started;
        // Background command callers may attach their completion handler later.
        void started.done.catch(() => {});
        return started;
      } catch (error) {
        await release();
        throw error;
      }
    });
  }

  /** Wait for normal completion and lock release without interrupting the runner. */
  async waitForCompletion(): Promise<void> {
    await this.running?.done;
  }

  async stop(reason: "paused" | "aborted"): Promise<void> {
    const started = this.running;
    started?.runner.stop(reason);
    await started?.done;
  }

  async shutdown(): Promise<void> {
    this.lifecycle.abort();
    this.active?.stop("paused");
    await this.pending?.catch(() => {});
    this.active?.stop("paused");
    await this.running?.done.catch(() => {});
  }
}

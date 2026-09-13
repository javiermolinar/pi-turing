import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { RunState } from "./types.ts";
import { progressLines } from "./progress.ts";

/** Own animation only; never replaces or captures the Pi editor. */
export class ResearchWidget implements Component {
  private state?: RunState;
  private live = false;
  private url?: string;
  private frame = 0;
  private timer?: NodeJS.Timeout;
  private disposed = false;
  constructor(private requestRender: () => void, private theme: Pick<Theme, "fg">) {}
  update(state: RunState, live: boolean, url?: string): void {
    if (this.disposed) return;
    this.state = state; this.live = live; this.url = url;
    if (live && state.status === "running") {
      this.timer ??= setInterval(() => { this.frame++; this.requestRender(); }, 120);
      this.timer.unref();
    } else { clearInterval(this.timer); this.timer = undefined; }
    this.requestRender();
  }
  render(width: number): string[] {
    if (!this.state || this.disposed || width <= 0) return [];
    return progressLines(this.state, this.live, Date.now(), this.frame, this.url).map((line, index) =>
      this.theme.fg(index === 0 ? (this.state!.status === "done" ? "success" : "accent") : index === 2 ? "text" : index === 1 || index === 3 ? "muted" : "dim", truncateToWidth(line, width)));
  }
  invalidate(): void {} // No rendered/themed strings are cached.
  dispose(): void { this.disposed = true; clearInterval(this.timer); this.timer = undefined; }
}

// UI-only Pi fixture for VHS captures. No runner, backend, network, or model calls.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ResearchWidget } from "../src/widget.ts";
import { fixture } from "../tests/fixtures.ts";

export default function preview(pi: ExtensionAPI) {
  let widget: ResearchWidget | undefined;
  // A mistyped demo command must never fall through to a paid model request.
  pi.on("input", () => ({ action: "handled" }));
  pi.registerCommand("widget-demo", {
    description: "Render fixture research progress (running/paused/done)",
    async handler(args, ctx) {
      if (ctx.mode !== "tui") return;
      widget?.dispose();
      const state = fixture();
      state.status = args === "paused" ? "paused" : args === "done" ? "done" : "running";
      state.activity = { text: "research-1: Reading primary-source-note · page 2", at: new Date(Date.now() - 7000).toISOString() };
      state.feedback = [{ id: 1, text: "Prioritize primary sources", status: "queued", createdAt: new Date().toISOString() }];
      ctx.ui.setWidget("hyperresearch-demo", (tui, theme) => {
        widget = new ResearchWidget(() => tui.requestRender(), theme);
        widget.update(state, state.status === "running"); return widget;
      });
      ctx.ui.notify("UI fixture only — no research or model calls", "info");
    },
  });
  pi.on("session_shutdown", () => widget?.dispose());
}

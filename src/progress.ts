import { cleanTerminal, stepIds, stepNames, type RunState } from "./types.ts";
import { feedbackSummary } from "./feedback.ts";

export const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export function activityAge(state: RunState, timestamp = Date.now()): string {
  if (!state.activity) return "No activity recorded";
  const seconds = Math.max(0, Math.floor((timestamp - Date.parse(state.activity.at)) / 1000));
  if (!Number.isFinite(seconds)) return "Activity time unknown";
  return `Last activity ${seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`} ago`;
}

/** Pure display model: heartbeat timestamps never masquerade as worker activity. */
export function progressLines(state: RunState, live: boolean, timestamp = Date.now(), frame = 0, url?: string): string[] {
  const running = live && state.status === "running";
  const step = stepIds.find(id => state.steps[id] === "running");
  const marker = running ? spinnerFrames[frame % spinnerFrames.length] : state.status === "done" ? "✓" : "○";
  const status = state.status === "running" && !live ? "last recorded running (not live)" : state.status;
  const count = state.sources.filter(s => s.fullRead).length;
  return [
    `${marker} Hyperresearch · ${status}${running ? ` · ${step ? stepNames[step] : "Preparing / verifying"}` : ""}`,
    `${count}/${state.config.sourceTarget} target full reads · ${running ? state.workers.filter(w => w.status === "running").length : 0} live workers · ${state.pricingKnown ? "~$" + state.cost.toFixed(2) : "cost unknown"}`,
    `${running ? activityAge(state, timestamp) : "Saved activity"} · ${state.activity?.text ?? "No worker activity recorded"}`,
    `Steering: ${feedbackSummary(state)}${state.reportStale ? " · previous draft is stale" : ""}`,
    state.reason ?? (state.status === "done" ? `/hyperresearch revise ${state.tag} <feedback>` : "Chat stays separate · /hyperresearch steer <feedback> · /hyperresearch pause"),
    url ?? `/hyperresearch dashboard · ${state.tag}`,
  ].map(cleanTerminal);
}

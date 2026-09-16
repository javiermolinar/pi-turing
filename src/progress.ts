import { cleanTerminal, isReadOnlyRun, stepIds, stepNames, type RunState } from "./types.ts";
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
  const archived = isReadOnlyRun(state);
  const running = !archived && live && state.status === "running";
  const step = stepIds.find(id => state.steps[id] === "running");
  const marker = running ? spinnerFrames[frame % spinnerFrames.length] : state.status === "done" ? "✓" : "○";
  const status = state.status === "running" && !live ? "last recorded running (not live)" : state.status;
  const count = state.sources.filter(s => s.fullRead).length;
  return [
    `${marker} Turing · ${archived ? "read-only legacy · " : ""}${status}${running ? ` · ${step ? stepNames[step] : "Preparing / verifying"}` : ""}`,
    `${count}/${state.config.sourceTarget} target full reads · ${running ? state.workers.filter(w => w.status === "running").length : 0} live workers · ${state.pricingKnown ? "~$" + state.cost.toFixed(2) : "cost unknown"}`,
    `${running ? activityAge(state, timestamp) : "Saved activity"} · ${state.activity?.text ?? "No worker activity recorded"}`,
    `Steering: ${feedbackSummary(state)}${state.reportStale ? " · previous draft is stale" : ""}`,
    archived ? "Execution removed · saved report and historical checks only" : state.reason ?? (state.status === "done" ? `/turing revise ${state.tag} <feedback>` : "Chat stays separate · /turing steer <feedback> · /turing pause"),
    url ?? `/turing dashboard · ${state.tag}`,
  ].map(cleanTerminal);
}

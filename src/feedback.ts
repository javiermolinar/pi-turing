import { feedbackTextSchema, now, requireLightRun, type Feedback, type RunState } from "./types.ts";

/** Host commands only. Call under the vault lock, then persist the checkpoint. */
export function queueFeedback(state: RunState, input: string): Feedback {
  requireLightRun(state);
  if (["done", "aborted"].includes(state.status)) throw new Error("This run is closed. Use /hyperresearch revise <tag> <feedback> for a completed report.");
  const text = feedbackTextSchema.parse(input);
  if (state.feedback.length >= 20) throw new Error("Feedback limit reached (20 per run). Start a new research question.");
  const note: Feedback = { id: Math.max(0, ...state.feedback.map(f => f.id)) + 1, text, status: "queued", createdAt: now() };
  state.feedback.push(note);
  return note;
}

export function feedbackSummary(state: RunState): string {
  return `${state.feedback.filter(f => f.status === "queued").length} queued · ${state.feedback.filter(f => f.status === "applied").length} applied`;
}

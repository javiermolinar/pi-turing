import { z } from "zod";
import { feedbackTextSchema, type RunState } from "./types.ts";
import { revisionSpendingApprovalSchema, type RevisionSpendingApproval } from "./revision-approval.ts";

const id = z.string().uuid();
export const dashboardActionSchema = z.discriminatedUnion("kind", [
  z.object({ id, kind: z.literal("steer"), tag: z.string().min(1).max(160), text: feedbackTextSchema }).strict(),
  z.object({ id, kind: z.literal("revise"), tag: z.string().min(1).max(160), text: feedbackTextSchema, spendingApproval: revisionSpendingApprovalSchema }).strict(),
  z.object({ id, kind: z.literal("close"), mode: z.enum(["hide", "pause"]), activeTag: z.string().max(160).optional() }).strict(),
]);
export type DashboardAction = z.infer<typeof dashboardActionSchema>;
export interface FeedbackControl { mode?: "steer" | "revise"; reason?: string; spendingApproval?: RevisionSpendingApproval }
export interface DashboardControlState { activeTag?: string; preparing: boolean; hidden: boolean }
export interface DashboardActionResult {
  kind: "queued" | "revision" | "cancelled" | "closed";
  message: string;
  tag?: string;
}
/** Only supplied by an explicitly approved Pi session. Read-only servers have no actions. */
export interface DashboardControls {
  feedback(state: RunState): FeedbackControl;
  session(): DashboardControlState;
  // Accepted requests are durable for this server lifetime. Disconnecting does not cancel Pi approval.
  execute(action: DashboardAction): Promise<DashboardActionResult>;
  afterClose(): Promise<void>;
}

import { createHash } from "node:crypto";
import { z } from "zod";
import type { RunState } from "./types.ts";
import { requireLightRun } from "./run-policy.ts";

/** Browser authorization covers these exact terms, not an arbitrary future revision. */
export const revisionSpendingApprovalSchema = z.object({
  proposalId: z.string().regex(/^[a-f0-9]{64}$/),
  budgetUsd: z.number().finite().positive().nullable(),
}).strict();
export type RevisionSpendingApproval = z.infer<typeof revisionSpendingApprovalSchema>;
export const revisionSpendingRecordSchema = revisionSpendingApprovalSchema.extend({
  source: z.literal("dashboard"), requestId: z.string().uuid(), at: z.string().datetime(),
}).strict();
export type RevisionSpendingRecord = z.infer<typeof revisionSpendingRecordSchema>;

export class RevisionApprovalChangedError extends Error {
  constructor() { super("Follow-up terms changed. Review the current model-cost ceiling and submit again."); }
}

export function revisionSpendingOffer(state: RunState): RevisionSpendingApproval {
  requireLightRun(state);
  if (state.status !== "done" || !state.report) throw new Error("Only completed reports can start a follow-up.");
  // Bind the parent report, evidence/context identities, model, configuration, and
  // budget. A newer checkpoint needs a new explicit click, even at the same price.
  return revisionSpendingApprovalSchema.parse({
    proposalId: createHash("sha256").update("revision-spending-v1\n" + JSON.stringify(state)).digest("hex"),
    budgetUsd: state.config.budgetUsd,
  });
}

export function assertRevisionSpendingApproval(state: RunState, approval: RevisionSpendingApproval): void {
  const expected = revisionSpendingOffer(state);
  if (approval.proposalId !== expected.proposalId || approval.budgetUsd !== expected.budgetUsd) throw new RevisionApprovalChangedError();
}

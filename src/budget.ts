import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RunState } from "./types.ts";
import { requireLightRun } from "./run-policy.ts";

export const budgetAdditionSchema = z.number().finite().positive().max(1_000_000)
  .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7, "Budget additions require whole cents");
export const budgetAdjustmentSchema = z.object({
  id: z.string().uuid(), at: z.string(), amount: budgetAdditionSchema,
  previousCeiling: z.number().finite().positive(), newCeiling: z.number().finite().positive(),
  spentAtApproval: z.number().finite().nonnegative(), approval: z.enum(["interactive", "explicit-flag"]),
}).strict();
export interface BudgetTopUp { tag: string; amount: number; previousCeiling: number; newCeiling: number; spent: number }

export function budgetExhausted(state: Pick<RunState, "cost" | "config">): boolean {
  return state.config.budgetUsd !== null && state.cost >= state.config.budgetUsd;
}
/** A proposal is read-only. It is not permission to spend or a change to saved state. */
export function proposeBudgetTopUp(state: RunState, amount: number): BudgetTopUp {
  requireLightRun(state);
  budgetAdditionSchema.parse(amount);
  if (["done", "aborted"].includes(state.status)) throw new Error(`Cannot add budget to a ${state.status} run`);
  if (state.config.budgetUsd === null) throw new Error("This run already has an unlimited model budget; a top-up is not applicable");
  if ((state.budgetAdjustments?.length ?? 0) >= 100) throw new Error("Budget adjustment history limit reached");
  const previousCeiling = state.config.budgetUsd;
  const newCeiling = previousCeiling + amount;
  if (!Number.isFinite(newCeiling) || newCeiling <= previousCeiling) throw new Error("Invalid budget total");
  if (newCeiling <= state.cost) throw new Error(`Top-up would leave the ceiling at or below the $${state.cost.toFixed(2)} already spent; choose a larger --add-budget amount`);
  return { tag: state.tag, amount, previousCeiling, newCeiling, spent: state.cost };
}
/** Caller must hold run/workspace locks, verify the approved checkpoint has not
 * changed, and save this state atomically before starting model work. */
export function applyBudgetTopUp(state: RunState, proposal: BudgetTopUp, approval: "interactive" | "explicit-flag"): void {
  const current = proposeBudgetTopUp(state, proposal.amount);
  if (current.tag !== proposal.tag || current.previousCeiling !== proposal.previousCeiling || current.newCeiling !== proposal.newCeiling || current.spent !== proposal.spent) throw new Error("Run budget/spend changed since approval; approve a fresh proposal");
  const adjustment = budgetAdjustmentSchema.parse({ id: randomUUID(), at: new Date().toISOString(), amount: proposal.amount,
    previousCeiling: proposal.previousCeiling, newCeiling: proposal.newCeiling, spentAtApproval: proposal.spent, approval });
  (state.budgetAdjustments ??= []).push(adjustment);
  state.config.budgetUsd = proposal.newCeiling;
}
export function budgetTopUpSummary(proposal: BudgetTopUp): string {
  return `Add $${proposal.amount.toFixed(2)} to this run's total model-cost ceiling?\n` +
    `Already spent: $${proposal.spent.toFixed(2)}\nPrevious ceiling: $${proposal.previousCeiling.toFixed(2)}\nNew total ceiling: $${proposal.newCeiling.toFixed(2)}\n` +
    `Remaining estimate: $${(proposal.newCeiling - proposal.spent).toFixed(2)}\n` +
    "Spend and completed stages are preserved; required reviews are not skipped. In-flight calls can overshoot the estimate; search fees are separate. Only this saved run changes, not project defaults.";
}

export interface ResumeOptions { tag?: string; useProjectConfig: boolean; addBudget?: number }
const usage = "Usage: resume [tag] [--add-budget <USD> | --use-project-config]";
export function parseResumeOptions(args: string[]): ResumeOptions {
  const result: ResumeOptions = { useProjectConfig: false };
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === "--use-project-config") {
      if (result.useProjectConfig) throw new Error(usage);
      result.useProjectConfig = true;
    } else if (value === "--add-budget" || value.startsWith("--add-budget=")) {
      if (result.addBudget !== undefined) throw new Error(usage);
      const amount = value === "--add-budget" ? args[++index] : value.slice("--add-budget=".length);
      if (!amount || !/^\d+(?:\.\d{1,2})?$/.test(amount)) throw new Error("--add-budget requires a positive USD amount with at most two decimals");
      result.addBudget = budgetAdditionSchema.parse(Number(amount));
    } else {
      if (result.tag !== undefined || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(value)) throw new Error(usage);
      result.tag = value;
    }
  }
  if (result.useProjectConfig && result.addBudget !== undefined) throw new Error("Use either --add-budget or --use-project-config, not both");
  return result;
}

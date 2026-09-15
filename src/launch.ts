import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { contextPermissions, confirmResearch } from "./approvals.ts";
import { approveContext, previewContext, reapproveContext, validateContext, type ContextPreview } from "./context.ts";
import type { Disclosure } from "./context-types.ts";
import { NativeBackend } from "./backend.ts";
import { ResearchServices } from "./services.ts";
import { applyBudgetTopUp, budgetExhausted, proposeBudgetTopUp, type BudgetTopUp } from "./budget.ts";
import { createLocation, dataRoot, requireLocation } from "./paths.ts";
import { ResearchRunner } from "./runner.ts";
import type { LaunchScope } from "./run-controller.ts";
import { ensureSearchConfigured } from "./search.ts";
import { requireResearchConfig, resumeRecovery, structuralRecoveryReason } from "./recovery.ts";
import { loadConfig, RunStore } from "./store.ts";
import { configSchema, requireLightRun, type RunState } from "./types.ts";
import { PiWorkerDriver } from "./worker.ts";
import { assertRevisionSpendingApproval, revisionSpendingRecordSchema, type RevisionSpendingRecord } from "./revision-approval.ts";

export type LaunchRequest =
  | { kind: "start"; query: string }
  | { kind: "resume"; tag: string; useProjectConfig?: boolean; addBudget?: number }
  | { kind: "revise"; tag: string; feedback: string; spendingApproval?: RevisionSpendingRecord };

/** Prepare an approved runner. The controller owns its lifetime and locks. */
export async function prepareResearch(ctx: ExtensionContext, request: LaunchRequest, scope: LaunchScope,
  show: (state: RunState) => void, say: (text: string) => void): Promise<ResearchRunner | undefined> {
  if (!ctx.isProjectTrusted()) throw new Error("Trust this project in Pi before starting research or reading project-local configuration.");
  const { signal } = scope;
  signal.throwIfAborted();
  const root = dataRoot();
  const selected = request.kind === "start" ? undefined : new RunStore(root, request.tag).load();
  if (selected) requireLightRun(selected);
  const spendingApproval = request.kind === "revise" && request.spendingApproval
    ? revisionSpendingRecordSchema.parse(request.spendingApproval) : undefined;
  if (spendingApproval) assertRevisionSpendingApproval(selected!, spendingApproval);
  if (request.kind === "resume" && selected) {
    if (["done", "aborted"].includes(selected.status)) throw new Error(`Cannot resume a ${selected.status} run`);
    if (resumeRecovery(selected) === "new-run") throw new Error(structuralRecoveryReason);
  }
  const location = selected ? requireLocation(selected, root) : createLocation(ctx.cwd, root);
  const useProjectConfig = request.kind === "resume" && !!request.useProjectConfig;
  const config = selected && !useProjectConfig ? configSchema.parse(selected.config) : loadConfig(ctx.cwd);
  requireResearchConfig(config);
  if (selected?.inputs) validateContext(location.workspacePath, selected.inputs);
  let topUp: BudgetTopUp | undefined;
  if (request.kind === "resume" && selected) {
    if (request.addBudget !== undefined && useProjectConfig) throw new Error("Use either --add-budget or --use-project-config, not both");
    if (request.addBudget !== undefined) topUp = proposeBudgetTopUp(selected, request.addBudget);
    else if (!useProjectConfig && budgetExhausted(selected) && ctx.hasUI) topUp = proposeBudgetTopUp(selected, 15);
    if (topUp) config.budgetUsd = topUp.newCeiling;
    if (config.budgetUsd !== null && selected.cost >= config.budgetUsd) throw new Error(`Model budget exhausted: $${selected.cost.toFixed(2)} spent against $${config.budgetUsd.toFixed(2)}. Resume with --add-budget <USD> for an explicit top-up, or --use-project-config for an approved replacement. No budget was changed.`);
  }
  let preview: ContextPreview | undefined;
  let permissions: Disclosure | undefined;
  if (request.kind === "start") {
    ensureSearchConfigured(config.searchProvider);
    if (!ctx.model) throw new Error("Select an authenticated model first");
    const requested = { instructions: config.additionalInstructions, files: config.contextFiles, capabilities: config.capabilities };
    if (requested.instructions || requested.files.length || requested.capabilities.length) {
      preview = previewContext(location.projectPath, requested);
      permissions = await contextPermissions(ctx, JSON.stringify(preview, null, 2), signal);
      if (!permissions) { say("Research not started: context disclosure was not approved."); return; }
    }
  } else if (request.kind === "revise" && selected?.inputs) {
    permissions = await contextPermissions(ctx, `Revision reuses these pinned snapshots and the previous report, not current project files:\n${JSON.stringify(selected.inputs, null, 2)}`, signal);
    if (!permissions) { say("Revision not started: context disclosure was not approved."); return; }
  }
  if (!spendingApproval && !await confirmResearch(ctx, { config, location, selected, revision: request.kind === "revise", revisionFeedback: request.kind === "revise" ? request.feedback : undefined, useProjectConfig, hasContextPreview: !!preview, topUp }, signal)) {
    say("Research not started: cost confirmation was cancelled. No model work launched; saved budget unchanged.");
    return;
  }
  await scope.acquire(root, location.workspacePath);
  // Re-read under lock; a saved selection is not runner ownership.
  if (selected) {
    const current = new RunStore(root, selected.tag).load();
    if (spendingApproval) assertRevisionSpendingApproval(current, spendingApproval);
    if (JSON.stringify(current) !== JSON.stringify(selected)) throw new Error("Run changed while awaiting approval. Select it again.");
  }
  ensureSearchConfigured(config.searchProvider);
  const inputs = preview ? approveContext(location.workspacePath, preview, permissions!)
    : request.kind === "revise" && selected?.inputs ? reapproveContext(location.workspacePath, selected.inputs, permissions!) : selected?.inputs;
  const backend = new ResearchServices(new NativeBackend(location.workspacePath));
  const driver = await PiWorkerDriver.create(ctx, location.workspacePath);
  signal.throwIfAborted();
  if (request.kind === "start") {
    if (!ctx.model) throw new Error("Select an authenticated model first");
    return ResearchRunner.create(location.projectPath, request.query, config, `${ctx.model.provider}/${ctx.model.id}`, ctx.thinkingLevel ?? "medium",
      backend, driver, show, undefined, location, inputs);
  }
  if (request.kind === "revise") {
    return ResearchRunner.revise(location.projectPath, selected!, request.feedback, config,
      selected!.model, selected!.thinking, backend, driver, show, inputs, spendingApproval);
  }
  const store = new RunStore(root, selected!.tag);
  const state = store.load();
  if (JSON.stringify(state) !== JSON.stringify(selected)) throw new Error("Run changed during startup; approve it again");
  if (topUp) applyBudgetTopUp(state, topUp, ctx.hasUI ? "interactive" : "explicit-flag");
  state.config = config;
  if (topUp) store.save(state); // Approval must be durable before any paid worker.
  return new ResearchRunner(location.projectPath, state, backend, driver, show);
}

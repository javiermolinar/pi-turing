import type { Check, Config, Recovery, RunState } from "./types.ts";

export const structuralRecoveryReason = "Structural verification failed; start a new run or explicitly steer this run to replan. Resume cannot repair missing structure with bounded edits.";

export function resumeRecovery(state: RunState): Recovery | undefined {
  if (state.status === "blocked" && state.checks.some(check => !check.ok) && !state.feedback.some(note => note.status === "queued")) {
    return recoveryForChecks(state.checks);
  }
}

/** The public light workflow must be able to check any DOI it discovers. */
export function requireResearchConfig(config: Pick<Config, "scholarlyProviders">): void {
  if (!config.scholarlyProviders.includes("openalex")) {
    throw new Error("Light research requires OpenAlex for the final retraction refresh. Explicitly include openalex in scholarlyProviders before starting or resuming; no provider was enabled automatically.");
  }
}

/** Historical checkpoints without a recovery field use the same check policy. */
export function recoveryForChecks(checks: Check[]): Recovery {
  const failed = checks.filter(check => !check.ok).map(check => check.name);
  if (failed.some(name => ["required-headings", "report-exists", "decomposition-readable"].includes(name))) return "new-run";
  if (failed.some(name => ["source-reads", "known-citations"].includes(name))) return "collect-evidence";
  if (failed.every(name => ["retraction-refresh", "pipeline-complete", "report-current"].includes(name))) return "retry-verification";
  return "edit-report";
}

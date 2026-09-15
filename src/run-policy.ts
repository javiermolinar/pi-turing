import type { RunState } from "./types.ts";

/** Historical records remain readable, never executable or writable as light. */
export function isReadOnlyRun(state: RunState): boolean {
  return state.profile !== "light" || state.config.scope !== "light" || state.pipeline !== undefined;
}
export function requireLightRun(state: RunState): void {
  if (isReadOnlyRun(state)) throw new Error("Full/extended research has been removed. This saved run is read-only; view or export its report, or start a new light investigation. No budget or checkpoint was changed.");
}

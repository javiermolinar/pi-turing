import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { configSchema, now, stateSchema, type Config, type RunState } from "./types.ts";
import { renderDashboard } from "./dashboard.ts";
import { privateDirectory, safePath, validateId } from "./paths.ts";

export function validateTag(tag: string): string {
  return validateId(tag);
}
export function atomicWrite(path: string, text: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`Refusing symlink: ${path}`);
  const temp = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, text, { mode: 0o600, flag: "wx" }); renameSync(temp, path); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}
export function loadConfig(cwd: string): Config {
  const file = join(cwd, ".pi", "hyperresearch.json");
  return configSchema.parse(existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
}
export class RunStore {
  readonly dir: string;
  readonly reportPath: string;
  constructor(readonly root: string, readonly tag: string) {
    validateTag(tag);
    this.dir = safePath(root, "runs", tag);
    this.reportPath = join(this.dir, "report.md");
  }
  load(): RunState {
    const path = safePath(this.root, "runs", this.tag, "pi-state.json");
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 8_000_000) throw new Error("Invalid or oversized checkpoint");
    const state = stateSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    if (state.tag !== this.tag) throw new Error("Run tag does not match state file");
    if (state.migrationId) {
      const journal = JSON.parse(readFileSync(safePath(this.root, "migrations", `${state.migrationId}.json`), "utf8"));
      if (journal.status !== "complete") throw new Error(`Migration ${state.migrationId} is incomplete; rollback before retrying`);
    }
    return state;
  }
  archiveDraft(feedbackId: number, report: string): void {
    if (!Number.isSafeInteger(feedbackId) || feedbackId < 1) throw new Error("Invalid feedback ID");
    safePath(this.root, "runs", this.tag);
    const path = join(this.dir, `draft-before-feedback-${feedbackId}.md`);
    if (existsSync(path)) {
      if (lstatSync(path).isSymbolicLink() || readFileSync(path, "utf8") !== report) throw new Error("Refusing to overwrite a draft archive");
      return; // Idempotent retry after an interrupted boundary checkpoint.
    }
    atomicWrite(path, report);
  }
  save(state: RunState): void {
    if (state.tag !== this.tag) throw new Error("Run tag does not match store");
    state.updatedAt = now();
    stateSchema.parse(state);
    safePath(this.root, "runs", this.tag);
    privateDirectory(this.dir);
    // Authoritative checkpoint first. Remaining files are materialized views;
    // resume rematerializes them after an interrupted save.
    atomicWrite(join(this.dir, "pi-state.json"), JSON.stringify(state, null, 2) + "\n");
    if (state.decomposition) atomicWrite(join(this.dir, "prompt-decomposition.json"), JSON.stringify({
      ...state.decomposition, pipeline_tier: "light", response_format: "short",
    }, null, 2));
    if (state.report !== undefined) atomicWrite(this.reportPath, state.report);
    if (state.patches["15"]) atomicWrite(join(this.dir, "polish-log.json"), JSON.stringify(state.patches["15"], null, 2));
    if (state.patches["16"]) atomicWrite(join(this.dir, "readability-decisions.json"), JSON.stringify(state.patches["16"], null, 2));
    for (const [file, present] of [["prompt-decomposition.json", !!state.decomposition], ["polish-log.json", !!state.patches["15"]], ["readability-decisions.json", !!state.patches["16"]]] as const) {
      const path = join(this.dir, file);
      if (!present && existsSync(path)) {
        if (lstatSync(path).isSymbolicLink()) throw new Error(`Refusing symlink: ${path}`);
        unlinkSync(path);
      }
    }
  }
  snapshot(): string {
    const path = safePath(this.root, "runs", this.tag, "dashboard.html");
    atomicWrite(path, renderDashboard(this.load()));
    return path;
  }
}
/** Temporary Python adapter views; central checkpoint remains authoritative. */
export function materializeBackend(state: RunState): void {
  if (!state.location) return;
  const root = state.location.workspacePath;
  const run = safePath(root, "research", "runs", validateTag(state.tag));
  const notes = safePath(root, "research", "notes");
  privateDirectory(run); privateDirectory(notes);
  if (state.report !== undefined) atomicWrite(join(notes, `final_report_${state.tag}.md`), state.report);
  for (const [file, value] of [
    ["prompt-decomposition.json", state.decomposition ? { ...state.decomposition, pipeline_tier: "light", response_format: "short" } : undefined],
    ["polish-log.json", state.patches["15"]], ["readability-decisions.json", state.patches["16"]],
  ] as const) {
    const path = safePath(run, file);
    if (value) atomicWrite(path, JSON.stringify(value, null, 2));
    else if (existsSync(path)) unlinkSync(path);
  }
}

export interface Inventory {
  runs: RunState[];
  issues: { tag: string; error: string }[];
  partial?: boolean;
}
export function inventory(root: string, allowedTags?: ReadonlySet<string>): Inventory {
  const result: Inventory = { runs: [], issues: [] };
  const dir = safePath(root, "runs");
  if (!existsSync(dir)) return result;
  const deadline = Date.now() + 1000;
  let bytes = 0; let count = 0;
  for (const tag of readdirSync(dir)) {
    if (allowedTags && !allowedTags.has(tag)) continue;
    if (++count > 1000 || Date.now() > deadline) { result.partial = true; break; }
    try {
      const store = new RunStore(root, tag);
      bytes += lstatSync(safePath(root, "runs", tag, "pi-state.json")).size;
      if (bytes > 32_000_000) { result.partial = true; break; }
      result.runs.push(store.load());
    }
    catch (error) { result.issues.push({ tag, error: error instanceof Error ? error.message : String(error) }); }
  }
  result.runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return result;
}
export function listRuns(root: string): RunState[] { return inventory(root).runs; }


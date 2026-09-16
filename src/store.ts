import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { configSchema, now, stateSchema, requireLightRun, type Config, type RunState } from "./types.ts";
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
  const current = join(cwd, ".pi", "turing.json");
  const legacy = join(cwd, ".pi", "hyperresearch.json");
  // The canonical file takes precedence. Invalid new config must not silently
  // fall back to old settings or change the selected provider/budget.
  const file = existsSync(current) ? current : legacy;
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
    requireLightRun(state);
    if (state.tag !== this.tag) throw new Error("Run tag does not match store");
    state.updatedAt = now();
    stateSchema.parse(state);
    safePath(this.root, "runs", this.tag);
    privateDirectory(this.dir);
    // One authoritative checkpoint. The report is the only maintained view;
    // repair an interrupted/tampered copy without rewriting unchanged reports.
    atomicWrite(join(this.dir, "pi-state.json"), JSON.stringify(state, null, 2) + "\n");
    if (state.report !== undefined) {
      const path = safePath(this.root, "runs", this.tag, "report.md");
      const stat = existsSync(path) ? lstatSync(path) : undefined;
      if (stat && !stat.isFile()) throw new Error("Report view must be a regular file");
      if (!stat || stat.size !== Buffer.byteLength(state.report) || readFileSync(path, "utf8") !== state.report) atomicWrite(path, state.report);
    }
    // Retire bridge-era views on writable runs only. Their authoritative data
    // remains in the checkpoint; historical full/extended runs never reach here.
    for (const file of ["prompt-decomposition.json", "polish-log.json", "readability-decisions.json"]) {
      const path = safePath(this.root, "runs", this.tag, file);
      if (existsSync(path)) unlinkSync(path);
    }
  }
  snapshot(): string {
    const path = safePath(this.root, "runs", this.tag, "dashboard.html");
    atomicWrite(path, renderDashboard(this.load()));
    return path;
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


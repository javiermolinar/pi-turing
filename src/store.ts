import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { configSchema, now, stateSchema, type Config, type RunState } from "./types.ts";
import { renderDashboard } from "./dashboard.ts";

export function validateTag(tag: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(tag)) throw new Error("Invalid run tag");
  return tag;
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
  constructor(readonly cwd: string, readonly tag: string) {
    validateTag(tag);
    this.dir = join(cwd, "research", "runs", tag);
    this.reportPath = join(cwd, "research", "notes", `final_report_${tag}.md`);
  }
  load(): RunState {
    const state = stateSchema.parse(JSON.parse(readFileSync(join(this.dir, "pi-state.json"), "utf8")));
    if (state.tag !== this.tag) throw new Error("Run tag does not match state file");
    return state;
  }
  archiveDraft(feedbackId: number, report: string): void {
    if (!Number.isSafeInteger(feedbackId) || feedbackId < 1) throw new Error("Invalid feedback ID");
    for (const dir of [join(this.cwd, "research"), join(this.cwd, "research", "runs"), this.dir]) {
      if (lstatSync(dir).isSymbolicLink()) throw new Error(`Refusing symlink directory: ${dir}`);
    }
    const path = join(this.dir, `draft-before-feedback-${feedbackId}.md`);
    if (existsSync(path)) {
      if (lstatSync(path).isSymbolicLink() || readFileSync(path, "utf8") !== report) throw new Error("Refusing to overwrite a draft archive");
      return; // Idempotent retry after an interrupted boundary checkpoint.
    }
    atomicWrite(path, report);
  }
  save(state: RunState): void {
    state.updatedAt = now();
    stateSchema.parse(state);
    for (const path of [join(this.cwd, "research"), join(this.cwd, "research", "runs"), this.dir, join(this.cwd, "research", "notes")]) {
      if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`Refusing symlink directory: ${path}`);
      mkdirSync(path, { recursive: true, mode: 0o700 });
    }
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
    atomicWrite(join(this.dir, "dashboard.html"), renderDashboard(state));
  }
}
export function listRuns(cwd: string): RunState[] {
  const dir = join(cwd, "research", "runs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(tag => {
    try { return [new RunStore(cwd, tag).load()]; } catch { return []; }
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

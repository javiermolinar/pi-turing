import { patchSchema, type Patch } from "./types.ts";

/** Every edit matches the original report, never an earlier edit's replacement. */
export function applyPatch(report: string, input: unknown): { report: string; patch: Patch } {
  const patch = patchSchema.parse(input);
  const spans = patch.edits.map(edit => {
    const start = report.indexOf(edit.oldText);
    if (start < 0 || report.indexOf(edit.oldText, start + 1) >= 0) throw new Error("Patch text must match exactly once");
    return { start, end: start + edit.oldText.length, replacement: edit.newText };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].start < spans[i - 1].end) throw new Error("Patch hunks overlap");
  }
  // A tool allowlist alone cannot prevent rewriting through edit.
  const changed = patch.edits.reduce((sum, e) => sum + Math.max(e.oldText.length, e.newText.length), 0);
  if (changed > report.length * 0.15) throw new Error("Patch exceeds 15% of report; structural changes require a new run");
  let result = report;
  for (const span of spans.reverse()) result = result.slice(0, span.start) + span.replacement + result.slice(span.end);
  return { report: result, patch };
}

export function citationIds(report: string): string[] {
  return [...new Set([...report.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map(match => match[1]))];
}

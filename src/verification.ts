import { z } from "zod";
import { marked } from "marked";
import { citations } from "./markdown-syntax.ts";
import { decompositionSchema, patchSchema, stages, type Check } from "./types.ts";
import { SourceStore } from "./source-store.ts";
import { hashBytes } from "./extraction.ts";

export const lightProfile = { sourceMin: 10, wordTarget: [500, 2000] as [number, number] };
const inputSchema = z.object({
  report: z.string().max(200_000).optional(), decomposition: decompositionSchema.optional(),
  patches: z.record(z.string(), patchSchema).default({}),
  sources: z.array(z.object({ id: z.string(), hash: z.string() }).strict()).max(30).default([]),
  localEvidence: z.array(z.object({ id: z.string().regex(/^local-[a-f0-9]{32}$/), title: z.string().max(1000), body: z.string().refine(body => Buffer.byteLength(body) <= 200_000) }).strict()).max(30).default([]),
}).strict();
export type VerificationInput = z.input<typeof inputSchema>;
/** Retained light structural/quote contract, not semantic claim verification. */
export function verifyReport(input: unknown, store: SourceStore, retracted: ReadonlySet<string> = new Set()) {
  const { report, decomposition, patches, sources, localEvidence } = inputSchema.parse(input);
  if (new Set(localEvidence.map(item => item.id)).size !== localEvidence.length || localEvidence.reduce((n, item) => n + Buffer.byteLength(item.body), 0) > 3_510_000) throw new Error("Duplicate or oversized local evidence");
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  check("report-exists", !!report?.trim(), "Report must be present in the authoritative checkpoint");
  check("decomposition-readable", !!decomposition, "A validated question decomposition is required");
  check("polish-decisions", !!patches[stages.polish], "Polish decisions must be checkpointed");
  check("readability-decisions", !!patches[stages.readability], "Readability decisions must be checkpointed");
  if (report) {
    const words = report.trim().split(/\s+/u).filter(Boolean);
    const chars = [...report].length;
    const noBoundaries = words.length > 0 && words.reduce((n, word) => n + [...word].length, 0) / words.length >= 15;
    const count = noBoundaries ? chars : words.length;
    const [low, high] = noBoundaries ? [1500, 6000] : lightProfile.wordTarget;
    check("length-in-range", low * 0.8 <= count && count <= high * 1.2, `${count} ${noBoundaries ? "characters" : "words"}; target ${low}–${high}, ±20% tolerance`);
    const headings = marked.lexer(report).flatMap(token => token.type === "heading" && "text" in token ? [token.text.trim()] : []);
    const missing = (decomposition?.required_section_headings ?? []).filter(heading => !headings.includes(heading.replace(/^#{1,6}\s+/, "").trim()));
    check("required-headings", !missing.length, missing.length ? `Missing: ${missing.join(", ")}` : "All required headings are Markdown headings");
    const wiki = citations(report);
    const density = wiki.length * 1000 / Math.max(1, noBoundaries ? chars / 3 : words.length);
    check("citation-density", density >= 9, `${density.toFixed(2)} citations/1000 effective words; floor 9`);
    check("no-scaffold-leak", !report.includes("## User Prompt (VERBATIM"), "Internal prompt scaffolding must not ship");
    const bodies = new Map<string, string>(); const knownRetracted = new Set(retracted);
    for (const source of sources) {
      if (bodies.has(source.id)) throw new Error("Duplicate source at verification");
      const local = localEvidence.find(item => item.id === source.id);
      const record = local ? undefined : store.load(source.id);
      const body = local?.body ?? record!.body;
      if (hashBytes(body) !== source.hash) throw new Error("Source content changed after the report's source read");
      bodies.set(source.id, body);
      if (record?.retracted) knownRetracted.add(source.id);
    }
    check("known-citations", wiki.every(citation => bodies.has(citation.id)), "Citations must reference the source snapshots supplied by the runner");
    const normalized = [...bodies.values()].map(body => body.replace(/\s+/gu, " ").trim());
    const narrative = report.split(/^##\s+(?:Sources|References)\b/im)[0].replace(/\[\d{1,3}(?:\s*,\s*\d{1,3})*\]/g, "");
    const missingQuotes = [...narrative.matchAll(/["“]([^"“”]{1,600}?)["”]/g)].map(match => match[1].replace(/\s+/gu, " ").trim())
      .filter(quote => quote.split(" ").length >= 5 && !normalized.some(body => body.includes(quote)));
    // Deliberately stricter than upstream's stemmed FTS match, and restricted to
    // this report's read sources. No source/local body is materialized for linting.
    check("quote-integrity", !missingQuotes.length, missingQuotes.length ? `${missingQuotes.length} quoted span(s) missing from supplied source text` : "Quoted spans of five or more words match source text after whitespace normalization");
    const unacknowledged = wiki.filter(citation => knownRetracted.has(citation.id) && !/retract/i.test(citation.context));
    check("retracted-citations", !unacknowledged.length, unacknowledged.length ? `${unacknowledged.length} retracted citation(s) without nearby acknowledgment` : "No unacknowledged known retracted citations");
  }
  return { passed: checks.every(check => check.ok), checks };
}

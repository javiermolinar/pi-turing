import { createHash } from "node:crypto";
import { Marked } from "marked";
import { z } from "zod";
import type { Backend } from "./backend.ts";
import type { RunState, Source } from "./types.ts";
import { ReadCoverage } from "./coverage.ts";
import { readContextSnapshot, validateContext } from "./context.ts";
import { readRetrievedSnapshot } from "./capabilities.ts";
import { mathAt } from "./report.ts";
import { adequateExtraction } from "./evidence.ts";
import { normalizeDoi } from "./scholarly-providers.ts";
import { passageSchema, verifiedPassageSchema, type Passage, type VerifiedPassage, type AuditUnit, type ClaimReview, type AuditFinding, type Independence } from "./audit-types.ts";
export const digestHash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Exact passage checks use raw preserved text, never wrapper instructions or a
 * model's assertion that a quote was checked. Semantic support is a separate judgment. */
export async function verifyPassages(passages: Passage[], state: RunState, backend: Backend, coverage: ReadCoverage, signal: AbortSignal): Promise<VerifiedPassage[]> {
  const results: VerifiedPassage[] = [];
  for (const raw of passages) {
    signal.throwIfAborted(); const passage = passageSchema.parse(raw);
    const source = state.sources.find(item => item.id === passage.sourceId);
    if (!source?.fullRead || source.purpose === "background" || !adequateExtraction(source.extraction, state.config.readingRequirements) || !source.contentHash || !coverage.complete(source.id, source.contentHash)) throw new Error(`Read the complete pinned source before using its passage: ${passage.sourceId}`);
    let result: { matched: boolean; hash: string; offset: number | null; units: "utf16" | "unicode" };
    if (source.origin === "local" || source.origin === "integration") {
      if (!state.inputs || !state.location) throw new Error("Missing scoped evidence approval");
      validateContext(state.location.workspacePath, state.inputs);
      const ref = state.retrieved?.find(ref => ref.id === source.id);
      if (ref && (!ref.complete || !state.inputs.bindings?.some(binding => binding.id === ref.bindingId && binding.hash === ref.bindingHash))) throw new Error("Evidence binding is not approved or its document is incomplete");
      if (!ref && !state.inputs.files.some(file => file.id === source.id && file.purpose === "evidence")) throw new Error("Background context is not evidence");
      const snapshot = ref ? readRetrievedSnapshot(state.location.workspacePath, ref) : readContextSnapshot(state.location.workspacePath, state.inputs, source.id);
      const offset = snapshot.body.indexOf(passage.quote);
      result = { matched: offset >= 0, hash: digestHash(snapshot.body), offset: offset < 0 ? null : offset, units: "utf16" };
    } else {
      result = z.object({ matched: z.boolean(), hash: z.string(), offset: z.number().int().nonnegative().nullable(), units: z.literal("unicode") }).parse(
        await backend.call("check_passage", { id: source.id, hash: source.contentHash, text: passage.quote }, signal));
    }
    if (!result.matched || result.offset === null || result.hash !== source.contentHash) throw new Error(`Passage is absent or source changed: ${source.id}`);
    results.push(verifiedPassageSchema.parse({ ...passage, sourceHash: result.hash, offset: result.offset, units: result.units }));
  }
  signal.throwIfAborted(); return results;
}

/** Audits are exhaustive over bounded prose blocks, not an undisclosed sample of
 * sentences. Large blocks/too many blocks are an explicit incomplete audit. */
export function auditUnits(report: string, maxUnits = 80): { units: AuditUnit[]; exclusions: string[]; complete: boolean } {
  if (!Number.isSafeInteger(maxUnits) || maxUnits < 1 || maxUnits > 100) throw new Error("Invalid prose audit limit");
  const parser = new Marked({ extensions: [
    { name: "auditCitation", level: "inline", start: source => source.indexOf("[["), tokenizer: source => {
      const match = /^\[\[([^\]\n|#]+)(?:[|#][^\]\n]*)?\]\]/.exec(source);
      if (match) return { type: "auditCitation", raw: match[0], id: match[1] };
    } },
    { name: "auditMath", level: "inline", start: source => source.search(/\\[([]|\$/), tokenizer: source => {
      const match = mathAt(source); if (match) return { type: "auditMath", raw: match.raw };
    } },
  ] });
  const units: AuditUnit[] = []; const exclusions: string[] = []; let complete = true; let sourceSection: number | undefined;
  const citations = (token: any): string[] => {
    if (token.type === "auditCitation") return [token.id];
    if (["code", "codespan", "auditMath"].includes(token.type)) return [];
    return [token.tokens, token.items, token.header, token.rows].filter(Array.isArray).flat(2).flatMap(citations);
  };
  for (const token of parser.lexer(report)) {
    if (token.type === "heading") {
      if (/^(sources|references|bibliography)$/i.test((token as any).text.trim())) sourceSection = (token as any).depth;
      else if (sourceSection !== undefined && (token as any).depth <= sourceSection) sourceSection = undefined;
      continue;
    }
    if (sourceSection !== undefined || ["space", "hr", "def"].includes(token.type)) continue;
    const math = mathAt(token.raw.trim());
    if (token.type === "code" || (math?.display && math.raw.length === token.raw.trim().length)) { exclusions.push("Code/display-math block excluded from prose support assessment"); continue; }
    if (token.type === "html") { complete = false; exclusions.push("Raw HTML requires an explicit Markdown rewrite before a complete prose audit"); continue; }
    if (token.raw.length > 5000 || units.length >= Math.min(100, maxUnits)) { complete = false; exclusions.push("Prose audit block/coverage limit exceeded; no silent sampling"); continue; }
    const ids = [...new Set(citations(token))];
    const withoutCitations = token.raw.replace(/\[\[[^\]]+\]\]/g, "").replace(/^\s*\d+[.)]\s/gm, "");
    units.push({ id: `claim-${units.length + 1}-${digestHash(token.raw).slice(0, 8)}`, text: token.raw.trim(), citations: ids,
      numeric: /\b\d+(?:[.,]\d+)?(?:%|\b)/.test(withoutCitations) });
  }
  return { units, exclusions: [...new Set(exclusions)].slice(0, 20), complete };
}
export function validateReviewCoverage(units: AuditUnit[], reviews: ClaimReview[]): void {
  if (reviews.length !== units.length || new Set(reviews.map(review => review.unitId)).size !== units.length || units.some(unit => !reviews.some(review => review.unitId === unit.id))) throw new Error("Every assigned claim block requires exactly one review");
  for (const review of reviews) {
    const unit = units.find(unit => unit.id === review.unitId)!;
    if (review.verdict === "not-factual" && unit.citations.length) throw new Error(`Cited prose cannot bypass binding assessment as non-factual: ${unit.id}`);
    if (["supported", "qualified"].includes(review.verdict) && (!unit.citations.length || unit.citations.some(id => !review.passages.some(passage => passage.sourceId === id)))) throw new Error(`Support verdict needs a passage for every cited source: ${unit.id}`);
    if (review.passages.some(passage => !unit.citations.includes(passage.sourceId))) throw new Error(`Review passage is not bound to this block's citations: ${unit.id}`);
  }
}
const normalizedQuote = (text: string) => text.replace(/\s+/g, " ").trim();
export function auditFindings(units: AuditUnit[], reviews: ClaimReview[], proofs: VerifiedPassage[], sources: Source[], complete: boolean): AuditFinding[] {
  const findings: AuditFinding[] = [];
  try { validateReviewCoverage(units, reviews); } catch { complete = false; }
  if (!complete || !units.length || reviews.length !== units.length) findings.push({ unitId: "report", kind: "incomplete-coverage", detail: "Prose audit is incomplete; required review cannot be silently omitted" });
  if (!reviews.some(review => ["supported", "qualified"].includes(review.verdict))) findings.push({ unitId: "report", kind: "incomplete-coverage", detail: "No factual citation bindings received a support assessment" });
  for (const unit of units) {
    for (const id of unit.citations) if (!sources.some(source => source.id === id && source.fullRead)) findings.push({ unitId: unit.id, kind: "dangling-citation", detail: `Unknown or incompletely read citation: ${id}` });
    if (unit.numeric && !unit.citations.length) findings.push({ unitId: unit.id, kind: "uncited-number", detail: "Number-bearing prose block has no source citation" });
    const review = reviews.find(review => review.unitId === unit.id);
    if (review && ["unsupported", "contradicted", "not-checkable"].includes(review.verdict)) findings.push({ unitId: unit.id, kind: review.verdict as "unsupported" | "contradicted" | "not-checkable", detail: review.reason });
    const quotes = [...unit.text.matchAll(/“([^”\n]{12,})”|"([^"\n]{12,})"/g)].map(match => match[1] ?? match[2]);
    if (/^>\s?/.test(unit.text) && !quotes.length) {
      const block = unit.text.replace(/^>\s?/gm, "").replace(/\[\[[^\]]+\]\]/g, "").trim();
      if (block.length >= 12) quotes.push(block);
    }
    const currentProofs = proofs.filter(proof => unit.citations.includes(proof.sourceId) && sources.some(source => source.id === proof.sourceId && source.contentHash === proof.sourceHash && source.fullRead));
    for (const passage of review?.passages ?? []) if (!currentProofs.some(proof => proof.sourceId === passage.sourceId && proof.quote === passage.quote)) findings.push({ unitId: unit.id, kind: "not-checkable", detail: "Review passage lacks a current preserved-text proof" });
    const quotedEvidence = currentProofs.filter(proof => review?.passages.some(passage => passage.sourceId === proof.sourceId && passage.quote === proof.quote)).map(proof => proof.quote);
    const titles = sources.filter(source => unit.citations.includes(source.id)).map(source => source.title);
    for (const quote of quotes) if (![...quotedEvidence, ...titles].some(text => normalizedQuote(text).includes(normalizedQuote(quote)))) findings.push({ unitId: unit.id, kind: "unverified-quote", detail: `Quotation is not present in the checked source passages: ${quote.slice(0, 300)}` });
  }
  if (findings.length > 300) return [...findings.slice(0, 299), { unitId: "report", kind: "incomplete-coverage", detail: "Additional findings exceed the bounded ledger; this report cannot pass" }];
  return findings;
}

export interface SourceFingerprint { id: string; hash: string; shingles: string[] }
export function textFingerprint(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []; const values = new Set<string>();
  const stride = Math.max(1, Math.ceil(Math.max(0, words.length - 4) / 20_000));
  for (let index = 0; index + 4 < words.length; index += stride) values.add(digestHash(words.slice(index, index + 5).join(" ")).slice(0, 16));
  return [...values].sort().slice(0, 64);
}
function canonicalUrl(raw: string): string | undefined {
  try { const url = new URL(raw); url.hash = ""; for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key); url.searchParams.sort(); return url.href; }
  catch { return undefined; }
}
export function sourceIndependence(state: RunState, fingerprints: SourceFingerprint[] = []): Independence {
  const sources = state.sources; const parents = sources.map((_, index) => index); const signals: Array<{ a: number; b: number; kind: Independence["groups"][number]["signals"][number] }> = [];
  const root = (index: number): number => parents[index] === index ? index : (parents[index] = root(parents[index]));
  const urls = sources.map(source => new Set([source.url, source.extraction?.actualUrl].filter((url): url is string => !!url).map(canonicalUrl).filter((url): url is string => !!url)));
  const works = (state.discoveries ?? []).flatMap(batch => batch.results);
  const dois = sources.map((source, index) => new Set([normalizeDoi(source.url), ...works.filter(work => [...work.urls, ...work.fullTextCandidates.map(candidate => candidate.url)].some(url => { const canonical = canonicalUrl(url); return canonical !== undefined && urls[index].has(canonical); })).map(work => work.doi)].filter((doi): doi is string => !!doi)));
  for (let a = 0; a < sources.length; a++) for (let b = a + 1; b < sources.length; b++) {
    const left = sources[a], right = sources[b]; const relations: Independence["groups"][number]["signals"] = [];
    if (left.contentHash && left.contentHash === right.contentHash) relations.push("same-content");
    if ([...urls[a]].some(url => urls[b].has(url))) relations.push("same-url");
    if ([...dois[b]].some(doi => dois[a].has(doi))) relations.push("same-doi");
    const fa = fingerprints.find(item => item.id === left.id && item.hash === left.contentHash), fb = fingerprints.find(item => item.id === right.id && item.hash === right.contentHash);
    if (fa && fb && Math.min(fa.shingles.length, fb.shingles.length) >= 12 && fa.shingles.filter(value => fb.shingles.includes(value)).length / Math.min(fa.shingles.length, fb.shingles.length) >= 0.8) relations.push("similar-text");
    if (relations.length) { parents[root(b)] = root(a); for (const kind of relations) signals.push({ a, b, kind }); }
  }
  const groups: Independence["groups"] = []; const ungrouped: string[] = [];
  for (const parent of new Set(parents.map((_, index) => root(index)))) {
    const indexes = sources.flatMap((_, index) => root(index) === parent ? [index] : []);
    if (indexes.length === 1) ungrouped.push(sources[indexes[0]].id);
    else groups.push({ sources: indexes.map(index => sources[index].id), signals: [...new Set(signals.filter(signal => indexes.includes(signal.a) && indexes.includes(signal.b)).map(signal => signal.kind))] });
  }
  return { groups, ungrouped, limitation: "Relationships are conservative signals, not proof of independence. Ungrouped sources remain unverified; clusters are not multiple corroborating voices." };
}

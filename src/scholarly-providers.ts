import { DomUtils, parseDocument } from "htmlparser2";
import { z } from "zod";
import { discoveryWorkSchema, type DiscoveryWork, type ScholarlyAdapter, type ScholarlyProvider } from "./discovery-types.ts";
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const text = (value: unknown, limit = 500): string | undefined => typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : undefined;
const first = (value: unknown) => text(value) ?? array(value).map(value => text(value)).find(Boolean);
export function scholarlyUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length > 2048 || /[\x00-\x1f\x7f]/.test(raw)) return;
  try { const url = new URL(raw); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.href; } catch { return; }
}
export function normalizeDoi(raw: unknown): string | undefined {
  if (typeof raw !== "string") return;
  let value = raw.trim().replace(/^doi:\s*/i, "");
  if (/^https?:\/\/(?:dx\.)?doi\.org\//i.test(value)) {
    try { value = decodeURIComponent(new URL(value).pathname.slice(1)); } catch { return; }
  }
  value = value.toLowerCase();
  return /^10\.\d{4,9}\/[^\s<>]{1,260}$/.test(value) ? value : undefined;
}
function abstract(raw: string | undefined): string | undefined {
  if (!raw) return;
  const value = raw.slice(0, 900).replace(/<\s*(\/?)\s*untrusted-source\b/gi, "<$1untrusted-source-inner");
  return `<untrusted-source>\nAbstract: untrusted discovery metadata, NOT full-read evidence.\n${value}\n</untrusted-source>`;
}
export function invertAbstract(raw: unknown): string | undefined {
  const slots: [number, string][] = [];
  for (const [word, positions] of Object.entries(object(raw)).slice(0, 2000)) {
    for (const position of array(positions).slice(0, 20)) if (Number.isSafeInteger(position) && position >= 0) slots.push([position, word.slice(0, 100)]);
  }
  return slots.length ? slots.sort((a, b) => a[0] - b[0]).map(pair => pair[1]).join(" ").slice(0, 900) : undefined;
}
const types: Record<string, DiscoveryWork["workType"]> = {
  article: "article", "journal-article": "article", "proceedings-article": "article", review: "article", letter: "article", editorial: "article",
  book: "book", monograph: "book", "reference-book": "book", "edited-book": "book", "book-chapter": "book-chapter", "book-part": "book-chapter", "book-section": "book-chapter",
  preprint: "preprint", "posted-content": "preprint", dissertation: "thesis", thesis: "thesis", report: "report", "report-component": "report", dataset: "dataset", erratum: "correction",
};
function date(raw: unknown, kind: "publication" | "registration" = "publication"): DiscoveryWork["date"] {
  const value = typeof raw === "number" ? String(raw) : text(raw, 10);
  if (!value || !/^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(value)) return;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000 || (month !== undefined && (month < 1 || month > 12)) || (day !== undefined && (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()))) return;
  return { value, kind, precision: day !== undefined ? "day" : month !== undefined ? "month" : "year" };
}
function crossrefDate(raw: Record<string, any>): DiscoveryWork["date"] {
  for (const key of ["issued", "published", "published-print", "published-online"]) {
    const parts = array(array(object(raw[key])["date-parts"])[0]);
    if (!parts.length || !parts.every(part => Number.isInteger(part))) continue;
    const parsed = date(parts.slice(0, 3).map((part, index) => index ? String(part).padStart(2, "0") : String(part)).join("-"));
    if (parsed) return parsed;
  }
  return date(text(object(raw.created)["date-time"], 10), "registration");
}
function base(provider: ScholarlyProvider, recordId: string, title: string, rawType: string, url: string, doi: string | undefined, at: string, rank: number): DiscoveryWork {
  const workType = types[rawType] ?? "other";
  return { id: `${provider}:${recordId}`.slice(0, 300), identifiers: [{ scheme: provider, value: recordId }, ...(doi ? [{ scheme: "doi", value: doi }] : [])], doi, title, authors: [],
    workType, version: workType === "preprint" ? "submitted" : ["article", "book", "book-chapter", "correction"].includes(workType) ? "published" : "unknown",
    retracted: null, correction: workType === "correction" ? true : null, url, urls: [url], fullTextCandidates: [], relations: [], citationCounts: [],
    provenance: [{ provider, recordId, retrievedAt: at, rank, rawType }], evidence: "discovery-only" };
}
function openalex(raw: unknown, at: string, rank: number): DiscoveryWork | undefined {
  const item = object(raw); const title = text(item.display_name) ?? text(item.title); if (!title) return;
  const doi = normalizeDoi(item.doi); const recordId = (text(item.id, 300)?.replace(/^https:\/\/openalex.org\//, "") ?? doi)?.slice(0, 300);
  const primary = object(item.primary_location); const best = object(item.best_oa_location);
  const url = scholarlyUrl(primary.landing_page_url) ?? scholarlyUrl(best.landing_page_url) ?? (doi ? scholarlyUrl(`https://doi.org/${doi}`) : scholarlyUrl(item.id));
  if (!url || !recordId) return;
  const result = base("openalex", recordId, title, text(item.type, 80) ?? "unknown", url, doi, at, rank);
  result.date = date(item.publication_date) ?? date(item.publication_year);
  result.authors = array(item.authorships).slice(0, 20).flatMap(author => text(object(object(author).author).display_name, 150) ?? []);
  result.abstract = abstract(invertAbstract(item.abstract_inverted_index));
  result.retracted = typeof item.is_retracted === "boolean" ? item.is_retracted : null;
  if (Number.isSafeInteger(item.cited_by_count) && item.cited_by_count >= 0) result.citationCounts.push({ provider: "openalex", count: item.cited_by_count });
  for (const location of [best, primary, ...array(item.locations).slice(0, 3).map(object)]) {
    const version: DiscoveryWork["version"] = ({ submittedVersion: "submitted", acceptedVersion: "accepted", publishedVersion: "published" } as const)[location.version as "submittedVersion"] ?? "unknown";
    for (const [field, format] of [["pdf_url", "pdf"], ["landing_page_url", "html"]] as const) {
      const candidate = scholarlyUrl(location[field]); if (!candidate) continue;
      if (!result.fullTextCandidates.some(item => item.url === candidate && item.version === version)) result.fullTextCandidates.push({ url: candidate, version, format, access: location.is_oa === true ? "open" : "unknown", provider: "openalex" });
      if (!result.urls.includes(candidate)) result.urls.push(candidate);
    }
  }
  return result;
}
function crossref(raw: unknown, at: string, rank: number): DiscoveryWork | undefined {
  const item = object(raw); let title = first(item.title); if (!title) return;
  const subtitle = first(item.subtitle); if (subtitle && !title.toLowerCase().includes(subtitle.toLowerCase())) title = `${title}: ${subtitle}`.slice(0, 500);
  const doi = normalizeDoi(item.DOI); const url = scholarlyUrl(item.URL) ?? (doi ? scholarlyUrl(`https://doi.org/${doi}`) : undefined);
  if (!url) return;
  const result = base("crossref", doi ?? url.slice(0, 300), title, text(item.type, 80) ?? "unknown", url, doi, at, rank);
  result.date = crossrefDate(item);
  if (Number.isSafeInteger(item["is-referenced-by-count"]) && item["is-referenced-by-count"] >= 0) result.citationCounts.push({ provider: "crossref", count: item["is-referenced-by-count"] });
  result.authors = array(item.author).slice(0, 20).flatMap(raw => {
    const author = object(raw); const name = text(author.family) ? [text(author.given), text(author.family)].filter(Boolean).join(" ") : text(author.name);
    return name ? [name.slice(0, 150)] : [];
  });
  const jats = text(item.abstract, 20_000);
  if (jats) result.abstract = abstract(DomUtils.textContent(parseDocument(jats.replace(/<[^>]*>/g, " "))).replace(/\s+/g, " ").trim().replace(/^(?:abstract|summary)\s*[:.—-]?\s+/i, ""));
  for (const raw of array(item.link).slice(0, 10)) {
    const entry = object(raw); const url = scholarlyUrl(entry.URL); if (!url) continue;
    result.fullTextCandidates.push({ url, version: entry["content-version"] === "vor" ? "published" : entry["content-version"] === "am" ? "accepted" : "unknown",
      format: entry["content-type"] === "application/pdf" ? "pdf" : "unknown", access: "unknown", provider: "crossref" });
    if (!result.urls.includes(url)) result.urls.push(url);
  }
  for (const [type, relations] of Object.entries(object(item.relation)).slice(0, 10)) for (const relation of array(relations).slice(0, 2)) {
    const doi = normalizeDoi(object(relation).id); if (doi) result.relations.push({ type: type.slice(0, 60), doi });
  }
  for (const update of array(item["update-to"]).slice(0, 5).map(object)) {
    const doi = normalizeDoi(update.DOI); if (doi && result.relations.length < 20) result.relations.push({ type: `updates:${text(update.type, 40) ?? "unknown"}`, doi });
    if (update.type === "correction") { result.workType = "correction"; result.correction = true; }
    if (update.type === "retraction") result.workType = "retraction-notice"; // Notice is NOT the retracted original.
  }
  return result;
}
function parse(items: unknown[], convert: typeof openalex, retrievedAt: string) {
  let skipped = 0; const results: DiscoveryWork[] = [];
  for (const [index, item] of items.slice(0, 5).entries()) {
    try { const result = convert(item, retrievedAt, index + 1); if (result) results.push(discoveryWorkSchema.parse(result)); else skipped++; }
    catch { skipped++; }
  }
  return { results, skipped, truncated: items.length > 5 };
}
export const scholarlyAdapters: Record<ScholarlyProvider, ScholarlyAdapter> = {
  openalex: { id: "openalex", endpoint(query, contact) {
    const url = new URL("https://api.openalex.org/works"); url.searchParams.set("search", query); url.searchParams.set("per-page", "5");
    if (contact) url.searchParams.set("mailto", contact); return url;
  }, parse(payload, at) { return parse(z.object({ results: z.array(z.unknown()) }).parse(payload).results, openalex, at); } },
  crossref: { id: "crossref", endpoint(query, contact) {
    const url = new URL("https://api.crossref.org/works"); url.searchParams.set("query", query); url.searchParams.set("rows", "5");
    if (contact) url.searchParams.set("mailto", contact); return url;
  }, parse(payload, at) { return parse(z.object({ status: z.literal("ok").optional(), message: z.object({ items: z.array(z.unknown()) }) }).parse(payload).message.items, crossref, at); } },
};

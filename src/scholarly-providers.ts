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
  preprint: "preprint", "posted-content": "preprint", dissertation: "thesis", thesis: "thesis", report: "report", "report-component": "report", dataset: "dataset", erratum: "correction", trial: "trial", filing: "filing", series: "series", chapter: "book-chapter",
};
function date(raw: unknown, kind: NonNullable<DiscoveryWork["date"]>["kind"] = "publication"): DiscoveryWork["date"] {
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
function core(raw: unknown, at: string, rank: number): DiscoveryWork | undefined {
  const item = object(raw); const title = text(item.title); const id = Number.isSafeInteger(item.id) ? String(item.id) : text(item.id, 100);
  if (!title || !id) return;
  const result = base("core", id, title, text(item.documentType, 80)?.toLowerCase() ?? "unknown", `https://core.ac.uk/works/${encodeURIComponent(id)}`, normalizeDoi(item.doi), at, rank);
  // Aggregated repository records do not establish a published version.
  result.version = "unknown";
  result.authors = [...new Set(array(item.authors).flatMap(author => text(object(author).name, 150) ?? text(author, 150) ?? []))].slice(0, 20);
  result.date = date(item.publishedDate) ?? date(item.yearPublished);
  result.abstract = abstract(text(item.abstract, 900));
  if (Number.isSafeInteger(item.citationCount) && item.citationCount >= 0) result.citationCounts.push({ provider: "core", count: item.citationCount });
  for (const rawUrl of [item.downloadUrl, ...array(item.sourceFulltextUrls).slice(0, 8)]) {
    const url = scholarlyUrl(rawUrl); if (!url || result.urls.includes(url)) continue;
    result.urls.push(url); result.fullTextCandidates.push({ url, version: "unknown", format: /\.pdf(?:[?#]|$)/i.test(url) ? "pdf" : "unknown", access: "unknown", provider: "core" });
  }
  return result;
}
function doab(raw: unknown, at: string, rank: number): DiscoveryWork | undefined {
  const item = object(raw);
  if ((item.type && item.type !== "item") || item.withdrawn === true || item.withdrawn === "true") return;
  const entries = array(item.metadata).slice(0, 200).map(object);
  const values = (key: string) => entries.filter(entry => entry.key === key).flatMap(entry => text(entry.value, 1500) ?? []);
  const get = (key: string) => values(key)[0];
  const title = text(get("dc.title") ?? item.name); const handle = text(item.handle, 200);
  const doi = normalizeDoi(get("dc.identifier.doi")) ?? values("dc.identifier.uri").map(normalizeDoi).find(Boolean);
  const url = scholarlyUrl(get("dc.identifier.uri")) ?? (handle ? `https://directory.doabooks.org/handle/${handle.split("/").map(encodeURIComponent).join("/")}` : undefined);
  if (!title || !url || !(handle || doi)) return;
  const result = base("doab", handle ?? doi!, title, text(get("dc.type"), 80)?.toLowerCase() ?? "book", url, doi, at, rank);
  result.authors = values("dc.contributor.author").slice(0, 20).map(value => value.slice(0, 150));
  const editors = values("dc.contributor.editor");
  result.metadata = editors.length ? { editors: editors.join("; ").slice(0, 500) } : {};
  const isbn = text(get("dc.identifier.isbn"), 100); if (isbn) result.metadata.isbn = isbn; // Not a merge key: editions/chapters share ISBNs.
  result.date = date(get("dc.date.issued")); result.abstract = abstract(get("dc.description.abstract"));
  const download = scholarlyUrl(get("oapen.identifier.downloadUrl"));
  if (download) { result.urls.push(download); result.fullTextCandidates.push({ url: download, version: "unknown", format: /\.pdf(?:[?#]|$)/i.test(download) ? "pdf" : "unknown", access: "open", provider: "doab" }); }
  return result;
}
function clinicaltrials(raw: unknown, at: string, rank: number): DiscoveryWork | undefined {
  const section = object(object(raw).protocolSection); const idModule = object(section.identificationModule);
  const id = text(idModule.nctId); const title = text(idModule.briefTitle) ?? text(idModule.officialTitle);
  if (!id || !/^NCT\d{8}$/.test(id) || !title) return;
  const result = base("clinicaltrials", id, title, "trial", `https://clinicaltrials.gov/study/${id}`, undefined, at, rank);
  const status = object(section.statusModule); const design = object(section.designModule);
  result.date = date(object(status.studyFirstSubmitDateStruct).date ?? status.studyFirstSubmitDate, "registration");
  result.abstract = abstract(text(object(section.descriptionModule).briefSummary, 900));
  result.metadata = {};
  for (const [key, value] of Object.entries({ status: status.overallStatus, startDate: object(status.startDateStruct).date,
    phases: array(design.phases).filter(value => typeof value === "string").join("/"),
    sponsor: object(object(section.sponsorCollaboratorsModule).leadSponsor).name,
    enrollment: Number.isSafeInteger(object(design.enrollmentInfo).count) ? String(object(design.enrollmentInfo).count) : undefined,
    conditions: array(object(section.conditionsModule).conditions).filter(value => typeof value === "string").slice(0, 6).join("; ") })) {
    const parsed = text(value); if (parsed) result.metadata[key] = parsed;
  }
  // A sponsor is not an author; registration is not a peer-reviewed outcome.
  return result;
}
function edgar(raw: unknown, at: string, rank: number): DiscoveryWork | undefined {
  const row = object(raw); const item = object(row._source);
  const [prefix, document] = (text(row._id, 500) ?? "").split(":"); const accession = first(item.adsh) ?? prefix;
  const cik = first(item.ciks);
  if (!accession || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || !cik || !/^\d{1,10}$/.test(cik)) return;
  const file = document && /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(document) && !document.includes("..") ? document : `${accession}-index.htm`;
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${file}`;
  const company = first(item.display_names); const form = first(item.form) ?? first(item.root_forms); const filed = first(item.file_date);
  const result = base("edgar", accession, [company, form, filed].filter(Boolean).join(" — ").slice(0, 500) || `SEC filing ${accession}`, "filing", url, undefined, at, rank);
  result.date = date(filed, "filing"); result.metadata = { accession, cik };
  for (const [key, value] of Object.entries({ company, form, periodEnding: first(item.period_ending) })) if (value) result.metadata[key] = value;
  return result;
}
function fred(raw: unknown, at: string, rank: number): DiscoveryWork | undefined {
  const item = object(raw); const id = text(item.id, 100); const title = text(item.title);
  if (!id || !/^[a-zA-Z0-9_.-]+$/.test(id) || !title) return;
  const result = base("fred", id, title, "series", `https://fred.stlouisfed.org/series/${id}`, undefined, at, rank);
  result.date = date(item.observation_start, "observation"); result.abstract = abstract(text(item.notes, 900));
  result.metadata = {};
  for (const key of ["frequency", "units", "seasonal_adjustment", "observation_start", "observation_end", "last_updated"]) {
    const value = text(item[key]); if (value) result.metadata[key] = value;
  }
  return result; // Metadata only: no observations, estimates, or conclusions fabricated.
}
export const scholarlyAdapters: Record<ScholarlyProvider, ScholarlyAdapter> = {
  core: { id: "core", kinds: ["literature"], credential: "CORE_API_KEY", endpoint(query) {
    const url = new URL("https://api.core.ac.uk/v3/search/works"); url.searchParams.set("q", query); url.searchParams.set("limit", "5"); return url;
  }, headers(key) { return { Authorization: `Bearer ${key}` }; },
  parse(payload, at) { return parse(z.object({ results: z.array(z.unknown()) }).parse(payload).results, core, at); } },
  doab: { id: "doab", kinds: ["book"], endpoint(query) {
    const url = new URL("https://directory.doabooks.org/rest/search"); url.searchParams.set("query", query); url.searchParams.set("expand", "metadata"); url.searchParams.set("limit", "5"); url.searchParams.set("offset", "0"); return url;
  }, parse(payload, at) { return parse(z.array(z.unknown()).parse(payload), doab, at); } },
  clinicaltrials: { id: "clinicaltrials", kinds: ["trial"], endpoint(query) {
    const url = new URL("https://clinicaltrials.gov/api/v2/studies"); url.searchParams.set("query.term", query); url.searchParams.set("format", "json"); url.searchParams.set("pageSize", "5"); url.searchParams.set("countTotal", "false"); return url;
  }, parse(payload, at) { return parse(z.object({ studies: z.array(z.unknown()) }).parse(payload).studies, clinicaltrials, at); } },
  edgar: { id: "edgar", kinds: ["filing"], credential: "HYPERRESEARCH_CONTACT_EMAIL", endpoint(query) {
    const url = new URL("https://efts.sec.gov/LATEST/search-index"); url.searchParams.set("q", query); return url;
  }, headers(_key, contact) { return { "User-Agent": `pi-hyperresearch mailto:${contact}` }; },
  parse(payload, at) {
    const rows = z.object({ hits: z.object({ hits: z.array(z.unknown()) }) }).parse(payload).hits.hits;
    // EFTS returns 100 documents, often exhibits of the same filing. Keep one
    // highest-ranked document per accession, not five pseudo-independent filings.
    const seen = new Set<string>(); const results: DiscoveryWork[] = []; let skipped = 0;
    for (const [index, row] of rows.slice(0, 100).entries()) {
      const result = edgar(row, at, index + 1); if (!result) { skipped++; continue; }
      if (seen.has(result.id)) continue; seen.add(result.id);
      if (results.length < 5) results.push(discoveryWorkSchema.parse(result));
    }
    return { results, skipped, truncated: rows.length > 100 || seen.size > 5 };
  } },
  fred: { id: "fred", kinds: ["series"], credential: "FRED_API_KEY", endpoint(query, _contact, key) {
    const url = new URL("https://api.stlouisfed.org/fred/series/search"); url.searchParams.set("search_text", query); url.searchParams.set("api_key", key ?? ""); url.searchParams.set("file_type", "json"); url.searchParams.set("limit", "5"); return url;
  }, parse(payload, at) { return parse(z.object({ seriess: z.array(z.unknown()) }).parse(payload).seriess, fred, at); } },
  openalex: { id: "openalex", endpoint(query, contact) {
    const url = new URL("https://api.openalex.org/works"); url.searchParams.set("search", query); url.searchParams.set("per-page", "5");
    if (contact) url.searchParams.set("mailto", contact); return url;
  }, parse(payload, at) { return parse(z.object({ results: z.array(z.unknown()) }).parse(payload).results, openalex, at); } },
  crossref: { id: "crossref", endpoint(query, contact) {
    const url = new URL("https://api.crossref.org/works"); url.searchParams.set("query", query); url.searchParams.set("rows", "5");
    if (contact) url.searchParams.set("mailto", contact); return url;
  }, parse(payload, at) { return parse(z.object({ status: z.literal("ok").optional(), message: z.object({ items: z.array(z.unknown()) }) }).parse(payload).message.items, crossref, at); } },
};

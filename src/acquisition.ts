import { randomUUID } from "node:crypto";
import { z } from "zod";
import { extractSource, detectedDoi, hashBytes, type ExtractedSource } from "./extraction.ts";
import { fetchPublic, HttpStatusError, publicUrl, type PublicRequest, type PublicResponse } from "./public-http.ts";
import { normalizeDoi } from "./scholarly-providers.ts";
import { SourceStore, type SourceRecord } from "./source-store.ts";
import { parseSuggestedBy } from "./source-id.ts";
import { abortable } from "./http.ts";
import type { Source } from "./types.ts";

export type Resolver = "unpaywall" | "europepmc" | "core";
export interface AcquisitionOptions { request?: PublicRequest; env?: { TURING_CONTACT_EMAIL?: string; HYPERRESEARCH_CONTACT_EMAIL?: string; CORE_API_KEY?: string } }
const resolverSchema = z.enum(["unpaywall", "europepmc", "core"]);
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const array = (value: unknown): any[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const key = (value: string | undefined) => value && !/[\x00-\x20\x7f]/.test(value) ? value : undefined;
const validContact = (value: string | undefined) => value && z.email().safeParse(value).success ? value : undefined;
export function resolverCoverage(approved: unknown, env: AcquisitionOptions["env"] = process.env): NonNullable<Source["resolverCoverage"]> {
  return [...new Set(z.array(resolverSchema).max(3).parse(approved))].map(resolver => {
    const required = resolver === "unpaywall" ? "TURING_CONTACT_EMAIL" : resolver === "core" ? "CORE_API_KEY" : undefined;
    const available = !required || !!(resolver === "unpaywall" ? validContact(env?.TURING_CONTACT_EMAIL ?? env?.HYPERRESEARCH_CONTACT_EMAIL) : key(env?.CORE_API_KEY));
    return { resolver, available, reason: available ? null : `Requires ${required}` };
  });
}
export async function metadata(request: PublicRequest, url: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<unknown> {
  const deadline = AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]);
  const response = await abortable(request(url, { signal: deadline, maxBytes: 2_000_000, redirects: false, headers: { Accept: "application/json", ...headers } }), deadline);
  deadline.throwIfAborted();
  if (response.bytes.length > 2_000_000) throw new Error("Metadata exceeds byte limit");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.bytes)); } catch { throw new Error("Invalid metadata response"); }
}
interface Candidate { url: string; resolver: Resolver; version: SourceRecord["extraction"]["version"]; license?: string; coreText?: boolean }
export class Acquisition {
  private readonly request: PublicRequest;
  constructor(private store: SourceStore, private options: AcquisitionOptions = {}) { this.request = options.request ?? fetchPublic; }
  private async candidates(resolver: Resolver, doi: string, signal?: AbortSignal): Promise<Candidate[]> {
    const env = this.options.env ?? process.env;
    if (resolver === "unpaywall") {
      const contact = validContact(env.TURING_CONTACT_EMAIL ?? env.HYPERRESEARCH_CONTACT_EMAIL); if (!contact) return [];
      const url = new URL(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}`); url.searchParams.set("email", contact);
      const data = object(await metadata(this.request, url.href, signal));
      if (data.is_oa !== true) return [];
      const locations = [data.best_oa_location, ...array(data.oa_locations)].filter(Boolean).slice(0, 20).map(object);
      const versions = { publishedVersion: "published", acceptedVersion: "accepted", submittedVersion: "submitted" } as const;
      const rank: Record<string, number> = { publishedVersion: 0, acceptedVersion: 1, submittedVersion: 2 };
      locations.sort((a, b) => (rank[a.version] ?? 3) - (rank[b.version] ?? 3));
      return ["url_for_pdf", "url"].flatMap(field => locations.flatMap(item => typeof item[field] === "string" ? [{ url: item[field], resolver,
        version: versions[item.version as keyof typeof versions] ?? "unknown", license: string(item.license)?.slice(0, 200) }] : []));
    }
    if (resolver === "europepmc") {
      const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
      url.search = new URLSearchParams({ query: `DOI:"${doi}"`, format: "json", resultType: "core", pageSize: "1" }).toString();
      const data = object(await metadata(this.request, url.href, signal));
      const item = object(array(object(data.resultList).result)[0]);
      if (item.isOpenAccess !== "Y" || !/^PMC\d+$/.test(String(item.pmcid)) || normalizeDoi(item.doi) !== doi) return [];
      return [{ url: `https://www.ebi.ac.uk/europepmc/webservices/rest/${item.pmcid}/fullTextXML`, resolver, version: "published", license: string(item.license)?.slice(0, 200) }];
    }
    const credential = key(env.CORE_API_KEY); if (!credential) return [];
    const url = new URL("https://api.core.ac.uk/v3/search/works"); url.search = new URLSearchParams({ q: `doi:"${doi}"`, limit: "1" }).toString();
    const data = object(await metadata(this.request, url.href, signal, { Authorization: `Bearer ${credential}` }));
    const item = object(array(data.results)[0]);
    if (normalizeDoi(item.doi) !== doi) return [];
    const version = /preprint/i.test(String(item.documentType)) ? "submitted" as const : "unknown" as const;
    const common = { resolver, version, license: string(item.license)?.slice(0, 200) };
    return [...(/^\d+$/.test(String(item.id)) ? [{ ...common, url: `https://api.core.ac.uk/v3/works/${item.id}`, coreText: true }] : []),
      ...[item.downloadUrl, ...array(item.sourceFulltextUrls)].slice(0, 10).flatMap(url => typeof url === "string" ? [{ ...common, url }] : [])];
  }
  private async acquire(url: string, signal?: AbortSignal, onResponse?: (response: PublicResponse) => void): Promise<{ response: PublicResponse; extracted: ExtractedSource }> {
    const deadline = AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]);
    const response = await abortable(this.request(publicUrl(url).href, { signal: deadline }), deadline);
    onResponse?.(response);
    return { response, extracted: await extractSource(response, deadline) };
  }
  async fetch(url: string, approved: unknown = [], suggestedBy?: string, signal?: AbortSignal) {
    url = publicUrl(url).href;
    const coverage = resolverCoverage(approved, this.options.env ?? process.env);
    suggestedBy = parseSuggestedBy(suggestedBy);
    if (suggestedBy !== undefined) {
      try { this.store.load(suggestedBy); } // Never invent or silently discard a provenance parent, even on cache hits.
      catch (cause) {
        throw new Error("Cannot validate suggestedBy: the parent must be an existing readable public source. Use its exact ID from fetch_source or vault_search, then read it with read_source before retrying. Do not invent an ID or bypass a failed parent validation.", { cause });
      }
    }
    signal?.throwIfAborted();
    const existing = this.store.findUrl(url);
    if (existing) return { note_id: existing.id, reused: true, resolverCoverage: coverage };
    let original: Awaited<ReturnType<Acquisition["acquire"]>> | undefined;
    let failure: unknown; let originalResponse: PublicResponse | undefined;
    try { original = await this.acquire(url, signal, response => { originalResponse = response; }); } catch (error) { signal?.throwIfAborted(); failure = error; }
    let selected = original;
    // A 200 login wall may still disclose a DOI in its citation metadata. That
    // identifier can locate an approved copy; the wall itself is not evidence.
    const doi = original?.extracted.doi ?? detectedDoi(url, originalResponse && /html/i.test(originalResponse.contentType)
      ? new TextDecoder().decode(originalResponse.bytes.subarray(0, 30_000)) : "");
    let oa: SourceRecord["oa"];
    if (doi && (!original || original.extracted.body.length < 6000 || original.extracted.extraction.status !== "text-extracted")) {
      const visited = new Set([url]);
      // The allowlist grants access; it does not change resolver precedence.
      for (const resolver of ["unpaywall", "europepmc", "core"] as const) {
        const entry = coverage.find(item => item.resolver === resolver);
        if (!entry?.available) continue;
        try {
          const candidates = await this.candidates(entry.resolver, doi, signal);
          let attempts = 0;
          for (const candidate of candidates) {
            if (visited.has(candidate.url)) continue;
            if (++attempts > 3) break;
            visited.add(candidate.url);
            try {
              let acquired: Awaited<ReturnType<Acquisition["acquire"]>>;
              if (candidate.coreText) {
                const credential = key((this.options.env ?? process.env).CORE_API_KEY); if (!credential) break;
                const record = object(await metadata(this.request, candidate.url, signal, { Authorization: `Bearer ${credential}` }));
                if (normalizeDoi(record.doi) !== doi || typeof record.fullText !== "string" || record.fullText.length < 6000) continue;
                const response = { url: candidate.url, bytes: Buffer.from(record.fullText), contentType: "text/plain; charset=utf-8" };
                acquired = { response, extracted: await extractSource(response, signal) };
                acquired.extracted.title = String(record.title ?? "CORE source").slice(0, 1000);
              } else acquired = await this.acquire(candidate.url, signal);
              if (acquired.extracted.body.length < 6000 || acquired.extracted.body.length <= (original?.extracted.body.length ?? 0) || acquired.extracted.extraction.status !== "text-extracted") continue;
              if (acquired.extracted.doi && acquired.extracted.doi !== doi) continue;
              acquired.extracted.extraction.version = candidate.version;
              selected = acquired;
              oa = { url: acquired.response.url, source: candidate.resolver, version: candidate.version, license: candidate.license,
                recovery_kind: original ? "substituted" : "rescued", nothing_from_source: !original, originalUrl: url };
              // Notice is metadata, not prepended to the body/hash/page offsets.
              acquired.extracted.extraction.warnings.push(`${original ? "Full text substituted" : "Original source unread; full text rescued"} via ${candidate.resolver}; acquired version: ${candidate.version}`);
              break;
            } catch { signal?.throwIfAborted(); entry.reason = "Some full-text candidates could not be acquired"; }
          }
          if (!selected || selected === original) entry.reason ??= "No usable full-text copy found";
        } catch { signal?.throwIfAborted(); entry.reason = "Resolver request failed; no provider was substituted"; }
        if (selected && selected !== original) break;
      }
    }
    if (!selected) throw failure instanceof HttpStatusError ? failure : new Error("Source could not be acquired; no usable approved full-text recovery");
    const { extracted, response } = selected;
    // A short scholarly landing page/abstract is not a complete paper.
    if (doi && extracted.extraction.media !== "pdf" && extracted.body.length < 6000) {
      extracted.extraction.status = "incomplete";
      extracted.extraction.warnings.push("Thin DOI-bearing text may be an abstract or landing page, not complete evidence");
    }
    signal?.throwIfAborted();
    const id = `source-${randomUUID()}`;
    this.store.save({ version: 1, id, title: extracted.title, url, body: extracted.body, hash: hashBytes(extracted.body),
      retrievedAt: new Date().toISOString(), doi, suggestedBy, extraction: extracted.extraction, pageSpans: extracted.pageSpans, oa }, response.bytes);
    return { note_id: id, reused: false, resolverCoverage: coverage };
  }
}

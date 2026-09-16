import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { abortable, boundedBody } from "./http.ts";
import { discoveryBatchSchema, discoveryKindSchema, scholarlyProviderSchema, type DiscoveryKind, type DiscoveryBatch, type DiscoveryWork, type ScholarlyProvider } from "./discovery-types.ts";
import { scholarlyAdapters } from "./scholarly-providers.ts";

export function consolidateWorks(input: DiscoveryWork[]): Pick<DiscoveryBatch, "results" | "uncertainMatches"> {
  const results: DiscoveryWork[] = []; const uncertainMatches: DiscoveryBatch["uncertainMatches"] = [];
  const title = (work: DiscoveryWork) => work.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const unique = <T>(items: T[]) => [...new Map(items.map(item => [JSON.stringify(item), item])).values()];
  for (const work of input) {
    const match = results.find(item => (work.doi && work.doi === item.doi) || work.identifiers.some(id => item.identifiers.some(other => other.scheme === id.scheme && other.value === id.value)));
    if (match && work.workType === match.workType && work.version === match.version && !(work.correction !== null && match.correction !== null && work.correction !== match.correction)) {
      if (title(work) !== title(match) || (work.date && match.date && work.date.value.slice(0, 4) !== match.date.value.slice(0, 4))) uncertainMatches.push({ ids: [match.id, work.id], reason: "Shared stable identifier, conflicting bibliographic metadata; do not count as independent sources" });
      match.identifiers = unique([...match.identifiers, ...work.identifiers]).slice(0, 20);
      match.provenance = [...match.provenance, ...work.provenance].slice(0, 20);
      match.urls = unique([...match.urls, ...work.urls]).slice(0, 20);
      match.fullTextCandidates = unique([...match.fullTextCandidates, ...work.fullTextCandidates]).slice(0, 20);
      match.relations = unique([...match.relations, ...work.relations]).slice(0, 20);
      match.citationCounts = unique([...match.citationCounts, ...work.citationCounts]).slice(0, 10);
      match.abstract ??= work.abstract;
      if (!match.date || (match.date.kind === "registration" && work.date?.kind === "publication")) match.date = work.date;
      match.retracted = match.retracted === true || work.retracted === true ? true : match.retracted ?? work.retracted;
      continue;
    }
    const possible = match ?? results.find(item => title(item).length >= 30 && title(item) === title(work) &&
      item.date?.value.slice(0, 4) === work.date?.value.slice(0, 4) && item.authors.length > 0 && work.authors.length > 0 && item.authors[0].toLowerCase() === work.authors[0].toLowerCase());
    if (possible) uncertainMatches.push({ ids: [possible.id, work.id], reason: match ? "Shared identifier but distinct or uncertain versions/types; retained separately, not independent corroboration" : "Bibliographic similarity without a common stable identifier; not merged or counted as independent" });
    results.push(structuredClone(work));
  }
  return { results, uncertainMatches: uncertainMatches.slice(0, 100) };
}
interface Options {
  fetchImpl?: typeof fetch; env?: { TURING_CONTACT_EMAIL?: string; HYPERRESEARCH_CONTACT_EMAIL?: string; CORE_API_KEY?: string; FRED_API_KEY?: string };
  timeoutMs?: number; minIntervalMs?: number;
}
type ProviderResult = { results: DiscoveryWork[]; skipped: number; truncated: boolean };
/** Per-investigation discovery service: no storage backend or cross-project cache. */
export class ScholarlyDiscovery {
  private cache = new Map<string, { at: number; value: ProviderResult }>();
  private queues = new Map<ScholarlyProvider, Promise<unknown>>();
  private nextRequest = new Map<ScholarlyProvider, number>();
  constructor(private options: Options = {}) {}
  async search(query: string, enabled: readonly ScholarlyProvider[] = ["openalex", "crossref"], signal?: AbortSignal, kind: DiscoveryKind = "literature"): Promise<DiscoveryBatch> {
    z.string().trim().min(1).max(500).parse(query);
    const providers = [...new Set(z.array(scholarlyProviderSchema).max(7).parse(enabled))];
    discoveryKindSchema.parse(kind);
    if (!providers.length) throw new Error("No scholarly providers approved");
    const env = this.options.env ?? process.env;
    const contact = env.TURING_CONTACT_EMAIL ?? env.HYPERRESEARCH_CONTACT_EMAIL;
    if (contact) z.email().parse(contact);
    signal?.throwIfAborted();
    const coverage: DiscoveryBatch["coverage"] = [];
    const values = await Promise.all(providers.map(async provider => {
      const deadline = AbortSignal.any([AbortSignal.timeout(Math.max(1, Math.min(30_000, this.options.timeoutMs ?? 10_000))), ...(signal ? [signal] : [])]);
      const adapter = scholarlyAdapters[provider];
      if (!(adapter.kinds ?? ["literature", "book"]).includes(kind)) {
        coverage.push({ provider, status: "not-selected", count: 0, skipped: 0, cached: false, error: `Not routed for ${kind} evidence` }); return [];
      }
      const credential = adapter.credential === "TURING_CONTACT_EMAIL" ? contact : adapter.credential ? env[adapter.credential] : undefined;
      if (adapter.credential && (!credential?.trim() || /[\x00-\x20\x7f]/.test(credential))) {
        coverage.push({ provider, status: "unavailable", count: 0, skipped: 0, cached: false, error: `Requires ${adapter.credential}` }); return [];
      }
      // Revalidate credentials before cache hits; never retain secret-bearing URLs.
      const key = JSON.stringify([provider, query, contact ?? "", createHash("sha256").update(credential ?? "").digest("hex")]);
      try {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.at < 300_000) {
          coverage.push({ provider, status: cached.value.skipped || cached.value.truncated ? "partial" : "ok", count: cached.value.results.length, skipped: cached.value.skipped, cached: true });
          return structuredClone(cached.value.results);
        }
        const operation = (this.queues.get(provider) ?? Promise.resolve()).catch(() => {}).then(async () => {
          deadline.throwIfAborted();
          const wait = Math.max(0, (this.nextRequest.get(provider) ?? 0) - Date.now());
          if (wait) await delay(wait, undefined, { signal: deadline });
          deadline.throwIfAborted();
          this.nextRequest.set(provider, Date.now() + Math.max(0, this.options.minIntervalMs ?? 500));
          const fetching = (this.options.fetchImpl ?? fetch)(adapter.endpoint(query, contact, credential), {
            signal: deadline, redirect: "error", credentials: "omit", headers: { Accept: "application/json", ...adapter.headers?.(credential, contact) },
          });
          void fetching.then(response => { if (deadline.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
          const response = await abortable(fetching, deadline);
          if (!response.ok) {
            if (response.status === 429) {
              const raw = response.headers.get("retry-after") ?? "60";
              const seconds = /^\d+$/.test(raw) ? Number(raw) : Math.max(0, (Date.parse(raw) - Date.now()) / 1000);
              this.nextRequest.set(provider, Date.now() + Math.min(300, Number.isFinite(seconds) ? seconds : 60) * 1000);
            }
            void response.body?.cancel().catch(() => {});
            throw new Error(`HTTP ${response.status}`);
          }
          const raw = await boundedBody(response, 2_000_000, deadline);
          deadline.throwIfAborted();
          let value: ProviderResult;
          try { value = adapter.parse(JSON.parse(raw), new Date().toISOString()); }
          catch { throw new Error("Malformed provider response"); }
          this.cache.set(key, { at: Date.now(), value: structuredClone(value) });
          if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!);
          return value;
        });
        this.queues.set(provider, operation.catch(() => {}));
        const value = await abortable(operation, deadline);
        coverage.push({ provider, status: value.skipped || value.truncated ? "partial" : "ok", count: value.results.length, skipped: value.skipped, cached: false });
        return value.results;
      } catch (error) {
        signal?.throwIfAborted();
        // Never echo network exceptions, response bodies, headers or credential values.
        const reason = deadline.aborted ? "Provider deadline exceeded" : error instanceof Error && /^(HTTP \d{3}|Malformed provider response|Response exceeds 2MB limit)$/.test(error.message) ? error.message : "Provider request failed";
        coverage.push({ provider, status: "failed", count: 0, skipped: 0, cached: false, error: reason }); return [];
      }
    }));
    signal?.throwIfAborted();
    // Interleave provider relevance ranks; citation counts do not drive ordering.
    const ranked = Array.from({ length: 5 }, (_, rank) => values.flatMap(value => value[rank] ? [value[rank]] : [])).flat();
    const batch = discoveryBatchSchema.parse({ query, retrievedAt: new Date().toISOString(), ...consolidateWorks(ranked),
      coverage: providers.map(provider => coverage.find(item => item.provider === provider)!),
      limitation: "Discovery metadata and abstracts are untrusted leads, not full-read evidence or independent corroboration." });
    while (Buffer.byteLength(JSON.stringify(batch)) > 45_000 && (batch.results.length || batch.uncertainMatches.length)) {
      if (batch.uncertainMatches.length) batch.uncertainMatches.pop(); else batch.results.pop();
      for (const provider of batch.coverage) if (["ok", "partial"].includes(provider.status)) { provider.status = "partial"; provider.error = "Output budget reached; some records or match diagnostics omitted"; }
    }
    return batch;
  }
}

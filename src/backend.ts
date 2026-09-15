import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { Acquisition, metadata, type AcquisitionOptions, type Resolver } from "./acquisition.ts";
import { abortable } from "./http.ts";
import { fetchPublic, HttpStatusError, publicUrl } from "./public-http.ts";
import { SourceStore } from "./source-store.ts";
import { lightProfile, verifyReport, type VerificationInput } from "./verification.ts";
import type { ScholarlyProvider } from "./discovery-types.ts";
import type { SourcePage } from "./types.ts";

export interface EvidenceBackend {
  initialize(): Promise<typeof lightProfile>;
  searchVault(query: string, signal?: AbortSignal): Promise<ReturnType<SourceStore["search"]>>;
  fetchSource(args: { url: string; resolvers?: Resolver[]; suggestedBy?: string }, signal?: AbortSignal): Promise<Awaited<ReturnType<Acquisition["fetch"]>>>;
  readSource(args: { id: string; offset?: number }, signal?: AbortSignal): Promise<SourcePage>;
  refreshRetractions(args: { ids: string[]; providers: ScholarlyProvider[] }, signal?: AbortSignal): Promise<RetractionResult>;
  verifyReport(input: VerificationInput, signal?: AbortSignal): Promise<ReturnType<typeof verifyReport>>;
}
export interface RetractionResult { checked: number; unresolved: number; rate_limited: number; retracted: string[] }

/** Native evidence services. RunStore alone owns scheduling and report state. */
export class NativeBackend implements EvidenceBackend {
  private acquisitions = new Map<string, Promise<unknown>>();
  private metadataQueue: Promise<unknown> = Promise.resolve();
  private store: SourceStore;
  private acquisition: Acquisition;

  constructor(readonly cwd: string, private options: AcquisitionOptions & { metadataIntervalMs?: number } = {}) {
    this.store = new SourceStore(cwd);
    this.acquisition = new Acquisition(this.store, options);
  }
  async initialize() {
    this.store.init();
    return structuredClone(lightProfile);
  }
  async searchVault(query: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    return this.store.search(query);
  }
  async fetchSource(args: Parameters<EvidenceBackend["fetchSource"]>[0], signal?: AbortSignal) {
    const url = publicUrl(args.url).href;
    // Serialize only acquisitions of the same URL. Each caller retains its own
    // cancellation and resolver approval; unrelated reads/fetches stay available.
    const operation = (this.acquisitions.get(url) ?? Promise.resolve()).catch(() => {}).then(() => {
      signal?.throwIfAborted();
      return this.acquisition.fetch(url, args.resolvers ?? [], args.suggestedBy, signal);
    });
    this.acquisitions.set(url, operation);
    void operation.finally(() => {
      if (this.acquisitions.get(url) === operation) this.acquisitions.delete(url);
    }).catch(() => {});
    return signal ? abortable(operation, signal) : operation;
  }
  async readSource({ id, offset = 0 }: Parameters<EvidenceBackend["readSource"]>[0], signal?: AbortSignal) {
    signal?.throwIfAborted();
    return this.store.page(id, offset, signal);
  }
  async refreshRetractions(args: Parameters<EvidenceBackend["refreshRetractions"]>[0], signal?: AbortSignal): Promise<RetractionResult> {
    const operation = this.metadataQueue.catch(() => {}).then(async () => {
      signal?.throwIfAborted();
      const sources = [...new Set(z.array(z.string()).max(30).parse(args.ids))].map(id => this.store.load(id));
      if (sources.some(source => source.doi) && !args.providers.includes("openalex")) {
        throw new Error("Retraction refresh requires approved OpenAlex; no provider was enabled");
      }
      const result: RetractionResult = { checked: 0, unresolved: 0, rate_limited: 0, retracted: [] };
      const retracted = new Set(sources.filter(source => source.retracted).map(source => source.id));
      let requested = false;
      for (const source of sources) {
        signal?.throwIfAborted();
        if (!source.doi) continue;
        if (requested) await delay(this.options.metadataIntervalMs ?? 500, undefined, { signal });
        requested = true;
        try {
          const data = await metadata(this.options.request ?? fetchPublic, `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(source.doi)}`, signal);
          const parsed = z.object({ is_retracted: z.boolean() }).safeParse(data);
          if (!parsed.success) throw new Error("Retraction metadata was malformed; status is unknown");
          result.checked++;
          if (parsed.data.is_retracted) {
            this.store.recordRetraction(source.id, source.doi);
            retracted.add(source.id);
          }
        } catch (error) {
          signal?.throwIfAborted();
          if (error instanceof HttpStatusError && error.status === 404) result.unresolved++;
          else if (error instanceof HttpStatusError && error.status === 429) result.rate_limited++;
          else throw new Error("Retraction metadata request failed; status is unknown");
        }
      }
      signal?.throwIfAborted();
      result.retracted = [...retracted];
      return result;
    });
    this.metadataQueue = operation;
    return signal ? abortable(operation, signal) : operation;
  }
  async verifyReport(input: VerificationInput, signal?: AbortSignal) {
    signal?.throwIfAborted();
    return verifyReport(input, this.store);
  }
}

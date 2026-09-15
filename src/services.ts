import type { EvidenceBackend } from "./backend.ts";
import { webSearch } from "./search.ts";
import { ScholarlyDiscovery } from "./scholarly.ts";

export interface Backend extends EvidenceBackend {
  searchWeb: (provider: Parameters<typeof webSearch>[0], query: string, signal?: AbortSignal) => ReturnType<typeof webSearch>;
  searchScholarly: ScholarlyDiscovery["search"];
}

/** Typed composition; discovery never needs a source store. */
export class ResearchServices implements Backend {
  constructor(private evidence: EvidenceBackend, private scholarly = new ScholarlyDiscovery(), private web = webSearch) {}
  initialize: EvidenceBackend["initialize"] = () => this.evidence.initialize();
  searchVault: EvidenceBackend["searchVault"] = (query, signal) => this.evidence.searchVault(query, signal);
  fetchSource: EvidenceBackend["fetchSource"] = (args, signal) => this.evidence.fetchSource(args, signal);
  readSource: EvidenceBackend["readSource"] = (args, signal) => this.evidence.readSource(args, signal);
  refreshRetractions: EvidenceBackend["refreshRetractions"] = (args, signal) => this.evidence.refreshRetractions(args, signal);
  verifyReport: EvidenceBackend["verifyReport"] = (input, signal) => this.evidence.verifyReport(input, signal);
  searchWeb: Backend["searchWeb"] = (provider, query, signal) => this.web(provider, query, { signal });
  searchScholarly: Backend["searchScholarly"] = (query, providers, signal, kind) => this.scholarly.search(query, providers, signal, kind);
}

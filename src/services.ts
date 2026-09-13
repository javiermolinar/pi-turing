import { z } from "zod";
import type { Backend, BackendAction } from "./backend.ts";
import { searchProviderSchema, webSearch } from "./search.ts";
import { scholarlyProviderSchema } from "./discovery-types.ts";
import { ScholarlyDiscovery } from "./scholarly.ts";

/** Research-facing composition boundary; discovery does not depend on a vault. */
export class ResearchServices implements Backend {
  constructor(private workingState: Backend, private scholarly = new ScholarlyDiscovery(), private web = webSearch) {}
  async call<T>(action: BackendAction, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    if (action === "web_search") return await this.web(searchProviderSchema.parse(args.provider), z.string().parse(args.query), { signal }) as T;
    if (action === "scholar_search") return await this.scholarly.search(z.string().parse(args.query),
      z.array(scholarlyProviderSchema).max(2).parse(args.providers ?? ["openalex", "crossref"]), signal) as T;
    return this.workingState.call<T>(action, args, signal);
  }
}

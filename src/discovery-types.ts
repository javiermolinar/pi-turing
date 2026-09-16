import { z } from "zod";

export const scholarlyProviderSchema = z.enum(["openalex", "crossref", "core", "doab", "clinicaltrials", "edgar", "fred"]);
export const discoveryKindSchema = z.enum(["literature", "book", "trial", "filing", "series"]);
export type DiscoveryKind = z.infer<typeof discoveryKindSchema>;
export type ScholarlyProvider = z.infer<typeof scholarlyProviderSchema>;
export const workTypeSchema = z.enum(["article", "book", "book-chapter", "preprint", "thesis", "report", "dataset", "trial", "filing", "series", "correction", "retraction-notice", "other"]);
export const versionSchema = z.enum(["submitted", "accepted", "published", "unknown"]);
const urlSchema = z.string().max(2048).refine(raw => { try { const url = new URL(raw); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; } });
export const discoveryWorkSchema = z.object({
  id: z.string().max(300), identifiers: z.array(z.object({ scheme: z.string().max(30), value: z.string().max(300) })).max(20),
  doi: z.string().max(300).optional(), title: z.string().min(1).max(500), authors: z.array(z.string().max(150)).max(20),
  date: z.object({ value: z.string().max(10), kind: z.enum(["publication", "registration", "filing", "observation"]), precision: z.enum(["year", "month", "day"]) }).optional(),
  workType: workTypeSchema, version: versionSchema,
  retracted: z.boolean().nullable(), correction: z.boolean().nullable(),
  url: urlSchema, urls: z.array(urlSchema).max(20),
  fullTextCandidates: z.array(z.object({ url: urlSchema, version: versionSchema, format: z.enum(["pdf", "html", "unknown"]), access: z.enum(["open", "unknown"]), provider: scholarlyProviderSchema })).max(20),
  abstract: z.string().max(1500).optional(),
  metadata: z.record(z.string().max(60), z.string().max(500)).refine(value => Object.keys(value).length <= 20).optional(),
  citationCounts: z.array(z.object({ provider: scholarlyProviderSchema, count: z.number().int().nonnegative() })).max(10),
  relations: z.array(z.object({ type: z.string().max(60), doi: z.string().max(300) })).max(20),
  provenance: z.array(z.object({ provider: scholarlyProviderSchema, recordId: z.string().max(300), retrievedAt: z.string(), rank: z.number().int().positive(), rawType: z.string().max(80) })).max(20),
  evidence: z.literal("discovery-only"),
});
export type DiscoveryWork = z.infer<typeof discoveryWorkSchema>;
export const discoveryBatchSchema = z.object({
  query: z.string().min(1).max(500), retrievedAt: z.string(), results: z.array(discoveryWorkSchema).max(20),
  coverage: z.array(z.object({ provider: scholarlyProviderSchema, status: z.enum(["ok", "partial", "failed", "unavailable", "not-selected"]), count: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), cached: z.boolean(), error: z.string().max(300).optional() })).max(10),
  uncertainMatches: z.array(z.object({ ids: z.tuple([z.string(), z.string()]), reason: z.string().max(200) })).max(100),
  limitation: z.literal("Discovery metadata and abstracts are untrusted leads, not full-read evidence or independent corroboration."),
});
export type DiscoveryBatch = z.infer<typeof discoveryBatchSchema>;
export interface ScholarlyAdapter {
  id: ScholarlyProvider;
  kinds?: DiscoveryKind[];
  credential?: "CORE_API_KEY" | "FRED_API_KEY" | "TURING_CONTACT_EMAIL";
  endpoint(query: string, contact?: string, key?: string): URL;
  headers?(key?: string, contact?: string): Record<string, string>;
  parse(payload: unknown, retrievedAt: string): { results: DiscoveryWork[]; skipped: number; truncated: boolean };
}

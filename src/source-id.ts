import { z } from "zod";

export const publicSourceIdSchema = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,199}$/u)
  .refine(id => Buffer.byteLength(id) <= 240 && !id.startsWith("local-") && !id.startsWith("final_report"), "Not a public source ID");

export const suggestedByDescription = "Optional provenance parent: the exact ID of an existing saved public source returned by fetch_source, read_source, or vault_search. Not a URL, title, [[citation]], or search-result ID. Omit for URLs discovered through search without a saved source parent. Never invent an ID.";

export function parseSuggestedBy(value: unknown): string | undefined {
  if (value === undefined) return;
  const parsed = publicSourceIdSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid suggestedBy. ${suggestedByDescription}`);
  return parsed.data;
}

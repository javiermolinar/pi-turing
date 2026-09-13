import { z } from "zod";

export const extractionSchema = z.object({
  reader: z.string().max(100), media: z.enum(["html", "pdf", "text", "unknown"]),
  status: z.enum(["text-extracted", "incomplete", "unavailable", "unknown"]),
  actualUrl: z.string().max(2048), version: z.enum(["submitted", "accepted", "published", "unknown"]),
  rawHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  pages: z.number().int().nonnegative().optional(), textPages: z.number().int().nonnegative().optional(),
  missingPages: z.array(z.number().int().positive()).max(20).default([]),
  warnings: z.array(z.string().max(300)).max(20),
}).strict();
export type Extraction = z.infer<typeof extractionSchema>;
export const readingRequirementSchema = z.enum(["layout", "tables", "figures", "equations"]);
export function adequateExtraction(extraction: Extraction | undefined, requirements: readonly string[] = []): boolean {
  // Legacy checkpoints remain readable; real readers must return diagnostics.
  if (!extraction) return requirements.length === 0;
  if (extraction.status !== "text-extracted") return false;
  return !requirements.some(requirement => extraction.warnings.includes(`${requirement}-unverified`));
}
export const pageSpanSchema = z.object({ page: z.number().int().positive(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict();
export function untrustedBody(body: string, label: string): string {
  const neutralize = (text: string) => text.replace(/<\s*(\/?)\s*untrusted-source\b/gi, "<$1untrusted-source-inner");
  return `<untrusted-source>\n${neutralize(label)}\n${neutralize(body)}\n</untrusted-source>`;
}

import { z } from "zod";
export const passageSchema = z.object({ sourceId: z.string().min(1).max(200), quote: z.string().min(12).max(1600) }).strict();
export type Passage = z.infer<typeof passageSchema>;
export const verifiedPassageSchema = passageSchema.extend({
  sourceHash: z.string().min(1).max(100), offset: z.number().int().nonnegative(), units: z.enum(["utf16", "unicode"]),
}).strict();
export type VerifiedPassage = z.infer<typeof verifiedPassageSchema>;
export const auditUnitSchema = z.object({
  id: z.string(), text: z.string().max(5000), citations: z.array(z.string()).max(30), numeric: z.boolean(),
}).strict();
export type AuditUnit = z.infer<typeof auditUnitSchema>;
export const claimReviewSchema = z.object({
  unitId: z.string(), verdict: z.enum(["supported", "qualified", "unsupported", "contradicted", "not-checkable", "not-factual"]),
  reason: z.string().min(1).max(1500), passages: z.array(passageSchema).max(4),
}).strict();
export type ClaimReview = z.infer<typeof claimReviewSchema>;
export const claimReviewBatchSchema = z.object({ reviews: z.array(claimReviewSchema).min(1).max(10) }).strict();
export const auditFindingSchema = z.object({ unitId: z.string(), kind: z.enum(["dangling-citation", "uncited-number", "unsupported", "contradicted", "not-checkable", "unverified-quote", "incomplete-coverage"]), detail: z.string().max(1500) }).strict();
export type AuditFinding = z.infer<typeof auditFindingSchema>;
export const auditRecordSchema = z.object({
  reportHash: z.string(), stage: z.string(), startedAt: z.string(), completedAt: z.string().optional(),
  units: z.array(auditUnitSchema).max(100), reviews: z.array(claimReviewSchema).max(100),
  proofs: z.array(verifiedPassageSchema).max(400), findings: z.array(auditFindingSchema).max(300),
  exclusions: z.array(z.string().max(300)).max(20), status: z.enum(["running", "passed", "findings", "incomplete"]),
}).strict();
export type AuditRecord = z.infer<typeof auditRecordSchema>;
export const independenceSchema = z.object({
  groups: z.array(z.object({ sources: z.array(z.string()).max(30), signals: z.array(z.enum(["same-content", "same-url", "same-doi", "similar-text"])).max(4) }).strict()).max(30),
  ungrouped: z.array(z.string()).max(30),
  limitation: z.literal("Relationships are conservative signals, not proof of independence. Ungrouped sources remain unverified; clusters are not multiple corroborating voices."),
}).strict();
export type Independence = z.infer<typeof independenceSchema>;

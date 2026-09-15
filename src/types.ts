import { z } from "zod";
import { isAbsolute } from "node:path";
import { capabilityIdSchema, retrievedRefSchema } from "./capability-types.ts";
import { contextFileRequestSchema, contextInputsSchema } from "./context-types.ts";
import { extractionSchema, pageSpanSchema, readingRequirementSchema } from "./evidence.ts";
import { searchProviderSchema } from "./search.ts";
import { discoveryBatchSchema, scholarlyProviderSchema } from "./discovery-types.ts";
import { budgetAdjustmentSchema } from "./budget.ts";
import { revisionSpendingRecordSchema } from "./revision-approval.ts";

// Stable persisted IDs; execution uses names rather than upstream step numbers.
export const stages = { decompose: "1", research: "2", draft: "10", polish: "15", readability: "16" } as const;
export const stepIds = [stages.decompose, stages.research, stages.draft, stages.polish, stages.readability] as const;
export type StepId = typeof stepIds[number];
export const stepNames: Record<StepId, string> = {
  "1": "Decompose", "2": "Width sweep", "10": "Draft", "15": "Polish", "16": "Readability",
};
// Historical profiles are parsed only for read-only report access.
const savedScopeSchema = z.enum(["light", "full", "extended"]);
export const patchSchema = z.object({
  summary: z.string().max(3000),
  edits: z.array(z.object({ oldText: z.string().min(1).max(800), newText: z.string().max(800), reason: z.string().min(1).max(500) }).strict()).max(8),
}).strict();
export type Patch = z.infer<typeof patchSchema>;
export const roles = ["decompose", "research", "draft", "polish", "readability"] as const;
export type Role = typeof roles[number];
export const thinkingSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
export const configSchema = z.object({
  scope: z.literal("light", { error: "Only light research is supported; full/extended execution has been removed." }).default("light"),
  register: z.enum(["plain", "technical", "academic"]).default("plain"),
  depth: z.enum(["concise", "standard", "deep"]).default("standard"),
  capabilities: z.array(capabilityIdSchema).max(8).default([]),
  contextFiles: z.array(contextFileRequestSchema).max(8).default([]),
  additionalInstructions: z.string().max(4000).default(""),
  searchProvider: searchProviderSchema.default("duckduckgo"),
  scholarlyProviders: z.array(scholarlyProviderSchema).max(7).default(["openalex", "crossref"]),
  readingRequirements: z.array(readingRequirementSchema).max(4).default([]),
  fullTextResolvers: z.array(z.enum(["unpaywall", "europepmc", "core"])).max(3).default([]),
  concurrency: z.number().int().min(1).max(4).default(2),
  sourceTarget: z.number().int().min(10).max(30).default(15),
  maxTurns: z.number().int().min(5).max(150).default(80),
  workerTimeoutSeconds: z.number().int().min(30).max(7200).default(1800),
  budgetUsd: z.number().positive().nullable().default(15),
  models: z.object(Object.fromEntries(roles.map(role => [role, z.string().regex(/^[^/]+\/.+$/).optional()])) as Record<Role, z.ZodOptional<z.ZodString>>).strict().default({}),
}).strict();
export type Config = z.infer<typeof configSchema>;
export const decompositionSchema = z.object({
  title: z.string().min(1).max(200),
  questions: z.array(z.string().min(1).max(1000)).min(1).max(12),
  required_section_headings: z.array(z.string().min(1).max(150)).min(1).max(12),
  searches: z.array(z.object({ query: z.string().min(1).max(500), angle: z.enum(["primary", "context", "adversarial"]) }).strict()).min(3).max(20),
}).strict().refine(d => d.searches.some(s => s.angle === "adversarial"), "Include at least one adversarial search");
export type Decomposition = z.infer<typeof decompositionSchema>;
export const draftSchema = z.object({ markdown: z.string().min(100).max(200_000) }).strict();
export const researchSchema = z.object({ summary: z.string().min(1).max(8000), gaps: z.array(z.string().max(1000)).max(20) }).strict();
export const checkSchema = z.object({ name: z.string(), ok: z.boolean(), detail: z.string() });
export type Check = z.infer<typeof checkSchema>;
export const sourceSchema = z.object({
  id: z.string(), title: z.string(), url: z.string(), words: z.number(),
  origin: z.enum(["public", "local", "integration"]).optional(),
  integration: z.object({ bindingId: capabilityIdSchema, bindingHash: z.string(), uri: z.string().max(2048), version: z.string().max(150).optional(), visibility: z.enum(["private", "public"]) }).strict().optional(),
  purpose: z.enum(["background", "evidence"]).optional(),
  retrievedAt: z.string().optional(), contentHash: z.string().optional(), fullRead: z.boolean().default(false),
  extraction: extractionSchema.optional(),
  oa: z.unknown().optional(),
  resolverCoverage: z.array(z.object({ resolver: z.enum(["unpaywall", "europepmc", "core"]), available: z.boolean(), reason: z.string().nullable() })).max(3).optional(),
});
export type Source = z.infer<typeof sourceSchema>;
export const sourcePageSchema = sourceSchema.omit({ fullRead: true }).extend({
  offset: z.number().int().nonnegative(), end: z.number().int().nonnegative(), total: z.number().int().nonnegative(), hash: z.string(),
  body: z.string(), nextOffset: z.number().int().nonnegative().nullable(),
  pageSpans: z.array(pageSpanSchema).max(20).optional(),
});
export type SourcePage = z.infer<typeof sourcePageSchema>;
export const recoverySchema = z.enum(["retry-verification", "edit-report", "collect-evidence", "change-config", "new-run"]);
export type Recovery = z.infer<typeof recoverySchema>;
const workerSchema = z.object({
  id: z.string(), role: z.enum(roles), task: z.string(),
  status: z.enum(["running", "done", "failed", "interrupted"]),
  startedAt: z.string(), endedAt: z.string().optional(),
  turns: z.number(), tokens: z.number(), cost: z.number(),
  activity: z.string().optional(), error: z.string().optional(),
});
export type Worker = z.infer<typeof workerSchema>;
export const feedbackTextSchema = z.string().trim().min(1).max(4000);
export const feedbackSchema = z.object({
  id: z.number().int().positive(), text: feedbackTextSchema,
  status: z.enum(["queued", "applied"]), createdAt: z.string(), appliedAt: z.string().optional(),
});
export type Feedback = z.infer<typeof feedbackSchema>;
export const revisionSchema = z.object({
  parentTag: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  spendingApproval: revisionSpendingRecordSchema.optional(),
  report: z.string().max(200_000), sourceIds: z.array(z.string()).max(30),
  instructions: z.array(feedbackTextSchema).max(40),
});
export const stateSchema = z.object({
  version: z.literal(1), tag: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  migrationId: z.string().uuid().optional(),
  location: z.object({
    projectPath: z.string().refine(isAbsolute), dataRoot: z.string().refine(isAbsolute),
    workspaceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/), workspacePath: z.string().refine(isAbsolute),
    contextRefs: z.array(z.string()).max(128), approvalRefs: z.array(z.string()).max(20),
  }).strict().optional(),
  inputs: contextInputsSchema.optional(),
  retrieved: z.array(retrievedRefSchema).max(100).optional(),
  integrationCalls: z.array(z.object({ bindingId: capabilityIdSchema, queryHash: z.string(), at: z.string(), status: z.enum(["running", "done", "failed", "interrupted"]), count: z.number().int().nonnegative().optional() }).strict()).max(40).optional(),
  disclosure: z.object({ searchBlocked: z.boolean(), exportBlocked: z.boolean() }).strict().optional(),
  query: z.string().min(1).max(30_000),
  profile: savedScopeSchema,
  // Opaque legacy review metadata: no execution or interpretation remains.
  pipeline: z.unknown().optional(),
  status: z.enum(["paused", "running", "blocked", "done", "aborted", "failed"]),
  reason: z.string().optional(),
  recovery: recoverySchema.optional(),
  activity: z.object({ text: z.string(), at: z.string() }).optional(),
  feedback: z.array(feedbackSchema).max(20).default([]),
  revision: revisionSchema.optional(),
  reportStale: z.boolean().optional(),
  createdAt: z.string(), updatedAt: z.string(),
  elapsedMs: z.number().nonnegative(),
  // Removed providers remain readable, never executable. Missing provider fields
  // in historical checkpoints retain the old Brave default; new runs use DuckDuckGo.
  // Resume validates the saved config; project config is never substituted silently.
  config: configSchema.extend({ scope: savedScopeSchema.default("light"), searchProvider: z.enum([...searchProviderSchema.options, "parallel"]).default("brave") }),
  model: z.string(), thinking: thinkingSchema,
  sourceMin: z.number().int().min(1), wordTarget: z.tuple([z.number(), z.number()]),
  steps: z.record(z.string(), z.enum(["pending", "running", "done"])),
  workers: z.array(workerSchema), sources: z.array(sourceSchema),
  failures: z.array(z.object({ url: z.string(), error: z.string(), at: z.string() })),
  cost: z.number().nonnegative(), tokens: z.number().nonnegative(),
  budgetAdjustments: z.array(budgetAdjustmentSchema).max(100).optional(),
  pricingKnown: z.boolean(),
  discoveries: z.array(discoveryBatchSchema).max(100).optional(),
  decomposition: decompositionSchema.optional(),
  research: z.array(researchSchema).default([]),
  report: z.string().max(200_000).optional(),
  patches: z.record(z.string(), patchSchema),
  checks: z.array(checkSchema),
});
export type RunState = z.infer<typeof stateSchema>;

export { isReadOnlyRun, requireLightRun } from "./run-policy.ts";

export function now(): string { return new Date().toISOString(); }
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function cleanTerminal(text: string): string { return text.replace(/[\x00-\x1f\x7f-\x9f]/g, " "); }

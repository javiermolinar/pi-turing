import { z } from "zod";
import { isAbsolute } from "node:path";

export const contextFileRequestSchema = z.object({ path: z.string().min(1).max(2048), purpose: z.enum(["background", "evidence"]) }).strict();
export const contextRequestSchema = z.object({
  instructions: z.string().max(4000).default(""), files: z.array(contextFileRequestSchema).max(8).default([]),
}).strict();
export type ContextRequest = z.infer<typeof contextRequestSchema>;
export const disclosureSchema = z.object({ model: z.literal(true), search: z.boolean(), export: z.boolean() }).strict();
export type Disclosure = z.infer<typeof disclosureSchema>;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const contextRefSchema = z.object({
  id: z.string().regex(/^local-[a-f0-9]{32}$/), projectPath: z.string().refine(isAbsolute),
  originalPath: z.string().refine(isAbsolute), relativePath: z.string().max(2048),
  purpose: z.enum(["background", "evidence"]), bytes: z.number().int().min(1).max(200_000),
  contentHash: hash, capturedAt: z.string(),
}).strict();
export const contextSnapshotSchema = contextRefSchema.extend({ body: z.string().min(1).max(200_000) }).strict();
export type ContextRef = z.infer<typeof contextRefSchema>;
export const contextInputsSchema = z.object({
  projectPath: z.string().refine(isAbsolute), instructions: z.string().max(4000),
  files: z.array(contextRefSchema).max(8),
  grant: z.object({ id: z.string().uuid(), approvedAt: z.string(), disclosure: disclosureSchema, proposalHash: hash }).strict(),
}).strict();
export type ContextInputs = z.infer<typeof contextInputsSchema>;

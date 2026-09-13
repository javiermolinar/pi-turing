import { z } from "zod";
export const capabilityIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const capabilityDescriptorSchema = z.object({
  id: capabilityIdSchema, title: z.string().min(1).max(150), version: z.string().min(1).max(100),
  definition: z.string().min(1).max(12_000),
  scope: z.record(z.string().max(80), z.string().max(1000)).refine(value => Object.keys(value).length <= 20),
  credentialRefs: z.array(z.string().regex(/^(?:env:[A-Z_][A-Z0-9_]*|host:[a-zA-Z0-9_-]+)$/)).max(10).default([]),
  visibility: z.enum(["private", "public"]).default("private"),
  readOnly: z.literal(true),
}).strict();
export type CapabilityDescriptor = z.infer<typeof capabilityDescriptorSchema>;
export const capabilityBindingSchema = capabilityDescriptorSchema.extend({ hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type CapabilityBinding = z.infer<typeof capabilityBindingSchema>;
export const retrievedDocumentSchema = z.object({
  uri: z.string().min(1).max(2048), title: z.string().min(1).max(500), version: z.string().max(150).optional(),
  body: z.string().min(1).max(100_000), complete: z.boolean(),
}).strict();
export type RetrievedDocument = z.infer<typeof retrievedDocumentSchema>;
export const retrievedRefSchema = retrievedDocumentSchema.omit({ body: true }).extend({
  id: z.string().regex(/^local-[a-f0-9]{32}$/), bindingId: capabilityIdSchema, bindingHash: z.string().regex(/^[a-f0-9]{64}$/),
  visibility: z.enum(["private", "public"]), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive().max(100_000), retrievedAt: z.string(),
}).strict();
export type RetrievedRef = z.infer<typeof retrievedRefSchema>;

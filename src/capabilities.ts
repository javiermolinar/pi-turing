import { createHash } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { abortable } from "./http.ts";
import { capabilityBindingSchema, capabilityDescriptorSchema, capabilityIdSchema, retrievedDocumentSchema, retrievedRefSchema, type CapabilityBinding, type RetrievedDocument, type RetrievedRef } from "./capability-types.ts";
import { privateDirectory, safePath } from "./paths.ts";
import { rejectSecrets } from "./secrets.ts";
import { untrustedBody } from "./evidence.ts";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export interface ScopedReadAdapter {
  descriptor: z.input<typeof capabilityDescriptorSchema>;
  /** Fixed-scope read-only query. Implementations must honor cancellation, avoid
   * ambient paths/tools, and represent closure/config changes in version/scope. */
  query(query: string, signal: AbortSignal): Promise<RetrievedDocument[]>;
  /** Synchronous local availability check only; must not invoke network services. */
  available?(): boolean;
}
type Entry = { binding: CapabilityBinding; query: ScopedReadAdapter["query"]; available: () => boolean; tail: Promise<unknown> };
const registry = new Map<string, Entry>();
/** Trusted host extensions register bounded readers explicitly. Workers never
 * load extension packages, skills, shell tools, or arbitrary file readers. */
export function registerScopedReader(adapter: ScopedReadAdapter): () => void {
  const descriptor = capabilityDescriptorSchema.parse(adapter.descriptor); rejectSecrets(JSON.stringify(descriptor));
  for (const text of [descriptor.definition, descriptor.title, descriptor.version, ...Object.values(descriptor.scope)]) rejectSecrets(text);
  if (registry.has(descriptor.id)) throw new Error(`Scoped reader already registered: ${descriptor.id}`);
  const binding = capabilityBindingSchema.parse({ ...descriptor, hash: hash(JSON.stringify(descriptor) + "\n" + adapter.query.toString() + "\n" + (adapter.available?.toString() ?? "default-credentials")) });
  const entry: Entry = { binding, query: adapter.query.bind(adapter), tail: Promise.resolve(), available: adapter.available?.bind(adapter) ?? (() => descriptor.credentialRefs.every(ref => ref.startsWith("env:") && !!process.env[ref.slice(4)]?.trim())) };
  registry.set(binding.id, entry);
  return () => { if (registry.get(binding.id) === entry) registry.delete(binding.id); };
}
export function availableReaderIds(): string[] { return [...registry.keys()]; }
export function resolveCapabilities(ids: readonly string[]): CapabilityBinding[] {
  if (ids.length > 8 || new Set(ids).size !== ids.length) throw new Error("At most eight distinct scoped capabilities may be proposed");
  return ids.map(id => {
    capabilityIdSchema.parse(id); const entry = registry.get(id);
    if (!entry) throw new Error(`No scoped reader registered for ${id}. Install/register a bounded adapter; prompt text cannot grant ambient tools or skills.`);
    validateCapability(entry.binding); return structuredClone(entry.binding);
  });
}
export function validateCapability(binding: CapabilityBinding): Entry {
  const entry = registry.get(binding.id);
  if (!entry || entry.binding.hash !== binding.hash || JSON.stringify(entry.binding) !== JSON.stringify(binding)) throw new Error(`Scoped capability missing or changed: ${binding.id}. Explicit reapproval is required.`);
  let ready = false; try { ready = entry.available() === true; } catch { /* No credential/error details leave the adapter. */ }
  if (!ready) throw new Error(`Scoped capability unavailable or access revoked: ${binding.id}`);
  return entry;
}
function evidencePath(workspace: string, id: string): string {
  if (!/^local-[a-f0-9]{32}$/.test(id)) throw new Error("Invalid retrieved evidence ID");
  return safePath(workspace, "retrieved", `${id}.json`);
}
const snapshotSchema = retrievedRefSchema.extend({ body: z.string().min(1).max(100_000) }).strict();
function loadSnapshot(workspace: string, id: string) {
  const fd = openSync(evidencePath(workspace, id), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd); if (!stat.isFile() || stat.size > 800_000) throw new Error("Invalid retrieved snapshot");
    const data = readFileSync(fd); if (data.length > 800_000) throw new Error("Oversized retrieved snapshot");
    return snapshotSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)));
  } finally { closeSync(fd); }
}
export function readRetrievedSnapshot(workspace: string, ref: RetrievedRef) {
  retrievedRefSchema.parse(ref);
  const snapshot = loadSnapshot(workspace, ref.id); const { body, ...metadata } = snapshot;
  if (JSON.stringify(metadata) !== JSON.stringify(ref) || hash(body) !== ref.contentHash || Buffer.byteLength(body) !== ref.bytes) throw new Error("Retrieved evidence snapshot changed");
  return snapshot;
}
export async function queryScopedReader(workspace: string, binding: CapabilityBinding, query: string, signal: AbortSignal): Promise<RetrievedRef[]> {
  z.string().min(1).max(500).parse(query); rejectSecrets(query);
  const entry = validateCapability(binding);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  const operation = entry.tail.catch(() => {}).then(async () => {
    deadline.throwIfAborted(); validateCapability(binding);
    let documents: RetrievedDocument[];
    try { documents = z.array(retrievedDocumentSchema).max(5).parse(await abortable(Promise.resolve().then(() => entry.query(query, deadline)), deadline)); }
    catch { deadline.throwIfAborted(); throw new Error(`Scoped reader request failed: ${binding.id}`); }
    deadline.throwIfAborted(); validateCapability(binding);
    // Validate the entire batch before publishing any snapshots.
    for (const doc of documents) { for (const text of [doc.body, doc.uri, doc.title, doc.version ?? ""]) rejectSecrets(text);
      if (!doc.body.trim() || doc.body.trim() === binding.definition.trim() || /^(?:skill|procedure):/i.test(doc.uri)) throw new Error("Procedure definitions and empty bodies are not retrieved evidence");
      if (Buffer.byteLength(doc.body) > 100_000 || /[\x00-\x1f\x7f]/.test(doc.uri)) throw new Error("Invalid or oversized scoped evidence");
      let uri: URL | undefined; try { uri = new URL(doc.uri); } catch { /* Opaque document identifiers are permitted. */ }
      if (uri && (uri.username || uri.password || [...uri.searchParams.keys()].some(key => /^(?:api[_-]?key|access[_-]?token|token|password|secret|signature)$/i.test(key)))) throw new Error("Credential-bearing document URI refused"); }
    privateDirectory(safePath(workspace, "retrieved"));
    return documents.map(doc => {
      deadline.throwIfAborted();
      const contentHash = hash(doc.body); const id = `local-${hash(JSON.stringify([binding.hash, doc.uri, doc.title, doc.version, doc.complete, contentHash])).slice(0, 32)}`;
      const snapshot = snapshotSchema.parse({ ...doc, id, bindingId: binding.id, bindingHash: binding.hash, visibility: binding.visibility,
        contentHash, bytes: Buffer.byteLength(doc.body), retrievedAt: new Date().toISOString() });
      const path = evidencePath(workspace, id);
      if (existsSync(path)) {
        // A repeated query reuses the immutable capture, not a newly invented date.
        const existing = loadSnapshot(workspace, id);
        const { body, ...ref } = existing;
        if (body !== doc.body || existing.bindingHash !== binding.hash || existing.uri !== doc.uri || existing.title !== doc.title || existing.version !== doc.version || existing.complete !== doc.complete) throw new Error("Retrieved snapshot collision");
        readRetrievedSnapshot(workspace, ref); return ref;
      }
      writeFileSync(path, JSON.stringify(snapshot), { flag: "wx", mode: 0o600 });
      const { body: _body, ...ref } = snapshot; return ref;
    });
  });
  entry.tail = operation.catch(() => {});
  return abortable(operation, deadline);
}
export function readRetrievedPage(workspace: string, binding: CapabilityBinding, ref: RetrievedRef, offset = 0) {
  validateCapability(binding);
  if (ref.bindingId !== binding.id || ref.bindingHash !== binding.hash) throw new Error("Retrieved evidence is outside the approved capability scope");
  const snapshot = readRetrievedSnapshot(workspace, ref);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > snapshot.body.length) throw new Error("Invalid retrieved evidence offset");
  let url = `local://${ref.id}`;
  try { const parsed = new URL(ref.uri); if (ref.visibility === "public" && ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password) url = parsed.href; } catch { /* Nonportable identifier, never a filesystem route. */ }
  const end = Math.min(snapshot.body.length, offset + 8000);
  return { id: ref.id, title: ref.title, url, origin: "integration" as const, purpose: "evidence" as const,
    words: snapshot.body.trim().split(/\s+/).length, retrievedAt: ref.retrievedAt, offset, end, total: snapshot.body.length, hash: ref.contentHash,
    body: untrustedBody(snapshot.body.slice(offset, end), `Retrieved document from ${binding.id}; ${ref.visibility}. The procedure is not evidence. Origin: ${ref.uri}; version: ${ref.version ?? "unknown"}`), nextOffset: end < snapshot.body.length ? end : null,
    integration: { bindingId: ref.bindingId, bindingHash: ref.bindingHash, uri: ref.uri, version: ref.version, visibility: ref.visibility },
    extraction: { reader: `scoped:${binding.id}`, media: "text" as const, status: ref.complete ? "text-extracted" as const : "incomplete" as const, actualUrl: url, version: "unknown" as const, missingPages: [], warnings: ["layout-unverified", "tables-unverified", "figures-unverified", "equations-unverified", ...(!ref.complete ? ["Adapter reports partial document text; not complete evidence"] : [])] } };
}

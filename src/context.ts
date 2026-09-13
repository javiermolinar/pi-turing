import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { rejectSecrets } from "./secrets.ts";
import { resolveCapabilities, validateCapability } from "./capabilities.ts";
import type { CapabilityBinding } from "./capability-types.ts";
import { contextInputsSchema, contextRefSchema, contextRequestSchema, contextSnapshotSchema, disclosureSchema, type ContextInputs, type ContextRequest, type Disclosure } from "./context-types.ts";
import { privateDirectory, safePath } from "./paths.ts";
import { untrustedBody } from "./evidence.ts";

export const contentHash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const maxTotalBytes = 500_000;
const forbidden = /^(?:\.git|\.pi|\.ssh|\.aws|\.azure|\.gnupg|\.config|\.hyperresearch|\.env(?:\..*)?|\.npmrc|\.netrc|id_rsa|id_ed25519|credentials?(?:\..*)?|secrets?(?:\..*)?|passwords?(?:\..*)?)$/i;
export { rejectSecrets } from "./secrets.ts";
function filePath(project: string, selected: string): string {
  if (/[\x00-\x1f\x7f]/.test(selected) || selected.split(/[\\/]/).includes("..")) throw new Error("Invalid context path or traversal");
  const path = resolve(project, selected); const rel = relative(project, path);
  if (!rel || rel.startsWith(".." + sep) || rel === ".." || isAbsolute(rel)) throw new Error("Context files must be inside the originating project");
  let current = project;
  for (const part of rel.split(sep)) {
    if (forbidden.test(part)) throw new Error("Secret or protected context path refused");
    current = safePath(current, part);
  }
  if (![".md", ".txt", ".rst", ".json", ".csv"].includes(extname(path).toLowerCase())) throw new Error("Supported local context types: .md, .txt, .rst, .json, .csv");
  return path;
}
function readText(path: string, maxBytes = 200_000): string {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw new Error("Invalid or oversized context file");
    const data = readFileSync(fd);
    if (data.length > maxBytes || data.includes(0)) throw new Error("Binary or oversized context refused");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  } finally { closeSync(fd); }
}
export function readSelectedText(project: string, selected: string): { path: string; body: string } {
  const requestedRoot = resolve(project); const root = realpathSync(project);
  const local = isAbsolute(selected) && selected.startsWith(requestedRoot + sep) ? relative(requestedRoot, selected) : selected;
  const path = filePath(root, local); const body = readText(path); rejectSecrets(body);
  if (!body.trim()) throw new Error("Empty context text");
  return { path, body };
}
export interface ContextPreview {
  projectPath: string; instructions: string; files: { path: string; purpose: "background" | "evidence"; bytes: number; hash: string }[]; bindings: CapabilityBinding[]; hash: string;
}
export function previewContext(project: string, request: ContextRequest): ContextPreview {
  const parsed = contextRequestSchema.parse(request); const selectedProject = resolve(project); project = realpathSync(project); rejectSecrets(parsed.instructions);
  const files = parsed.files.map(file => {
    const selected = isAbsolute(file.path) && file.path.startsWith(selectedProject + sep) ? relative(selectedProject, file.path) : file.path;
    const { path, body } = readSelectedText(project, selected);
    return { path, purpose: file.purpose, bytes: Buffer.byteLength(body), hash: contentHash(body) };
  });
  if (new Set(files.map(file => file.path)).size !== files.length) throw new Error("Duplicate context paths");
  if (files.reduce((sum, file) => sum + file.bytes, 0) > maxTotalBytes) throw new Error("Context exceeds 500KB total limit");
  const bindings = resolveCapabilities(parsed.capabilities ?? []);
  const value = { projectPath: project, instructions: parsed.instructions, files, bindings };
  return { ...value, hash: contentHash(JSON.stringify(value)) };
}
function snapshotPath(workspace: string, id: string): string {
  if (!/^local-[a-f0-9]{32}$/.test(id)) throw new Error("Invalid context snapshot ID");
  return safePath(workspace, "context", `${id}.json`);
}
function grantPath(workspace: string, id: string): string {
  z.string().uuid().parse(id); return safePath(workspace, "approvals", `${id}.json`);
}
const approvalSchema = z.object({ inputs: contextInputsSchema, revokedAt: z.string().optional() }).strict();
function saveApproval(workspace: string, input: Omit<ContextInputs, "grant">, permissions: Disclosure, proposalHash: string): ContextInputs {
  const inputs = contextInputsSchema.parse({ ...input, grant: { id: randomUUID(), approvedAt: new Date().toISOString(), disclosure: disclosureSchema.parse(permissions), proposalHash } });
  privateDirectory(safePath(workspace, "approvals"));
  writeFileSync(grantPath(workspace, inputs.grant.id), JSON.stringify({ inputs }), { mode: 0o600, flag: "wx" });
  return inputs;
}
/** Call only after separate user approval of model, search, and export disclosure. */
export function approveContext(workspace: string, preview: ContextPreview, permissions: Disclosure): ContextInputs {
  disclosureSchema.parse(permissions);
  const current = previewContext(preview.projectPath, { instructions: preview.instructions, files: preview.files.map(file => ({ path: file.path, purpose: file.purpose })), capabilities: preview.bindings.map(binding => binding.id) });
  if (current.hash !== preview.hash) throw new Error("Context changed since preview; approve a fresh preview");
  privateDirectory(safePath(workspace, "context"));
  const files = current.files.map(file => {
    const body = readText(file.path); if (contentHash(body) !== file.hash) throw new Error("Context changed during snapshot capture");
    const id = `local-${contentHash(JSON.stringify([current.projectPath, file.path, file.purpose, file.hash])).slice(0, 32)}`;
    const path = snapshotPath(workspace, id);
    const snapshot = contextSnapshotSchema.parse({ id, projectPath: current.projectPath, originalPath: file.path, relativePath: relative(current.projectPath, file.path),
      purpose: file.purpose, bytes: file.bytes, contentHash: file.hash, capturedAt: new Date().toISOString(), body });
    if (existsSync(path)) {
      const saved = contextSnapshotSchema.parse(JSON.parse(readText(path, 1_500_000)));
      if (saved.body !== body || saved.originalPath !== file.path || saved.purpose !== file.purpose || saved.projectPath !== current.projectPath) throw new Error("Context snapshot collision");
      snapshot.capturedAt = saved.capturedAt;
    } else writeFileSync(path, JSON.stringify(snapshot), { mode: 0o600, flag: "wx" });
    const { body: _body, ...reference } = snapshot;
    return contextRefSchema.parse(reference);
  });
  return saveApproval(workspace, { projectPath: current.projectPath, instructions: current.instructions, files, bindings: current.bindings }, permissions, current.hash);
}
export function readContextSnapshot(workspace: string, inputs: ContextInputs, id: string) {
  const ref = inputs.files.find(file => file.id === id); if (!ref) throw new Error("Context ID not approved for this run");
  const snapshot = contextSnapshotSchema.parse(JSON.parse(readText(snapshotPath(workspace, id), 1_500_000)));
  const { body: _body, ...reference } = snapshot;
  if (JSON.stringify(contextRefSchema.parse(reference)) !== JSON.stringify(ref) || contentHash(snapshot.body) !== ref.contentHash || Buffer.byteLength(snapshot.body) !== ref.bytes) throw new Error("Context snapshot changed; explicit resolution required");
  return snapshot;
}
export function validateContextApproval(workspace: string, inputs: ContextInputs): void {
  contextInputsSchema.parse(inputs);
  const approval = approvalSchema.parse(JSON.parse(readText(grantPath(workspace, inputs.grant.id), 2_000_000)));
  if (approval.revokedAt || JSON.stringify(approval.inputs) !== JSON.stringify(inputs)) throw new Error("Context approval is revoked or changed; no model work may resume");
}
export function validateContext(workspace: string, inputs: ContextInputs): void {
  validateContextApproval(workspace, inputs);
  for (const binding of inputs.bindings ?? []) validateCapability(binding);
  for (const ref of inputs.files) readContextSnapshot(workspace, inputs, ref.id);
}
export function reapproveContext(workspace: string, inputs: ContextInputs, permissions: Disclosure): ContextInputs {
  // Explicit revision reuse pins old snapshots, never rereads current project files.
  validateContext(workspace, inputs);
  return saveApproval(workspace, { projectPath: inputs.projectPath, instructions: inputs.instructions, files: inputs.files, bindings: inputs.bindings }, permissions, inputs.grant.proposalHash);
}
export function revokeContext(workspace: string, inputs: ContextInputs): void {
  validateContext(workspace, inputs);
  // The grant file is a host-owned revocation record, not a source snapshot.
  const path = grantPath(workspace, inputs.grant.id);
  if (lstatSync(path).isSymbolicLink()) throw new Error("Unsafe approval path");
  writeFileSync(path, JSON.stringify({ inputs, revokedAt: new Date().toISOString() }), { mode: 0o600 });
}
export function readContextPage(workspace: string, inputs: ContextInputs, id: string, offset = 0) {
  validateContext(workspace, inputs);
  const snapshot = readContextSnapshot(workspace, inputs, id);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > snapshot.body.length) throw new Error("Invalid context offset");
  const end = Math.min(snapshot.body.length, offset + 8000);
  return { id, title: basename(snapshot.originalPath), url: `local://${id}`, origin: "local" as const, purpose: snapshot.purpose,
    words: snapshot.body.trim().split(/\s+/).length, retrievedAt: snapshot.capturedAt,
    offset, end, total: snapshot.body.length, hash: snapshot.contentHash, body: untrustedBody(snapshot.body.slice(offset, end), `Local ${snapshot.purpose}; not independent external corroboration`), nextOffset: end < snapshot.body.length ? end : null,
    extraction: { reader: "approved-utf8-snapshot", media: "text" as const, status: "text-extracted" as const, actualUrl: `local://${id}`, version: "unknown" as const, missingPages: [], warnings: ["layout-unverified", "tables-unverified", "figures-unverified", "equations-unverified"] } };
}

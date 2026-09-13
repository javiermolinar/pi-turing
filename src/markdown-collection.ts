import { realpathSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { registerScopedReader } from "./capabilities.ts";
import { contentHash, readSelectedText } from "./context.ts";
import type { RetrievedDocument } from "./capability-types.ts";

/** An optional, read-only adapter over an explicit existing text collection.
 * No scanning, index, managed-note writes, shell commands, embeddings or model
 * calls. A caller must register it in the trusted host and users must approve it. */
export function registerTextCollection(options: { id: string; title: string; root: string; files: string[] }): () => void {
  const root = realpathSync(options.root); const requested = resolve(options.root);
  const files = z.array(z.string().min(1).max(2048)).min(1).max(8).parse(options.files).map(file => isAbsolute(file) && file.startsWith(requested + sep) ? relative(requested, file) : file);
  if (new Set(files).size !== files.length) throw new Error("Duplicate collection paths");
  return registerScopedReader({
    descriptor: { id: options.id, title: options.title, version: "literal-text-v1", readOnly: true, visibility: "private",
      scope: { root, files: JSON.stringify(files) }, credentialRefs: [],
      definition: "Search only the explicitly listed text files by a literal, case-insensitive query. At most five matching complete documents are returned in file-list order; narrow queries for other matches. File changes create new hashed evidence versions. Do not treat this procedure, generated reports, or duplicate documents as independent evidence." },
    query: async (query, signal) => {
      const result: RetrievedDocument[] = []; let bytes = 0;
      for (const selected of files) {
        signal.throwIfAborted();
        const { path, body } = readSelectedText(root, selected);
        bytes += Buffer.byteLength(body); if (bytes > 500_000) throw new Error("Collection read exceeds 500KB limit");
        if (Buffer.byteLength(body) > 100_000) throw new Error("Collection document exceeds 100KB evidence limit; no silent truncation");
        if ((basename(path) + "\n" + body).toLowerCase().includes(query.toLowerCase()) && result.length < 5) {
          result.push({ uri: pathToFileURL(path).href, title: basename(path), version: contentHash(body), body, complete: true });
        }
      }
      return result;
    },
  });
}

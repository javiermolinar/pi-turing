import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { safePath, validateId } from "./paths.ts";

export interface ReportMatch { tag: string; line: number; excerpt: string }
export interface ReportSearchResult { matches: ReportMatch[]; scanned: number; partial: boolean; reason?: string }
/** Literal, local retrieval only. Callers supply the capability's allowed run IDs. */
export async function searchReports(root: string, allowedTags: readonly string[], query: string, options: {
  signal?: AbortSignal; maxResults?: number; maxBytes?: number; timeoutMs?: number;
} = {}): Promise<ReportSearchResult> {
  if (!query.trim() || query.length > 300 || /[\x00-\x1f\x7f]/.test(query)) throw new Error("Search needs 1–300 printable characters");
  const result: ReportSearchResult = { matches: [], scanned: 0, partial: false };
  const limit = Math.max(1, Math.min(100, options.maxResults ?? 40));
  const maxBytes = Math.max(1, Math.min(32_000_000, options.maxBytes ?? 16_000_000));
  const deadline = Date.now() + Math.max(1, Math.min(5000, options.timeoutMs ?? 2000));
  let bytes = 0;
  const partial = (reason: string) => { result.partial = true; result.reason ??= reason; };
  const needle = query.toLowerCase();
  if (allowedTags.length > 1000) partial("Run scan limit reached");
  for (const tag of [...new Set(allowedTags)].slice(0, 1000)) {
    options.signal?.throwIfAborted();
    validateId(tag);
    if (Date.now() >= deadline) { partial("Search time limit reached"); break; }
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const path = safePath(root, "runs", tag, "report.md");
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 1_000_000) { partial("Oversized or nonregular report skipped"); continue; }
      if (bytes + stat.size > maxBytes) { partial("Search byte limit reached"); break; }
      bytes += stat.size;
      const buffer = Buffer.alloc(stat.size);
      let read = 0;
      while (read < buffer.length) {
        options.signal?.throwIfAborted();
        if (Date.now() >= deadline) { partial("Search time limit reached"); return result; }
        const chunk = await file.read(buffer, read, buffer.length - read, read);
        if (!chunk.bytesRead) break;
        read += chunk.bytesRead;
      }
      const after = await file.stat();
      if (read !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) { partial("Report changed during search"); continue; }
      result.scanned++;
      const lines = buffer.toString("utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (i % 100 === 0) {
          options.signal?.throwIfAborted();
          if (Date.now() >= deadline) { partial("Search time limit reached"); return result; }
        }
        const position = lines[i].toLowerCase().indexOf(needle);
        if (position < 0) continue;
        const start = Math.max(0, position - 100);
        result.matches.push({ tag, line: i + 1, excerpt: `${start ? "…" : ""}${lines[i].slice(start, start + 350)}${lines[i].length > start + 350 ? "…" : ""}` });
        if (result.matches.length >= limit) { partial("Result limit reached"); return result; }
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      // Missing reports are normal for runs that have not drafted yet.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") partial("Unreadable report skipped");
    } finally { await file?.close(); }
  }
  return result;
}

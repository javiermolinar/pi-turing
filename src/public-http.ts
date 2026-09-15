import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent, fetch as request, type Dispatcher } from "undici";
import ipaddr from "ipaddr.js";
import { abortable } from "./http.ts";

export function publicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === "unicast"; } catch { return false; }
}
export function publicUrl(raw: string): URL {
  if (raw.length > 2048 || /[\x00-\x20\x7f]/.test(raw)) throw new Error("Invalid public source URL");
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      !host || /(?:^|\.)(?:localhost|local|internal|home|lan)\.?$/i.test(host) ||
      (isIP(host) && !publicAddress(host))) throw new Error("Only public HTTP(S) URLs without credentials are allowed");
  url.hash = "";
  return url;
}
/** Validate the addresses used by the socket itself, not a separate preflight DNS lookup. */
export function publicLookup(resolve = lookup): LookupFunction {
  return (hostname, options, callback) => {
    void resolve(hostname, { all: true, verbatim: true }).then(addresses => {
      if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error("Non-public source address refused");
      const family = typeof options === "number" ? options : options.family;
      const candidates = family ? addresses.filter(item => item.family === family) : addresses;
      if (!candidates.length) throw new Error("No usable public source address");
      if (typeof options === "object" && options.all) callback(null, candidates as any);
      else callback(null, candidates[0].address, candidates[0].family);
    }).catch(() => callback(new Error("Public source DNS lookup failed"), "", 4));
  };
}
export interface PublicResponse { url: string; bytes: Uint8Array; contentType: string }
export interface RequestOptions { signal?: AbortSignal; maxBytes?: number; headers?: Record<string, string>; redirects?: boolean }
export type PublicRequest = (url: string, options?: RequestOptions) => Promise<PublicResponse>;
export class HttpStatusError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`); }
}
/** No cookies, ambient auth, proxy credentials, scripts, or automatic login. */
export function createPublicRequest(dispatcherFactory: () => Dispatcher = () => new Agent({ connect: { lookup: publicLookup(), timeout: 15_000 } })): PublicRequest {
  return async (raw, options = {}) => {
  const signal = AbortSignal.any([AbortSignal.timeout(60_000), ...(options.signal ? [options.signal] : [])]);
  const maxBytes = options.maxBytes ?? 20_000_000;
  let url = publicUrl(raw);
  const dispatcher = dispatcherFactory();
  try {
    for (let hop = 0; hop <= 5; hop++) {
      signal.throwIfAborted();
      const response = await request(url, { dispatcher, signal, redirect: "manual", credentials: "omit",
        headers: { "User-Agent": "pi-hyperresearch/0.1", Accept: "text/html, application/pdf, text/plain, application/xml;q=0.8", ...options.headers } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        if (options.redirects === false || hop === 5) throw new Error("Source redirect refused");
        const location = response.headers.get("location");
        if (!location) throw new Error("Source redirect has no destination");
        // Metadata requests carrying credentials never follow redirects.
        url = publicUrl(new URL(location, url).href); continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new HttpStatusError(response.status); }
      if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new Error("Source exceeds byte limit"); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Source returned an empty body");
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        while (true) {
          const item = await abortable(reader.read(), signal);
          if (item.done) break;
          bytes += item.value.length;
          if (bytes > maxBytes) throw new Error("Source exceeds byte limit");
          chunks.push(item.value);
        }
      } catch (error) { void reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
      signal.throwIfAborted();
      return { url: url.href, bytes: Buffer.concat(chunks), contentType: response.headers.get("content-type") ?? "" };
    }
    throw new Error("Source redirect limit exceeded");
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof HttpStatusError || error instanceof Error && /^(Source |Only public|Invalid public)/.test(error.message)) throw error;
    // Network exceptions can contain URLs/credentials. Never persist them.
    throw new Error("Public source request failed");
  } finally { await dispatcher.destroy(); }
  };
}
export const fetchPublic = createPublicRequest();

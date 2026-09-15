import { DomUtils, parseDocument } from "htmlparser2";
import { z } from "zod";

interface SearchItem { url: string; title: string; snippet: string }
interface ApiSearchProvider {
  name: string;
  key: "BRAVE_SEARCH_API_KEY" | "TAVILY_API_KEY" | "SERPLY_API_KEY" | "KAGI_API_KEY";
  request(query: string, key: string): { url: URL; init: RequestInit };
  parse(input: unknown): SearchItem[];
}
const text = (html: string) => DomUtils.textContent(parseDocument(html));
const noError = z.union([z.null(), z.array(z.unknown()).length(0)]).optional();
const braveResponse = z.object({
  error: z.never().optional(), type: z.literal("search").optional(),
  query: z.object({ original: z.string() }).optional(),
  web: z.object({ results: z.array(z.object({ url: z.string(), title: z.string(), description: z.string().optional() })).optional() }).optional(),
}).refine(data => data.web !== undefined || data.query !== undefined, "Missing search response fields");
const tavilyResponse = z.object({
  error: noError, errors: noError, detail: z.never().optional(),
  results: z.array(z.object({ url: z.string(), title: z.string(), content: z.string().optional() })),
});
const serplyResponse = z.object({
  error: noError, errors: noError, detail: z.never().optional(),
  results: z.array(z.object({ link: z.string(), title: z.string(), description: z.string().optional(), result_type: z.string().optional() })),
});
const kagiResponse = z.object({
  error: noError, errors: noError,
  // Categories may be omitted when empty. Do not treat infoboxes or answers as
  // web sources, and do not accept the unrelated legacy v0 flat-array shape.
  data: z.record(z.string(), z.array(z.unknown())).and(z.object({
    search: z.array(z.object({ url: z.string(), title: z.string(), snippet: z.string().optional() })).optional(),
  })),
});
function post(url: string, key: string, payload: Record<string, unknown>) {
  return { url: new URL(url), init: { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) } };
}
/** Small protocol adapters over the shared bounded fetch/parser path, not SDKs.
 * Contracts: docs.tavily.com/documentation/api-reference/endpoint/search,
 * serply.io/docs/resources/google-search, kagi.com/api/docs/openapi/search/search.
 */
export const apiSearchProviders = {
  brave: {
    name: "Brave Search", key: "BRAVE_SEARCH_API_KEY",
    request(query, key) {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.search = new URLSearchParams({ q: query, count: "5" }).toString();
      return { url, init: { method: "GET", headers: { "X-Subscription-Token": key } } };
    },
    parse(input) { return (braveResponse.parse(input).web?.results ?? []).map(item => ({ url: item.url, title: text(item.title), snippet: text(item.description ?? "") })); },
  },
  tavily: {
    name: "Tavily", key: "TAVILY_API_KEY",
    request(query, key) {
      // Pin basic search (one credit per documented request). Do not let auto
      // parameters upgrade depth or request generated answers/full-page content.
      return post("https://api.tavily.com/search", key, { query, search_depth: "basic", topic: "general", max_results: 5,
        auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false });
    },
    parse(input) { return tavilyResponse.parse(input).results.map(item => ({ url: item.url, title: text(item.title), snippet: text(item.content ?? "") })); },
  },
  serply: {
    name: "Serply", key: "SERPLY_API_KEY",
    request(query, key) {
      // Serply embeds Google's encoded parameter string in the PATH, not the
      // URL's query. URLSearchParams prevents &, #, / and + from changing it.
      const parameters = new URLSearchParams({ q: query, num: "5" });
      return { url: new URL(`https://api.serply.io/v1/search/${parameters}`), init: { method: "GET", headers: { "X-Api-Key": key } } };
    },
    parse(input) { return serplyResponse.parse(input).results.filter(item => item.result_type === undefined || item.result_type === "organic")
      .map(item => ({ url: item.link, title: text(item.title), snippet: text(item.description ?? "") })); },
  },
  kagi: {
    name: "Kagi", key: "KAGI_API_KEY",
    request(query, key) { return post("https://kagi.com/api/v1/search", key, { query, workflow: "search", format: "json", limit: 5 }); },
    parse(input) { return (kagiResponse.parse(input).data.search ?? []).map(item => ({ url: item.url, title: text(item.title), snippet: text(item.snippet ?? "") })); },
  },
} satisfies Record<string, ApiSearchProvider>;
export type SearchEnvironment = Partial<Record<(typeof apiSearchProviders)[keyof typeof apiSearchProviders]["key"], string>>;

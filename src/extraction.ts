import { createHash } from "node:crypto";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { DomUtils, parseDocument } from "htmlparser2";
import { readPdf } from "./pdf-reader.ts";
import { normalizeDoi } from "./scholarly-providers.ts";
import { type Extraction, type pageSpanSchema } from "./evidence.ts";
import type { z } from "zod";
import type { PublicResponse } from "./public-http.ts";

export const textWarnings = ["layout-unverified", "tables-unverified", "figures-unverified", "equations-unverified"];
export const hashBytes = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export interface ExtractedSource {
  title: string; body: string; doi?: string; extraction: Extraction; pageSpans: z.infer<typeof pageSpanSchema>[];
}
export function detectedDoi(url: string, text = ""): string | undefined {
  try { const parsed = new URL(url); if (/^(?:dx\.)?doi\.org$/i.test(parsed.hostname)) return normalizeDoi(decodeURIComponent(parsed.pathname.slice(1))); } catch { /* use text */ }
  const match = (url + "\n" + text).match(/10\.\d{4,9}\/[\w.\-;()/:]+/i)?.[0].replace(/[.,;]+$/, "");
  return normalizeDoi(match);
}
export async function extractPdf(bytes: Uint8Array, url: string, signal?: AbortSignal): Promise<ExtractedSource> {
  const extraction: Extraction = { reader: "pdfjs-text-layer", media: "pdf", status: "text-extracted", actualUrl: url,
    version: "unknown", rawHash: hashBytes(bytes), missingPages: [], warnings: [...textWarnings] };
  const result: ExtractedSource = { title: "PDF source", body: "", extraction, pageSpans: [] };
  try {
    const parsed = await readPdf(bytes, signal);
    extraction.pages = parsed.pages.length;
    if (parsed.title?.trim()) result.title = parsed.title;
    let textPages = 0;
    for (const [index, text] of parsed.pages.entries()) {
      if (text.length < 40) { if (extraction.missingPages.length < 20) extraction.missingPages.push(index + 1); extraction.status = "incomplete"; }
      else textPages++;
      if (text) {
        if (result.body) result.body += "\n\n---\n\n";
        const start = result.body.length; result.body += text;
        result.pageSpans.push({ page: index + 1, start, end: result.body.length });
      }
    }
    extraction.textPages = textPages;
    if (extraction.status === "incomplete") extraction.warnings.push("Empty/sparse pages require OCR or visual review; none was performed");
    result.doi = detectedDoi(url, result.body.slice(0, 10_000));
  } catch {
    signal?.throwIfAborted();
    extraction.status = "unavailable";
    extraction.warnings.push("PDF is encrypted, corrupt, or exceeds extraction limits/deadline; no OCR/visual fallback was invoked");
    result.body = ""; result.pageSpans = [];
  }
  return result;
}

export async function extractSource(response: PublicResponse, signal?: AbortSignal): Promise<ExtractedSource> {
  signal?.throwIfAborted();
  if (Buffer.from(response.bytes.subarray(0, 1024)).includes(Buffer.from("%PDF-")) || /application\/pdf/i.test(response.contentType)) return extractPdf(response.bytes, response.url, signal);
  if (response.bytes.length > 5_000_000) throw new Error("Source HTML/text exceeds extraction limit");
  const charset = response.contentType.match(/charset=["']?([^\s;"']+)/i)?.[1] ?? "utf-8";
  let raw: string;
  try { raw = new TextDecoder(charset, { fatal: true }).decode(response.bytes); } catch { throw new Error("Source text encoding is unsupported or invalid"); }
  let title = new URL(response.url).hostname; let body = ""; let doi = detectedDoi(response.url);
  let media: Extraction["media"] = "html";
  if (/^text\/plain\b/i.test(response.contentType)) { body = raw.trim(); media = "text"; }
  else if (/xml/i.test(response.contentType) && /<article[\s>]/i.test(raw)) {
    // Europe PMC JATS: parse XML with htmlparser2; external entities are not resolved.
    const doc = parseDocument(raw, { xmlMode: true });
    const tags = (name: string) => DomUtils.getElementsByTagName(name, doc, true);
    title = DomUtils.textContent(tags("article-title")[0] ?? doc).slice(0, 1000);
    const main = tags("body")[0];
    if (!main) throw new Error("JATS source has no full-text body");
    const blocks = DomUtils.findAll(node => ["title", "p", "table", "disp-formula"].includes(node.name), [main]);
    body = blocks.map(node => DomUtils.textContent(node).trim()).filter(Boolean).join("\n\n");
    doi ??= normalizeDoi(tags("article-id").find(node => node.attribs["pub-id-type"] === "doi") && DomUtils.textContent(tags("article-id").find(node => node.attribs["pub-id-type"] === "doi")!));
  } else {
    if (!/html/i.test(response.contentType) && !/^\s*(?:<!doctype html|<html|<head)/i.test(raw)) throw new Error("Unsupported source media type");
    const { document } = parseHTML(raw);
    title = document.querySelector("title")?.textContent?.trim().slice(0, 1000) || title;
    doi ??= normalizeDoi(document.querySelector('meta[name="citation_doi"], meta[name="dc.identifier"]')?.getAttribute("content"));
    for (const element of document.querySelectorAll("script, style, noscript, template, form, nav, footer, header, [hidden], [aria-hidden='true']")) element.remove();
    const article = new Readability(document as unknown as Document, { charThreshold: 100, maxElemsToParse: 50_000 }).parse();
    if (!article?.textContent?.trim()) throw new Error("No readable article text; browser-only or blocked pages are unsupported");
    title = article.title?.trim().slice(0, 1000) || title;
    // Readability selects the article. Preserve paragraph boundaries without an
    // additional bespoke HTML extractor or executing any page scripts.
    const selected = parseDocument(article.content ?? "");
    body = DomUtils.innerText(selected.children).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (body.length > 2_000_000) throw new Error("Source extracted-text limit exceeded");
  if (body.length < 200) throw new Error("Source has too little readable text");
  if (/^(?:just a moment|access denied|sign in|log in|captcha|verify you are human|attention required)\b/i.test(title) ||
      body.length < 4000 && /verify (?:that )?you are human|enable javascript and cookies|checking your browser|complete the captcha/i.test(body)) throw new Error("Source is a login/bot wall; no bypass was attempted");
  return { title, body, doi: doi ?? detectedDoi(response.url, body.slice(0, 10_000)), pageSpans: [], extraction: {
    reader: media === "text" ? "utf8-text" : "readability-static-text", media, status: "text-extracted", actualUrl: response.url,
    version: "unknown", rawHash: hashBytes(response.bytes), missingPages: [], warnings: [...textWarnings],
  } };
}

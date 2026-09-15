import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdf, extractSource, hashBytes } from "../src/extraction.ts";
import { adequateExtraction } from "../src/evidence.ts";
import { SourceStore } from "../src/source-store.ts";
import { privateDirectory } from "../src/paths.ts";

export async function pdfFixture(kind: "text" | "scan" | "missing" | "columns" | "tables" | "equations" = "text") {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  const text = kind === "tables" ? "Year    Mean    Uncertainty\n2020    4.1     0.2\n2021    5.2     0.3\nTable layout requires review."
    : kind === "equations" ? "Conservation model: E = m c^2. Superscripts and symbols require visual review."
    : "Representative born-digital evidence from the preserved document. ";
  if (kind !== "scan") page.drawText(text, { x: 40, y: 700, size: 10, font, maxWidth: kind === "columns" ? 200 : 500 });
  if (kind === "columns") page.drawText(text, { x: 300, y: 700, size: 10, font, maxWidth: 200 });
  if (kind === "scan") page.drawRectangle({ x: 40, y: 40, width: 400, height: 600 });
  if (kind === "missing") doc.addPage().drawRectangle({ x: 40, y: 40, width: 400, height: 600 });
  return doc.save();
}

test("Readability selects static article text without executing scripts or retaining navigation", async () => {
  const body = "Measured source evidence explains the outcome in detail. ".repeat(60);
  const html = `<html><head><title>Research article</title><meta name="citation_doi" content="10.1234/paper"></head><body><nav>PRIVATE NAVIGATION</nav><article><h1>Research article</h1><p>${body}</p><p>${body}</p></article><script>throw new Error('EXECUTED')</script><footer>FOOTER NOISE</footer></body></html>`;
  const result = await extractSource({ url: "https://example.org/article", bytes: Buffer.from(html), contentType: "text/html" });
  assert.match(result.body, /Measured source evidence/); assert.ok(!/PRIVATE NAVIGATION|EXECUTED|FOOTER NOISE/.test(result.body));
  assert.equal(result.doi, "10.1234/paper"); assert.equal(result.extraction.status, "text-extracted");
  for (const requirement of ["layout", "tables", "figures", "equations"]) assert.equal(adequateExtraction(result.extraction, [requirement]), false);
});

test("blocked, sparse, binary and malformed text are not accepted as readable articles", async () => {
  for (const response of [
    { contentType: "text/html", bytes: Buffer.from("<html><head><title>Verify you are human</title></head><body><article>" + "Complete the captcha. ".repeat(50) + "</article></body></html>") },
    { contentType: "text/plain", bytes: Buffer.from("tiny") },
    { contentType: "application/octet-stream", bytes: Buffer.from([0, 1, 2, 3]) },
    { contentType: "text/plain; charset=utf-8", bytes: Buffer.from([0xff, 0xff]) },
  ]) await assert.rejects(extractSource({ url: "https://example.org/source", ...response }));
});

test("PDF.js pins preserved assets and physical page spans without claiming visual understanding", async () => {
  for (const kind of ["text", "columns", "tables", "equations"] as const) {
    const bytes = await pdfFixture(kind); const result = await extractPdf(bytes, "https://example.org/source.pdf");
    assert.equal(result.extraction.status, "text-extracted", JSON.stringify(result)); assert.equal(result.extraction.pages, 1);
    assert.equal(result.extraction.rawHash, hashBytes(bytes)); assert.equal(result.pageSpans[0].page, 1);
    assert.ok(result.body.slice(result.pageSpans[0].start, result.pageSpans[0].end).length >= 40);
    assert.equal(adequateExtraction(result.extraction, [kind === "text" || kind === "columns" ? "layout" : kind]), false);
  }
});

test("scanned, sparse, corrupt and cancelled PDFs never count as complete reads", async () => {
  for (const kind of ["scan", "missing"] as const) {
    const result = await extractPdf(await pdfFixture(kind), "https://example.org/source.pdf");
    assert.equal(result.extraction.status, "incomplete"); assert.deepEqual(result.extraction.missingPages, [kind === "scan" ? 1 : 2]);
    assert.equal(adequateExtraction(result.extraction), false); assert.ok(result.extraction.warnings.some(warning => warning.includes("OCR")));
  }
  const corrupt = await extractPdf(Buffer.from("%PDF-invalid"), "https://example.org/source.pdf");
  assert.equal(corrupt.extraction.status, "unavailable");
  const abort = new AbortController(); abort.abort();
  await assert.rejects(extractPdf(await pdfFixture(), "https://example.org/source.pdf", abort.signal));
  const midParse = new AbortController();
  const pending = extractPdf(await pdfFixture(), "https://example.org/source.pdf", midParse.signal);
  setTimeout(() => midParse.abort(), 5);
  await assert.rejects(pending);
  const oversized = await PDFDocument.create(); for (let i = 0; i < 301; i++) oversized.addPage();
  assert.equal((await extractPdf(await oversized.save(), "https://example.org/long.pdf")).extraction.status, "unavailable");
});

test("legacy PDF diagnostics never rewrite preserved bodies; incompatible text and missing assets fail closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-legacy-pdf-"));
  try {
    privateDirectory(join(root, "research", "notes")); privateDirectory(join(root, "research", "raw"));
    const bytes = await pdfFixture(); const parsed = await extractPdf(bytes, "https://repo.example/source.pdf");
    const asset = join(root, "research", "raw", "source.pdf"); writeFileSync(asset, bytes);
    const file = join(root, "research", "notes", "legacy-pdf.md");
    const header = "---\nid: legacy-pdf\ntitle: Legacy PDF\nsource: https://example.org/source.pdf\nraw_file: raw/source.pdf\noa_url: https://repo.example/source.pdf\noa_version: acceptedVersion\n---\n\n";
    writeFileSync(file, header + parsed.body);
    const store = new SourceStore(root); const before = readFileSync(file);
    const read = await store.page("legacy-pdf");
    assert.equal(read.hash, hashBytes(parsed.body)); assert.equal(read.extraction.status, "text-extracted");
    assert.equal(read.extraction.version, "accepted"); assert.equal(read.extraction.actualUrl, "https://repo.example/source.pdf");
    assert.equal(read.pageSpans[0].page, 1); assert.deepEqual(readFileSync(file), before);
    writeFileSync(file, header + "Changed text mapping");
    assert.equal((await store.page("legacy-pdf")).extraction.status, "incomplete");
    rmSync(asset);
    assert.equal((await store.page("legacy-pdf")).extraction.status, "unknown");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

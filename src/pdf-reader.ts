import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export interface PdfText { title?: string; pages: string[] }
const pdfRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
// PDF.js uses an in-process "fake worker" on Node. Place it in a Node worker so
// cancellation/deadlines can terminate CPU-bound parsing of hostile documents.
// The only reader is PDF.js; this shim implements no PDF parsing of its own.
const script = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const { getDocument } = await import(workerData.module);
  const task = getDocument({ data: workerData.bytes, useSystemFonts: false,
    disableFontFace: true, useWasm: false, stopAtErrors: true, verbosity: 0,
    cMapUrl: workerData.cMaps, cMapPacked: true, standardFontDataUrl: workerData.fonts });
  try {
    const doc = await task.promise;
    if (doc.numPages > 300) throw new Error("PDF page limit exceeded");
    const metadata = await doc.getMetadata().catch(() => undefined);
    const title = metadata && metadata.info && metadata.info.Title;
    const pages = []; let size = 0;
    for (let index = 1; index <= doc.numPages; index++) {
      const page = await doc.getPage(index);
      const content = await page.getTextContent();
      const text = content.items.flatMap(item => "str" in item ? [item.str + (item.hasEOL ? "\n" : " ")] : []).join("").trim();
      size += text.length;
      if (size > 2000000) throw new Error("PDF extracted-text limit exceeded");
      pages.push(text); page.cleanup();
    }
    parentPort.postMessage({ title: typeof title === "string" ? title.slice(0, 1000) : undefined, pages });
  } finally { await task.destroy().catch(() => {}); }
})().catch(() => parentPort.postMessage({ error: "PDF extraction failed" }));
`;
export async function readPdf(bytes: Uint8Array, signal?: AbortSignal): Promise<PdfText> {
  if (bytes.length > 20_000_000) throw new Error("PDF exceeds byte limit");
  signal?.throwIfAborted();
  const deadline = AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]);
  const data = Uint8Array.from(bytes);
  const worker = new Worker(script, { eval: true, execArgv: [],
    workerData: { bytes: data, module: pathToFileURL(join(pdfRoot, "legacy/build/pdf.mjs")).href,
      cMaps: join(pdfRoot, "cmaps") + "/", fonts: join(pdfRoot, "standard_fonts") + "/" },
    transferList: [data.buffer], resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
    stdout: true, stderr: true,
  });
  // Discard library diagnostics rather than letting source-derived messages into Pi.
  worker.stdout.resume(); worker.stderr.resume();
  let abort: () => void = () => {};
  try {
    return await new Promise<PdfText>((resolve, reject) => {
      abort = () => reject(deadline.reason ?? new Error("PDF extraction aborted"));
      deadline.addEventListener("abort", abort, { once: true });
      if (deadline.aborted) abort();
      worker.once("message", value => value.error ? reject(new Error("PDF extraction failed")) : resolve(value));
      worker.once("error", () => reject(new Error("PDF extraction worker failed")));
      worker.once("exit", () => reject(new Error("PDF extraction worker exited without a result")));
    });
  } finally { deadline.removeEventListener("abort", abort); await worker.terminate(); }
}

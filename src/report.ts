import { randomUUID } from "node:crypto";
import { Marked, type TokenizerExtension } from "marked";
import katex from "katex";
import sanitizeHtml from "sanitize-html";
import type { Source } from "./types.ts";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const slug = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/[\s-]+/g, "-") || "section";

function externalUrl(raw: string): string | undefined {
  try {
    if (/[\x00-\x1f\x7f]/.test(raw)) return;
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
    return url.href;
  } catch { return; }
}

function isEscaped(text: string, index: number): boolean {
  let count = 0;
  while (index > 0 && text[--index] === "\\") count++;
  return count % 2 === 1;
}

/** Recognize TeX before Markdown consumes backslash escapes. Never runs in code tokens. */
export function mathAt(source: string): { raw: string; text: string; display: boolean } | undefined {
  const delimiters = [["\\[", "\\]", true], ["$$", "$$", true], ["\\(", "\\)", false], ["$", "$", false]] as const;
  for (const [open, close, display] of delimiters) {
    if (!source.startsWith(open)) continue;
    if (open === "$" && (source.startsWith("$$") || /\s/.test(source[1] ?? ""))) return;
    let end = source.indexOf(close, open.length);
    while (end >= 0 && isEscaped(source, end)) end = source.indexOf(close, end + close.length);
    if (end < 0) return;
    const text = source.slice(open.length, end);
    if (!text.trim()) return;
    // Avoid interpreting common currency prose ($15 and $30) as TeX.
    if (open === "$" && (text.includes("\n") || /\s$/.test(text) || /[\d$]/.test(source[end + 1] ?? ""))) return;
    return { raw: source.slice(0, end + close.length), text, display };
  }
}

/** Render from the recorded source map; never guess URLs or rewrite the report file. */
export function renderReport(markdown: string, sources: Source[]): string {
  const sourceMap = new Map(sources.map((source, index) => [source.id, { ...source, number: index + 1 }]));
  const fragments = new Map<string, string>();
  const nonce = randomUUID();
  const stash = (html: string) => {
    const key = `report-${nonce}-${fragments.size}`;
    fragments.set(key, html);
    return `<span data-report-fragment="${key}"></span>`;
  };
  const renderMath = (raw: string, text: string, display: boolean) => {
    try {
      if (text.length > 10_000) throw new Error("Equation too large");
      // Native MathML needs no browser JavaScript, CDN, stylesheet or web fonts.
      // Only KaTeX-generated MathML is restored after normal Markdown sanitization.
      const math = katex.renderToString(text, {
        displayMode: display, output: "mathml", trust: false, throwOnError: true,
        strict: "error", maxExpand: 1000, maxSize: 20,
      });
      return stash(`<span class="${display ? "math-display" : "math-inline"}">${math}</span>`);
    } catch {
      return stash(`<span class="math-error" title="Equation could not be rendered; original TeX shown"><code>${escapeHtml(raw)}</code></span>`);
    }
  };
  const headingIds = new Set<string>();
  const resolveLink = (href: string): string | undefined => {
    if (href.startsWith("#")) {
      try {
        const id = decodeURIComponent(href.slice(1));
        const prefixed = `report-${slug(id)}`;
        if (headingIds.has(prefixed)) return `#${prefixed}`;
        if (headingIds.has(id)) return `#${id}`;
        return;
      } catch { return; }
    }
    const direct = externalUrl(href);
    if (direct) return direct;
    // Resolve only known vault-note links; unknown relative links must not become
    // requests against /<dashboard-token>/some-file (which would always 404).
    const match = /^(?:\.\/)?(?:(?:research\/)?notes\/)?([^/#]+)\.md(?:#(.*))?$/.exec(href);
    if (!match) return;
    try {
      const source = sourceMap.get(decodeURIComponent(match[1]));
      const url = source && externalUrl(source.url);
      if (!url) return;
      const parsed = new URL(url);
      if (match[2]) parsed.hash = match[2];
      return parsed.href;
    } catch { return; }
  };
  const mathInline: TokenizerExtension = {
    name: "reportMathInline", level: "inline",
    start: source => source.search(/\\[([]|\$/),
    tokenizer(source) {
      const match = mathAt(source);
      if (match) return { type: "reportMathInline", ...match };
    },
  };
  const mathBlock: TokenizerExtension = {
    name: "reportMathBlock", level: "block",
    start: source => { const match = /(?:^|\n) {0,3}(?:\\\[|\$\$)/.exec(source); return match ? match.index : undefined; },
    tokenizer(source) {
      const indent = /^ {0,3}/.exec(source)![0];
      const match = mathAt(source.slice(indent.length));
      if (!match?.display) return;
      const tail = source.slice(indent.length + match.raw.length);
      const ending = /^(?:[ \t]*(?:\n|$))/.exec(tail);
      if (!ending) return;
      return { type: "reportMathBlock", ...match, raw: indent + match.raw + ending[0] };
    },
  };
  const headings = new Map<string, number>();
  const parser = new Marked({
    extensions: [
      { ...mathBlock, renderer: token => renderMath(token.raw, token.text, token.display) + "\n" },
      { ...mathInline, renderer: token => renderMath(token.raw, token.text, token.display) },
      {
        name: "reportCitation", level: "inline", start: source => source.indexOf("[["),
        tokenizer(source) {
          const match = /^\[\[([^\]\n|#]+)(?:#([^\]\n|]+))?(?:\|([^\]\n]+))?\]\]/.exec(source);
          if (match) return { type: "reportCitation", raw: match[0], id: match[1].trim(), fragment: match[2], label: match[3] };
        },
        renderer(token) {
          const source = sourceMap.get(token.id);
          const href = source && externalUrl(source.url);
          if (source?.origin === "local") return `<span class="citation-local" title="Local evidence, not independent external corroboration; inspect the approved snapshot in Pi">${escapeHtml(token.label ?? `[Local ${source.number}]`)}</span>`;
          if (!source || !href) return `<span class="citation-missing" title="No usable URL for this citation">${escapeHtml(token.raw)}</span>`;
          const url = new URL(href);
          if (token.fragment) url.hash = token.fragment;
          const label = token.label ?? `[${source.number}]`;
          return `<a class="citation" href="${escapeHtml(url.href)}" title="${escapeHtml(source.title)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
        },
      },
    ],
    renderer: {
      heading(token) {
        const base = slug(token.text);
        const count = headings.get(base) ?? 0; headings.set(base, count + 1);
        const id = `report-${base}${count ? `-${count}` : ""}`;
        headingIds.add(id);
        return `<h${token.depth} id="${escapeHtml(id)}">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
      },
    },
  });
  let html = sanitizeHtml(parser.parse(markdown, { async: false }), {
    allowedTags: ["p", "br", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "del", "ul", "ol", "li", "blockquote", "pre", "code", "table", "thead", "tbody", "tr", "th", "td", "hr", "a", "span"],
    allowedAttributes: {
      a: ["href", "target", "rel", "title", "class"], span: ["class", "title", "data-report-fragment"],
      h1: ["id"], h2: ["id"], h3: ["id"], h4: ["id"], h5: ["id"], h6: ["id"],
    },
    allowedClasses: { a: ["citation"], span: ["citation-missing", "citation-local", "unresolved-link"] },
    allowedSchemes: ["http", "https"], allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attrs): sanitizeHtml.Tag => {
        const href = resolveLink(attrs.href ?? "");
        if (!href) return { tagName: "span", attribs: { class: "unresolved-link", title: "Unresolved or unsafe link; no destination guessed" } };
        return { tagName: "a", attribs: { ...attrs, href, ...(href.startsWith("#") ? { target: "", rel: "" } : { target: "_blank", rel: "noopener noreferrer" }) } };
      },
    },
  });
  // Restore only unpredictable markers generated in this render. Untrusted raw
  // MathML, HTML, event handlers, and scripts have already been removed.
  for (const [key, fragment] of fragments) html = html.replace(`<span data-report-fragment="${key}"></span>`, fragment);
  return html;
}

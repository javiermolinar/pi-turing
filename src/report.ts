import { randomUUID } from "node:crypto";
import { Marked, type Token, type Tokens } from "marked";
import { citationTokenizer, mathBlock, mathInline, reportSyntax, resolveSourceLink, sourceNoteReference } from "./markdown-syntax.ts";
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

/** Distinct saved sources referenced by prose. Reuse rendering's URL policy;
 * ambiguous external URLs, code, math, raw HTML and image alt text do not count. */
export function reportSourceIds(markdown: string, sources: Source[]): string[] {
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  const byUrl = new Map<string, Set<string>>();
  const canonical = (raw: string) => {
    const href = externalUrl(raw);
    if (!href) return;
    const url = new URL(href); url.hash = ""; return url.href;
  };
  for (const source of sources) {
    const url = canonical(source.url);
    if (!url) continue;
    const ids = byUrl.get(url) ?? new Set<string>(); ids.add(source.id); byUrl.set(url, ids);
  }
  const ids = new Set<string>();
  const visit = (tokens: Token[]) => {
    for (const token of tokens) {
      switch (token.type) {
        case "reportCitation": {
          const source = sourceMap.get(token.id);
          if (source && (externalUrl(source.url) || source.origin === "local" || (source.origin === "integration" && source.integration?.visibility === "private"))) ids.add(source.id);
          break;
        }
        case "link": {
          const target = (token as Tokens.Link).href;
          const href = resolveSourceLink(target, sourceMap, externalUrl);
          const note = sourceNoteReference(target);
          if (href && note && sourceMap.has(note.id)) ids.add(note.id);
          else {
            const url = href && canonical(href);
            const matches = url && byUrl.get(url);
            if (matches && matches.size === 1) ids.add([...matches][0]);
          }
          visit((token as Tokens.Link).tokens);
          break;
        }
        case "paragraph": case "heading": case "text": case "blockquote": case "strong": case "em": case "del":
          if ("tokens" in token && token.tokens) visit(token.tokens);
          break;
        case "list":
          for (const item of (token as Tokens.List).items) visit(item.tokens);
          break;
        case "table":
          for (const cell of [...(token as Tokens.Table).header, ...(token as Tokens.Table).rows.flat()]) visit(cell.tokens);
          break;
      }
    }
  };
  visit(new Marked({ extensions: reportSyntax }).lexer(markdown));
  return [...ids];
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
    return resolveSourceLink(href, sourceMap, externalUrl);
  };
  const headings = new Map<string, number>();
  const parser = new Marked({
    extensions: [
      { ...mathBlock, renderer: token => renderMath(token.raw, token.text, token.display) + "\n" },
      { ...mathInline, renderer: token => renderMath(token.raw, token.text, token.display) },
      {
        ...citationTokenizer,
        renderer(token) {
          const source = sourceMap.get(token.id);
          const href = source && externalUrl(source.url);
          if (source?.origin === "local" || (source?.origin === "integration" && source.integration?.visibility === "private")) return `<span class="citation-local" title="Local/private evidence, not independent external corroboration; inspect the approved snapshot in Pi">${escapeHtml(token.label ?? `[${source.origin === "local" ? "Local" : "Private"} ${source.number}]`)}</span>`;
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

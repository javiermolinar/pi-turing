import { Marked, type Token, type TokenizerExtension, type Tokens } from "marked";

function isEscaped(text: string, index: number): boolean {
  let count = 0;
  while (index > 0 && text[--index] === "\\") count++;
  return count % 2 === 1;
}

/** Recognize TeX before Markdown consumes backslash escapes. */
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
    if (open === "$" && (text.includes("\n") || /\s$/.test(text) || /[\d$]/.test(source[end + 1] ?? ""))) return;
    return { raw: source.slice(0, end + close.length), text, display };
  }
}
export const mathInline: TokenizerExtension = {
  name: "reportMathInline", level: "inline", start: source => source.search(/\\[([]|\$/),
  tokenizer(source) {
    const match = mathAt(source);
    if (match) return { type: "reportMathInline", ...match };
  },
};
export const mathBlock: TokenizerExtension = {
  name: "reportMathBlock", level: "block",
  start: source => { const match = /(?:^|\n) {0,3}(?:\\\[|\$\$)/.exec(source); return match?.index; },
  tokenizer(source) {
    const indent = /^ {0,3}/.exec(source)![0];
    const match = mathAt(source.slice(indent.length));
    if (!match?.display) return;
    const ending = /^[ \t]*(?:\n|$)/.exec(source.slice(indent.length + match.raw.length));
    if (ending) return { type: "reportMathBlock", ...match, raw: indent + match.raw + ending[0] };
  },
};
export const citationTokenizer: TokenizerExtension = {
  name: "reportCitation", level: "inline", start: source => source.indexOf("[["),
  tokenizer(source) {
    const match = /^\[\[([^\]\n|#]+)(?:#([^\]\n|]+))?(?:\|([^\]\n]+))?\]\]/.exec(source);
    if (match) return { type: "reportCitation", raw: match[0], id: match[1].trim(), fragment: match[2], label: match[3] };
  },
};
export const reportSyntax = [mathBlock, mathInline, citationTokenizer];
export interface Citation { id: string; raw: string; context: string }

/** Visit prose only: code, escaped text, math, raw HTML and image alt text are
 * not citations. Context is bounded within the containing Markdown block. */
export function citations(markdown: string): Citation[] {
  const parser = new Marked({ extensions: reportSyntax });
  const result: Citation[] = [];
  function visit(tokens: Token[], context = tokens.map(token => token.raw).join(""), from = 0): void {
    let cursor = from;
    for (const token of tokens) {
      const start = context.indexOf(token.raw, cursor);
      const position = start < 0 ? cursor : start;
      switch (token.type) {
        case "reportCitation":
          result.push({ id: token.id, raw: token.raw, context: context.slice(Math.max(0, position - 200), position + token.raw.length + 200) });
          break;
        case "strong": case "em": case "del": case "link":
          visit((token as Tokens.Strong).tokens, context, position);
          break;
        case "paragraph": case "heading": case "text": case "blockquote":
          if ("tokens" in token && token.tokens) visit(token.tokens, token.raw);
          break;
        case "list":
          for (const item of (token as Tokens.List).items) visit(item.tokens);
          break;
        case "table": {
          const table = token as Tokens.Table;
          for (const cell of [...table.header, ...table.rows.flat()]) visit(cell.tokens);
          break;
        }
      }
      cursor = position + token.raw.length;
    }
  }
  visit(parser.lexer(markdown));
  return result;
}
export function citationIds(markdown: string): string[] {
  return [...new Set(citations(markdown).map(citation => citation.id))];
}

export function sourceNoteReference(href: string): { id: string; fragment?: string } | undefined {
  const match = /^(?:\.\/)?(?:(?:research\/)?notes\/)?([^/#]+)\.md(?:#(.*))?$/.exec(href);
  if (!match) return;
  try { return { id: decodeURIComponent(match[1]), fragment: match[2] }; } catch { return; }
}

/** Resolve saved note references, never filesystem paths. Each output keeps its
 * own URL policy/escaping; acquisition uses a separate, stricter network policy. */
export function resolveSourceLink(href: string, sources: ReadonlyMap<string, { url: string }>, validate: (raw: string) => string | undefined): string | undefined {
  const direct = validate(href);
  if (direct) return direct;
  const note = sourceNoteReference(href);
  if (!note) return;
  try {
    const source = sources.get(note.id);
    const url = source && validate(source.url);
    if (!url) return;
    const parsed = new URL(url);
    if (note.fragment) parsed.hash = note.fragment;
    return validate(parsed.href);
  } catch { return; }
}

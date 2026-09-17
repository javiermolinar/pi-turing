import { Marked, type Token, type Tokens } from "marked";
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, linkSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { isReadOnlyRun, type RunState } from "./types.ts";
import { validateContextApproval } from "./context.ts";
import { reportSyntax, resolveSourceLink } from "./markdown-syntax.ts";
import { answerCoverage, assessmentDisclaimer, assessmentIsCurrent, requirementRating } from "./assessment.ts";

const mdText = (text: string) => text.replace(/[\x00-\x1f\x7f]/g, " ").replace(/[\\`*_[\]<>]/g, "\\$&");
export function publicUrl(raw: string): string | undefined {
  try {
    if (/[\x00-\x1f\x7f]/.test(raw)) return;
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
    return url.href.replace(/[<>\\]/g, char => encodeURIComponent(char));
  } catch { return; }
}
export function assertExportAllowed(state: RunState): void {
  if (state.inputs) {
    if (!state.location) throw new Error("Missing approved context workspace");
    validateContextApproval(state.location.workspacePath, state.inputs);
  }
  if (state.disclosure?.exportBlocked || (state.inputs && !state.inputs.grant.disclosure.export)) throw new Error("Export not approved for the private context used in this report. Review/reapprove that context in a new revision before exporting.");
}
export function exportAllowed(state: RunState): boolean {
  try { assertExportAllowed(state); return true; } catch { return false; }
}
/** Standard Markdown links, no wiki dependency, no source file reads or attachments. */
export function portableMarkdown(state: RunState): string {
  assertExportAllowed(state);
  if (state.report === undefined) throw new Error("No report has been drafted yet");
  const sources = new Map(state.sources.map((source, index) => [source.id, { ...source, number: index + 1 }]));
  let unresolved = 0;
  const link = (label: string, href?: string) => href ? `[${label}](<${href}>)` : `${label} (unresolved or nonportable link)`;
  const resolveLink = (href: string): string | undefined => {
    if (/^#[^\s<>]*$/.test(href)) return href;
    return resolveSourceLink(href, sources, publicUrl);
  };
  const parser = new Marked({ extensions: reportSyntax });
  const tokens = parser.lexer(state.report);
  function render(items: Token[]): string { return items.map(renderToken).join(""); }
  function renderToken(token: Token): string {
    const t = token as any;
    switch (token.type) {
      case "code": case "codespan": case "escape": case "reportMathInline": case "reportMathBlock": return token.raw;
      case "reportCitation": {
        const source = sources.get(t.id); const href = source && publicUrl(source.url);
        if (!href) { unresolved++; return source ? `\\[Local/nonportable evidence ${source.number}: not included\\]` : "\\[Unresolved citation\\]"; }
        const url = new URL(href); if (t.fragment) url.hash = t.fragment;
        return link(mdText(t.label ?? String(source!.number)), publicUrl(url.href));
      }
      case "html": return token.raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      case "image": return `\\[Image omitted: ${mdText(t.text || "image")}\\]`;
      case "def": return ""; // Resolved reference links are emitted inline.
      case "link": {
        const href = resolveLink(t.href); if (!href) unresolved++;
        return link(render(t.tokens), href);
      }
      case "heading": return `${"#".repeat(t.depth)} ${render(t.tokens)}\n\n`;
      case "paragraph": return render(t.tokens) + "\n\n";
      case "strong": return `**${render(t.tokens)}**`;
      case "em": return `*${render(t.tokens)}*`;
      case "del": return `~~${render(t.tokens)}~~`;
      case "br": return "  \n";
      case "hr": return "---\n\n";
      case "blockquote": return render(t.tokens).trimEnd().split("\n").map(line => `> ${line}`).join("\n") + "\n\n";
      case "list": return (t as Tokens.List).items.map((item, index) => {
        const prefix = t.ordered ? `${Number(t.start) + index}. ` : "- ";
        const text = (item.task ? `[${item.checked ? "x" : " "}] ` : "") + render(item.tokens).trimEnd();
        return text.split("\n").map((line, i) => (i ? " ".repeat(prefix.length) : prefix) + line).join("\n");
      }).join("\n") + "\n\n";
      case "table": {
        const table = t as Tokens.Table;
        const row = (cells: Tokens.TableCell[]) => `| ${cells.map(cell => render(cell.tokens)).join(" | ")} |\n`;
        return row(table.header) + `| ${table.align.map(align => align === "center" ? ":---:" : align === "right" ? "---:" : "---").join(" | ")} |\n` + table.rows.map(row).join("") + "\n";
      }
      case "text": return t.tokens ? render(t.tokens) : token.raw;
      case "space": return token.raw;
      default: throw new Error(`Unsupported Markdown token in portable export: ${token.type}`);
    }
  }
  const report = render(tokens).trim();
  const stale = state.reportStale ? "STALE DRAFT" : state.status !== "done" || state.checks.some(check => !check.ok) ? "UNVERIFIED DRAFT" : `Completed ${state.profile}-pipeline report`;
  const failed = state.checks.filter(check => !check.ok).map(check => mdText(check.name));
  const header = `> ${stale} · Run ${state.tag}\n> Verification: ${!isReadOnlyRun(state) ? state.assessmentVersion ? "structural/quote checks plus a separate bounded model assessment; no full citation audit." : "light-mode structural/quote checks only; no sentence-level claim-support audit." : "historical full/extended checks only; execution code has been removed and this version has not revalidated the report. Private review metadata is not bundled."}\n> Export is a copy, not proof of factual accuracy.${unresolved ? ` ${unresolved} unresolved/nonportable links or citations remain explicitly marked.` : ""}${failed.length ? ` Unresolved checks: ${failed.join(", ")}.` : ""}\n> No source bodies or local attachments are included. Review the report for sensitive content before sharing.\n\n`;
  const sourceList = state.sources.map((source, index) => {
    const url = publicUrl(source.url);
    if (!url) return `- [${index + 1}] Local/nonportable evidence — not included.`;
    return `- [${index + 1}] ${link(mdText(source.title), url)}. Retrieved: ${mdText(source.retrievedAt ?? "unknown")}. ${source.fullRead ? "Full-read coverage recorded" : "Not fully read"}.${source.contentHash ? ` Content hash: ${mdText(source.contentHash)}.` : ""}${source.oa ? " Open-access substitution recorded; consult preserved evidence for the acquired version." : ""}${source.extraction ? ` Extraction: ${mdText(source.extraction.status)}; version ${mdText(source.extraction.version)}. ${mdText(source.extraction.warnings.join("; "))}.` : ""}`;
  }).join("\n");
  return `${header}${report}${assessmentMarkdown(state)}\n\n## Recorded sources\n\n${sourceList || "No sources recorded."}\n`;
}

function assessmentMarkdown(state: RunState): string {
  if (isReadOnlyRun(state)) return "";
  const assessment = state.assessment;
  if (!assessment) return `\n\n## Final model assessment\n\nNot assessed${state.assessmentVersion ? " yet" : " — original workflow"}. ${assessmentDisclaimer}\n`;
  const result = assessment.result;
  const judgments = [["Constraint fit", result.constraintFit], ["Reasoning", result.reasoning], ["Evidence support (selected claims)", result.evidenceSupport]] as const;
  return `\n\n## Final model assessment\n\n${assessmentIsCurrent(state) ? "" : "STALE — the report, sources or instructions changed.\n\n"}${assessmentDisclaimer}\n\nAnswer coverage: **${answerCoverage(result)}**.\n\n${mdText(result.summary)}\n\n` +
    result.requirements.map(item => `- **${requirementRating(item.status)}/2 — ${mdText(item.question)}** (${item.importance}; ${item.status}). ${mdText(item.rationale)}`).join("\n") + "\n\n" +
    judgments.map(([label, item]) => `- **${label}: ${item.verdict}**. ${mdText(item.rationale)}`).join("\n") +
    (result.findings.length ? "\n\n### Remaining findings\n\n" + result.findings.map(item => `- **${item.category}**: ${mdText(item.rationale)} Suggested correction: ${mdText(item.suggestedFix)}`).join("\n") : "") +
    `\n\nSource-support checks: ${result.claims.length} selected claims.\n` + result.claims.map(item => `- **${item.verdict}**: ${mdText(item.passage)} — ${mdText(item.rationale)} Sources: ${item.sourceIds.map(id => { const source = state.sources.find(source => source.id === id); return source && publicUrl(source.url) ? mdText(source.title) : "Local/nonportable evidence — not included"; }).join("; ")}.`).join("\n") + "\n";
}

export interface SaveTarget { path: string; protectedRoot: string; existingHash?: string }
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
export function prepareSave(cwd: string, input: string, protectedRoot: string): SaveTarget {
  if (!input.trim() || /[\x00-\x1f\x7f]/.test(input)) throw new Error("Invalid output path");
  const expanded = input.startsWith("~/") ? join(homedir(), input.slice(2)) : input;
  let path = resolve(realpathSync(cwd), expanded);
  // Normalize the caller's macOS /var alias before rejecting user-created symlinks.
  if (isAbsolute(expanded) && (expanded === cwd || expanded.startsWith(cwd + sep))) path = resolve(realpathSync(cwd), relative(cwd, expanded));
  if (!/\.md$/i.test(path)) throw new Error("Choose a .md output file");
  const protectedPath = existsSync(protectedRoot) ? realpathSync(protectedRoot) : resolve(protectedRoot);
  const compare = (value: string) => process.platform === "win32" || process.platform === "darwin" ? value.toLowerCase() : value;
  if (compare(path) === compare(protectedPath) || compare(path).startsWith(compare(protectedPath) + sep)) throw new Error("Cannot save over managed research state");
  for (let part = path; ; part = dirname(part)) {
    if ([".git", ".pi", ".hyperresearch"].includes(part.split(sep).at(-1)!.toLowerCase()) || /^\.env(?:\.|$)/i.test(part.split(sep).at(-1)!)) throw new Error("Refusing protected output path");
    try { if (lstatSync(part).isSymbolicLink()) throw new Error(`Refusing symlink: ${part}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (dirname(part) === part) break;
  }
  if (!lstatSync(dirname(path)).isDirectory()) throw new Error("Output folder must exist");
  if (!existsSync(path)) return { path, protectedRoot };
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > 4_000_000) throw new Error("Refusing nonregular or oversized overwrite target");
  return { path, protectedRoot, existingHash: hash(path) };
}
/** Caller must approve overwrites using the exact prepared target. */
export function saveMarkdown(target: SaveTarget, markdown: string, overwriteApproved = false): void {
  if (target.existingHash && !overwriteApproved) throw new Error("Overwrite confirmation required");
  const current = prepareSave(dirname(target.path), target.path, target.protectedRoot);
  if (current.existingHash !== target.existingHash) throw new Error("Output changed since approval; save refused");
  const temp = join(dirname(target.path), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, markdown, { mode: 0o600, flag: "wx" });
    if (target.existingHash) renameSync(temp, target.path);
    else linkSync(temp, target.path); // Exclusive publication never replaces a racing writer.
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}

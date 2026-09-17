import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { escapeHtml, renderMain } from "../web/render.ts";
import type { RunState } from "./types.ts";
import { assessmentIsCurrent } from "./assessment.ts";
import { assertExportAllowed, exportAllowed, portableMarkdown, publicUrl } from "./export.ts";
export { escapeHtml, renderMain } from "../web/render.ts";
export const dashboardCss = readFileSync(new URL("../web/style.css", import.meta.url), "utf8");
export const dashboardScript = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");

export function renderShell(state?: RunState, live = false, runnerLive = false, controlToken?: string): string {
  if (!live) controlToken = undefined;
  if (!live && state) assertExportAllowed(state);
  const assessmentCurrent = !!state && assessmentIsCurrent(state);
  const markdown = !live && state?.report !== undefined ? portableMarkdown(state) : undefined;
  if (!live && state) state = { ...state, report: markdown, sources: state.sources.map(source => publicUrl(source.url) ? source : { ...source, title: "Local/nonportable evidence — not included", url: "", oa: undefined }) };
  const hash = createHash("sha256").update(dashboardScript).digest("base64");
  const csp = `default-src 'none'; script-src ${live ? "'self'" : `'sha256-${hash}'`}; style-src 'self' 'unsafe-inline'; connect-src ${live ? "'self'" : "'none'"}; img-src 'none'; base-uri 'none'; form-action 'none'`;
  const e = escapeHtml;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${e(csp)}"><meta name="referrer" content="no-referrer"><title>Turing${state ? ` · ${e(state.tag)}` : " · Investigations"}</title>${live ? '<link rel="stylesheet" href="style.css">' : `<style>${dashboardCss}</style>`}</head><body data-live="${live}" data-run="${e(state?.tag ?? "")}"${controlToken ? ` data-control-token="${e(controlToken)}"` : ""}><nav class="topbar" aria-label="Dashboard"><span class="brand"><b>◈</b> Turing</span><span id="connection" class="connection" role="status">${live ? "Connecting…" : "Offline snapshot"}</span><div class="controls">${live ? '<button id="inventory-button">Investigations</button>' : ""}<input id="source-filter" type="search" placeholder="Filter sources…" aria-label="Filter sources"><button id="refresh">Refresh</button><button id="export-markdown" ${state?.report === undefined || !exportAllowed(state) ? "disabled" : ""}>Export Markdown</button><button id="export-html" ${!live ? "hidden" : ""}>Export HTML</button>${controlToken ? '<button id="close-research">Close research UI</button>' : ""}</div></nav>
  ${controlToken ? `<dialog id="close-dialog" aria-labelledby="close-title"><h2 id="close-title">Close research UI</h2><p id="close-description"></p><div class="dialog-actions"><button data-close-mode="hide">Close UI</button><button data-close-mode="pause" hidden>Pause and close</button><button id="close-cancel">Cancel</button></div><p id="close-status" role="status"></p></dialog>` : ""}
  <section id="inventory" class="inventory" ${state ? "hidden" : ""}><h1>Saved investigations</h1><p id="scope" class="footnote"></p><label>Filter runs <input id="run-filter" type="search" placeholder="Title, question or project"></label><div id="run-list" aria-live="polite"></div><hr><label>Search reports <input id="report-search" type="search" maxlength="300" placeholder="Literal text in accessible reports"></label><button id="search-button">Search</button><button id="cancel-search" hidden>Cancel</button><p id="search-status" role="status"></p><div id="search-results"></div></section>
  <main id="main" ${state ? "" : "hidden"}>${state ? renderMain(state, live && runnerLive, undefined, undefined, assessmentCurrent) : ""}</main>${markdown !== undefined ? `<template id="markdown-data">${Buffer.from(markdown).toString("base64")}</template>` : ""}<script${live ? ' src="app.js"' : ""}>${live ? "" : dashboardScript}</script></body></html>`;
}
export function renderDashboard(state: RunState, live = false, runnerLive = live): string { return renderShell(state, live, runnerLive); }

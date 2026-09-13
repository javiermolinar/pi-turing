import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDocument } from "htmlparser2";
import { renderReport } from "../src/report.ts";
import { fixture } from "./fixtures.ts";

function elements(html: string, name: string): any[] {
  const result: any[] = [];
  const walk = (node: any) => { if (node.name === name) result.push(node); for (const child of node.children ?? []) walk(child); };
  walk(parseDocument(html)); return result;
}
const render = (markdown: string) => renderReport(markdown, fixture().sources);

test("wiki citations link to recorded source URLs, with aliases and fragments; missing citations stay explicit", () => {
  const html = render('Claim [[sqlite-wal]] [[postgres-concurrency#isolation|details]] [[missing-source]].');
  const links = elements(html, "a");
  assert.equal(links.length, 2);
  assert.equal(links[0].attribs.href, "https://www.sqlite.org/wal.html");
  assert.equal(links[0].attribs.title, "SQLite: Write-Ahead Logging");
  assert.equal(links[0].children[0].data, "[1]");
  assert.equal(links[1].attribs.href, "https://www.postgresql.org/docs/current/mvcc.html#isolation");
  assert.equal(links[1].children[0].data, "details");
  for (const link of links) {
    assert.equal(link.attribs.target, "_blank");
    assert.equal(link.attribs.rel, "noopener noreferrer");
  }
  assert.match(html, /class="citation-missing"/);
  assert.match(html, /\[\[missing-source\]\]/);
});

test("standard links, known vault notes, bare URLs, and local headings work without broken relative routes", () => {
  const html = render('## Current status\n\n[section](#current-status) [note](research/notes/sqlite-wal.md) [web](https://example.org/page?a=1&b=2) https://example.org/bare\n\n[missing](unknown.md) [relative](./absent) [bad](//evil.test)\n\n## Current status');
  const links = elements(html, "a");
  assert.deepEqual(links.map(a => a.attribs.href), ["#report-current-status", "https://www.sqlite.org/wal.html", "https://example.org/page?a=1&b=2", "https://example.org/bare"]);
  assert.deepEqual(elements(html, "h2").map(h => h.attribs.id), ["report-current-status", "report-current-status-1"]);
  assert.equal(links[0].attribs.target, undefined);
  assert.equal(elements(html, "span").filter(s => s.attribs.class === "unresolved-link").length, 3);
  const anchors = render('[status](#report-status) [missing](#absent)\n\n## Report status');
  assert.equal(elements(anchors, "a")[0].attribs.href, "#report-report-status");
  assert.equal(elements(anchors, "a").length, 1);
});

test("TeX display and inline delimiters render to offline native MathML before Markdown unescapes them", () => {
  const html = render(String.raw`The equations are

\[
\partial_t u+(u\cdot\nabla)u=-\nabla p+\nu\Delta u+f,
\qquad \nabla\cdot u=0.
\]

Here, \(u\), \(p\), and \(\nu>0\) are variables. Also $x^2$.

$$
\frac{1}{2}+\sqrt{x}
$$

- Inline math **\(a+b\)** in a list.
- Inline display $$y^2$$ works too.
`);
  const math = elements(html, "math");
  assert.equal(math.length, 8);
  assert.equal(math.filter(m => m.attribs.display === "block").length, 3);
  assert.equal(elements(html, "mfrac").length, 1);
  assert.equal(elements(html, "msqrt").length, 1);
  assert.match(html, /∂/);
  assert.match(html, /∇/);
  assert.doesNotMatch(html, /data-report-fragment|math-error|<script|<link|<img/);
});

test("code, escaped delimiters, currency, and literal brackets are not interpreted as citations or math", () => {
  const html = render([
    String.raw`Literal [x] and (u), prices $15 and $30, or $15–$30; escaped \$x\$.`,
    'Inline code: `[[sqlite-wal]] \\(u\\) $x$`',
    '```tex\n[[sqlite-wal]]\n\\[x\\]\n$x$\n```',
    '    \\[x\\]\n    [[sqlite-wal]]',
  ].join("\n\n"));
  assert.equal(elements(html, "a").length, 0);
  assert.equal(elements(html, "math").length, 0);
  assert.match(html, /prices \$15 and \$30/);
  assert.equal(elements(html, "pre").length, 2);
});

test("bad TeX remains visible and cannot execute HTML, fetch assets, or create trusted links", () => {
  const sources = fixture().sources;
  sources[0].url = "javascript:alert(1)";
  const html = renderReport(String.raw`[[sqlite-wal]] [[postgres-concurrency|<img src=x onerror=alert(1)>]]

<script>alert(1)</script><img src="https://evil.test/pixel" onerror="alert(1)">
<math><annotation-xml encoding="text/html"><img src=x onerror=alert(1)></annotation-xml></math>
<a href="javascript:alert(1)">bad</a> <a href="https://user:password@example.org">credentials</a>

\(\href{https://evil.test}{click}\)
\(\includegraphics{https://evil.test/pixel}\)
\(\text{<script>alert(1)</script>}\)
\(\notARealCommand{x}\)
\(\def\a{\a}\a\)
`, sources);
  assert.equal(elements(html, "a").length, 1);
  assert.equal(elements(html, "a")[0].attribs.href, sources[1].url);
  assert.doesNotMatch(html, /<(?:script|img|iframe|annotation-xml)\b|href="(?:javascript:|https:\/\/evil)|data-report-fragment/);
  assert.match(html, /class="math-error"/);
  assert.match(html, /\\notARealCommand/);
  assert.match(html, /&lt;img/);
});

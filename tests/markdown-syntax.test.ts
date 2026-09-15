import { test } from "node:test";
import assert from "node:assert/strict";
import { citations, citationIds } from "../src/markdown-syntax.ts";
import { renderReport } from "../src/report.ts";
import { portableMarkdown } from "../src/export.ts";
import { fixture } from "./fixtures.ts";

test("gates, HTML and Markdown recognize the same prose citation syntax", () => {
  const markdown = [
    "# Heading [[ sqlite-wal ]]",
    "",
    "Known **[[postgres-concurrency#isolation|details]]** and `[[ignored-code]]`.",
    "",
    "> Quote [[sqlite-wal]]",
    "",
    "- Item [[postgres-concurrency]]",
    "",
    "| Evidence |",
    "| --- |",
    "| [[sqlite-wal]] |",
    "",
    "```text\n[[ignored-fence]]\n```",
    "",
    "    [[ignored-indent]]",
    "",
    String.raw`Escaped: \[\[ignored-escape\]\]. Math: $[[ignored-math]]$.`,
    "",
    String.raw`![Alt \[\[ignored-image\]\]](https://example.org/image)`,
    "",
    "<div>\n[[ignored-html]]\n</div>",
  ].join("\n");
  assert.deepEqual(citationIds(markdown), ["sqlite-wal", "postgres-concurrency"]);
  assert.equal(citations(markdown).length, 5);
  const state = fixture(); state.report = markdown;
  const html = renderReport(markdown, state.sources);
  assert.equal((html.match(/class="citation"/g) ?? []).length, 5);
  assert.ok(!html.includes("citation-missing"));
  const exported = portableMarkdown(state);
  assert.ok(exported.includes("`[[ignored-code]]`"));
  assert.ok(exported.includes("[[ignored-fence]]"));
  assert.ok(!exported.includes("Unresolved citation"));
  assert.match(exported, /mvcc\.html#isolation/);
});

test("retraction context follows each prose occurrence, not an earlier code example", () => {
  const text = "`[[source]]` " + "padding ".repeat(60) + "retracted **[[source|study]]**.\n\n[[source]]";
  const result = citations(text);
  assert.equal(result.length, 2);
  assert.match(result[0].context, /retracted/);
  assert.ok(!result[1].context.includes("retracted"));
});

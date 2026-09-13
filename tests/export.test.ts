import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { portableMarkdown, prepareSave, saveMarkdown } from "../src/export.ts";
import { renderDashboard } from "../src/dashboard.ts";
import { fixture } from "./fixtures.ts";
import { privateDirectory } from "../src/paths.ts";

test("portable Markdown preserves math and code, resolves only known citations, and labels evidence/verification gaps", () => {
  const state = fixture(); state.status = "paused"; state.reportStale = true;
  state.sources.push({ id: "local", title: "Secret local attachment", url: "file:///private/key.txt", words: 10, fullRead: false });
  state.report = String.raw`# A report

Known [[sqlite-wal|primary source]] and [vault note](notes/postgres-concurrency.md). Missing [[invented]] and local [[local]].

Inline \(a < b\) and $x^2$.

\[
\frac{1}{2}+\sqrt{x}
\]

$$z^3$$

- List citation [[sqlite-wal]]
  with continued explanation.

> Quoted [[postgres-concurrency]].

| Evidence | Formula |
| --- | --- |
| [[sqlite-wal]] | $x$ |

Code: \`literal\` and ` + '`[[literal]]`' + String.raw`

` + '```ts\nconst citation = "[[literal]]";\n```\n' + String.raw`

<script>window.hacked=true</script>

[Bad](javascript:alert) ![remote](https://tracker.invalid/pixel)

[Reference][ref]

[ref]: https://example.org/reference
`;
  const output = portableMarkdown(state);
  assert.match(output, /STALE DRAFT/); assert.match(output, /no sentence-level claim-support audit/);
  assert.ok(output.includes(`[primary source](<${state.sources[0].url}>)`));
  assert.ok(output.includes(`[vault note](<${state.sources[1].url}>)`));
  for (const equation of [String.raw`\(a < b\)`, "$x^2$", String.raw`\frac{1}{2}+\sqrt{x}`, "$$z^3$$"]) assert.ok(output.includes(equation), equation);
  assert.ok(output.includes('`[[literal]]`')); assert.ok(output.includes('const citation = "[[literal]]";'));
  assert.ok(!output.includes("[[sqlite-wal]]")); assert.ok(!output.includes("[[invented]]")); assert.ok(!output.includes("file:///private")); assert.ok(!output.includes("Secret local attachment"));
  assert.ok(!output.includes("<script>")); assert.ok(!output.includes("](javascript:")); assert.ok(!output.includes("![remote]"));
  assert.match(output, /Local\/nonportable evidence/); assert.match(output, /Recorded sources/); assert.match(output, /Reference.*https:\/\/example.org\/reference/);
  assert.ok(state.report.includes("[[sqlite-wal]]")); // Export never mutates the source.
  const html = renderDashboard(state);
  assert.ok(!html.includes("file:///private/key.txt")); assert.match(html, /markdown-data/); assert.match(html, /Export Markdown/);
});

test("save is atomic, refuses unapproved or changed overwrites, rejects unsafe paths and preserves originals", () => {
  const cwd = mkdtempSync(join(tmpdir(), "hpr-save-"));
  try {
    const root = join(cwd, "managed"); privateDirectory(root);
    const path = join(cwd, "report with spaces.md");
    const target = prepareSave(cwd, path, root); saveMarkdown(target, "First report");
    assert.equal(readFileSync(path, "utf8"), "First report");
    assert.throws(() => saveMarkdown(target, "Racing writer"), /changed/);
    const overwrite = prepareSave(cwd, path, root);
    assert.throws(() => saveMarkdown(overwrite, "No approval"), /confirmation/);
    writeFileSync(path, "User edited copy");
    assert.throws(() => saveMarkdown(overwrite, "Stale approval", true), /changed/);
    assert.equal(readFileSync(path, "utf8"), "User edited copy");
    saveMarkdown(prepareSave(cwd, path, root), "Approved revision", true);
    assert.equal(readFileSync(path, "utf8"), "Approved revision");
    symlinkSync(path, join(cwd, "alias.md"));
    for (const unsafe of [join(cwd, "alias.md"), join(root, "report.md"), join(cwd, ".env.md"), join(cwd, ".pi", "report.md"), join(cwd, ".PI", "report.md"), join(cwd, "no-folder", "report.md"), "/dev/null", "bad\x00.md"]) assert.throws(() => prepareSave(cwd, unsafe, root));
    if (["darwin", "win32"].includes(process.platform)) assert.throws(() => prepareSave(cwd, join(cwd, "MANAGED", "report.md"), root), /managed research state/);
    const missing = prepareSave(cwd, join(cwd, "new.md"), root);
    symlinkSync(path, missing.path); assert.throws(() => saveMarkdown(missing, "Do not overwrite"), /symlink/);
    assert.equal(readFileSync(path, "utf8"), "Approved revision");
    assert.equal(existsSync(join(root, "report.md")), false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

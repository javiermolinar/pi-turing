import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { renderMain } from "../web/render.ts";
import { discoveryFixture, fixture } from "./fixtures.ts";

function panels(html: string) {
  return [...parseHTML(html).document.querySelectorAll("details")];
}

test("dashboard collapsibles have unique stable keys across shifting discovery windows and source reordering", () => {
  const state = fixture();
  state.discoveries = Array.from({ length: 5 }, () => discoveryFixture("Repeated query"));
  state.revision = { parentTag: "parent", report: "# Parent", sourceIds: [], instructions: ["Prefer primary sources"] };
  for (const source of state.sources) source.extraction = {
    reader: "fixture", media: "pdf", status: "incomplete", actualUrl: source.url,
    version: "unknown", missingPages: [2], warnings: ["Missing pages"],
  };
  const before = panels(renderMain(state));
  const keys = before.map(panel => panel.getAttribute("data-details-key"));
  assert.equal(keys.length, 25);
  assert.ok(keys.every(Boolean));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(before.every(panel => panel.hasAttribute("open") === panel.classList.contains("sidebar-panel")));
  state.discoveries.push(discoveryFixture("New query"));
  state.sources.reverse();
  state.failures.push({ ...state.failures[0], url: "https://example.org/new-failure" });
  const after = panels(renderMain(state)).map(panel => panel.getAttribute("data-details-key"));
  assert.ok(!after.includes("discovery-0"));
  assert.ok(after.includes("discovery-5"));
  for (const key of keys.filter(key => key !== "discovery-0")) assert.ok(after.includes(key));
});

test("scholarly panels render escaped saved result links without promoting them to evidence", () => {
  const state = fixture();
  const batch = discoveryFixture('Query <script>alert("query")</script>');
  batch.results[0].title = '<img src=x onerror="alert(1)">';
  state.discoveries = [batch];
  const html = renderMain(state);
  const document = parseHTML(html).document;
  const link = document.querySelector(".discovery-results a")!;
  assert.equal(link.textContent, batch.results[0].title);
  assert.equal(link.getAttribute("href"), batch.results[0].url);
  assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  assert.equal(document.querySelectorAll("img, script").length, 0);
  assert.match(html, /never full-read evidence or independent corroboration/);
  batch.results[0].url = "javascript:alert(1)"; // Defense in depth if called with unvalidated state.
  assert.equal(parseHTML(renderMain(state)).document.querySelectorAll(".discovery-results a").length, 0);
});

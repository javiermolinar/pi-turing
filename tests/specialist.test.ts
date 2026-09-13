import { test } from "node:test";
import assert from "node:assert/strict";
import { scholarlyAdapters } from "../src/scholarly-providers.ts";
import { ScholarlyDiscovery, consolidateWorks } from "../src/scholarly.ts";
const at = "2026-09-13T12:00:00Z";

test("CORE retains unknown repository versions; DOAB distinguishes editors, chapters and withdrawn records", () => {
  const core = scholarlyAdapters.core.parse({ results: [{ id: 123, title: "Repository thesis", documentType: "thesis", yearPublished: 2020,
    authors: [{ name: "Author" }, "Author"], downloadUrl: "https://repo.example/read.pdf", citationCount: 0 }] }, at).results[0];
  assert.equal(core.workType, "thesis"); assert.equal(core.version, "unknown"); assert.deepEqual(core.authors, ["Author"]);
  assert.equal(core.fullTextCandidates[0].version, "unknown"); assert.equal(core.citationCounts[0].count, 0);
  const book = { type: "item", handle: "20.500/123", name: "An edited collection", metadata: [
    { key: "dc.type", value: "chapter" }, { key: "dc.contributor.editor", value: "Editor" },
    { key: "dc.identifier.doi", value: "10.1234/chapter" }, { key: "dc.date.issued", value: "2022" },
    { key: "oapen.identifier.downloadUrl", value: "https://publisher.example/book" },
  ] };
  const parsed = scholarlyAdapters.doab.parse([book, { ...book, withdrawn: true }, { ...book, withdrawn: "true" }], at);
  assert.equal(parsed.results.length, 1); assert.equal(parsed.skipped, 2);
  assert.equal(parsed.results[0].workType, "book-chapter"); assert.deepEqual(parsed.results[0].authors, []);
  assert.equal(parsed.results[0].metadata?.editors, "Editor"); assert.equal(parsed.results[0].fullTextCandidates[0].format, "unknown");
  assert.equal(core.evidence, "discovery-only");
});

test("specialist records are trials, filings and series, not papers or full-read outcomes", () => {
  const trial = scholarlyAdapters.clinicaltrials.parse({ studies: [{ protocolSection: {
    identificationModule: { nctId: "NCT12345678", briefTitle: "Trial with unpublished outcomes" },
    statusModule: { overallStatus: "TERMINATED", studyFirstSubmitDate: "2023-01-01", startDateStruct: { date: "2023-02" } },
    sponsorCollaboratorsModule: { leadSponsor: { name: "Sponsor" } }, designModule: { phases: ["PHASE1"], enrollmentInfo: { count: 20 } },
  } }, { protocolSection: {} }] }, at);
  assert.equal(trial.skipped, 1); assert.equal(trial.results[0].workType, "trial");
  assert.equal(trial.results[0].date?.kind, "registration"); assert.equal(trial.results[0].metadata?.status, "TERMINATED");
  assert.deepEqual(trial.results[0].authors, []); assert.equal(trial.results[0].abstract, undefined);
  const filing = (accession: string, file: string) => ({ _id: `${accession}:${file}`, _source: { adsh: accession,
    ciks: ["0000123456"], display_names: ["Company"], form: "10-K", file_date: "2025-03-01" } });
  const filings = scholarlyAdapters.edgar.parse({ hits: { hits: [filing("0000123456-25-000001", "main.htm"),
    filing("0000123456-25-000001", "exhibit.htm"), filing("0000123456-25-000002", "../bad.htm")] } }, at);
  assert.equal(filings.results.length, 2); assert.equal(filings.results[0].workType, "filing");
  assert.match(filings.results[0].url, /\/123456\/000012345625000001\/main.htm$/);
  assert.match(filings.results[1].url, /0000123456-25-000002-index.htm$/);
  assert.equal(filings.results[0].date?.kind, "filing");
  const series = scholarlyAdapters.fred.parse({ seriess: [{ id: "CPIAUCSL", title: "CPI", units: "Index 1982-1984=100", frequency: "Monthly",
    seasonal_adjustment: "Seasonally Adjusted", observation_start: "1947-01-01", observation_end: "2025-01-01" }] }, at).results[0];
  assert.equal(series.workType, "series"); assert.equal(series.date?.kind, "observation");
  assert.equal(series.metadata?.units, "Index 1982-1984=100"); assert.equal(series.metadata?.frequency, "Monthly");
  assert.equal(series.evidence, "discovery-only"); assert.equal(series.abstract, undefined);
  assert.equal(consolidateWorks([series, ...filings.results, ...trial.results]).results.length, 4);
});

test("routing and unavailable credentials never enable a provider or fabricate empty success", async () => {
  let calls = 0;
  const service = new ScholarlyDiscovery({ env: {}, fetchImpl: async () => { calls++; throw new Error("must not fetch"); } });
  for (const [provider, kind, required] of [["core", "literature", "CORE_API_KEY"], ["edgar", "filing", "CONTACT_EMAIL"], ["fred", "series", "FRED_API_KEY"]] as const) {
    const result = await service.search("question", [provider], undefined, kind);
    assert.equal(result.coverage[0].status, "unavailable"); assert.match(result.coverage[0].error!, new RegExp(required));
  }
  const skipped = await service.search("question", ["clinicaltrials", "edgar", "fred"], undefined, "book");
  assert.ok(skipped.coverage.every(item => item.status === "not-selected")); assert.equal(calls, 0);
});

test("credentials are scoped to fixed endpoints, redacted from failures, and revocation invalidates cache access", async () => {
  const env = { CORE_API_KEY: "core-secret", FRED_API_KEY: "fred-secret", HYPERRESEARCH_CONTACT_EMAIL: "contact@example.org" };
  const visited: string[] = [];
  const service = new ScholarlyDiscovery({ env, minIntervalMs: 0, fetchImpl: async (input, init) => {
    const url = new URL(String(input)); visited.push(url.hostname); const headers = new Headers(init?.headers);
    assert.equal(init?.credentials, "omit"); assert.equal(init?.redirect, "error");
    if (url.hostname === "api.core.ac.uk") {
      assert.equal(headers.get("authorization"), "Bearer core-secret"); assert.ok(!url.href.includes("secret")); return Response.json({ results: [] });
    }
    assert.equal(headers.has("authorization"), false);
    if (url.hostname === "efts.sec.gov") { assert.match(headers.get("user-agent")!, /mailto:contact@example.org/); return Response.json({ hits: { hits: [] } }); }
    assert.equal(url.hostname, "api.stlouisfed.org"); assert.equal(url.searchParams.get("api_key"), "fred-secret");
    throw new Error(`Request leaked ${url.href}`);
  } });
  await service.search("one", ["core"]); env.CORE_API_KEY = "";
  assert.equal((await service.search("one", ["core"])).coverage[0].status, "unavailable");
  await service.search("two", ["edgar"], undefined, "filing");
  const failed = await service.search("three", ["fred"], undefined, "series");
  assert.equal(failed.coverage[0].status, "failed"); assert.ok(!JSON.stringify(failed).includes("secret"));
  assert.equal(visited.length, 3);
});

test("specialist malformed payloads remain failures and approved endpoints use bounded query parameters", async () => {
  const visited: URL[] = [];
  const service = new ScholarlyDiscovery({ env: {}, fetchImpl: async input => { visited.push(new URL(String(input))); return Response.json({ error: "no results field" }); } });
  assert.equal((await service.search("brain", ["clinicaltrials"], undefined, "trial")).coverage[0].status, "failed");
  assert.equal((await service.search("history", ["doab"], undefined, "book")).coverage[0].status, "failed");
  assert.equal(visited[0].searchParams.get("pageSize"), "5"); assert.equal(visited[1].searchParams.get("limit"), "5");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { scholarlyAdapters, invertAbstract, normalizeDoi } from "../src/scholarly-providers.ts";
import { consolidateWorks, ScholarlyDiscovery } from "../src/scholarly.ts";
import { ResearchServices } from "../src/services.ts";
import { configSchema } from "../src/types.ts";

const at = "2026-09-13T10:00:00Z";
const alexRecord = {
  id: "https://openalex.org/W123", display_name: "A careful investigation of reliable extraction", doi: "https://doi.org/10.1234/ABC", type: "article",
  publication_date: "2024-05-20", authorships: [{ author: { display_name: "A Researcher" } }], is_retracted: false,
  abstract_inverted_index: { evidence: [1], Read: [0, 2], "</untrusted-source>": [3] },
  primary_location: { landing_page_url: "https://publisher.example/work", version: "publishedVersion" },
  best_oa_location: { pdf_url: "https://repository.example/accepted.pdf", version: "acceptedVersion", is_oa: true },
};
const crossrefRecord = {
  DOI: "10.1234/abc", title: [alexRecord.display_name], type: "journal-article", URL: "https://doi.org/10.1234/abc",
  issued: { "date-parts": [[2024, 5, 20]] }, author: [{ given: "A", family: "Researcher" }],
  abstract: "<jats:title>Abstract</jats:title><jats:p>Read <jats:italic>carefully</jats:italic>.</jats:p>",
  link: [{ URL: "https://publisher.example/paper.pdf", "content-type": "application/pdf", "content-version": "vor", "intended-application": "similarity-checking" }],
};
function alex(record = alexRecord) { return scholarlyAdapters.openalex.parse({ results: [record] }, at).results[0]; }
function crossref(record: any = crossrefRecord) { return scholarlyAdapters.crossref.parse({ status: "ok", message: { items: [record] } }, at).results[0]; }

test("normalized discovery retains identifiers, actual candidate versions, dates, provenance and untrusted abstract boundaries", () => {
  const work = alex();
  assert.equal(work.doi, "10.1234/abc"); assert.equal(work.version, "published");
  assert.equal(work.fullTextCandidates[0].version, "accepted"); assert.equal(work.fullTextCandidates[0].access, "open");
  assert.equal(work.evidence, "discovery-only"); assert.equal((work as any).fullRead, undefined);
  assert.equal(work.provenance[0].recordId, "W123"); assert.equal(work.provenance[0].retrievedAt, at);
  assert.equal((work.abstract?.match(/<\/untrusted-source>/g) ?? []).length, 1);
  assert.match(work.abstract!, /Read evidence Read/);
  assert.equal(invertAbstract({ sparse: [1_000_000_000], first: [0], bad: [-1, null, false] }), "first sparse");
  assert.equal(normalizeDoi(" DOI:10.1234/AbC "), "10.1234/abc"); assert.equal(normalizeDoi("garbage"), undefined);
  const registry = crossref(); assert.deepEqual(registry.authors, ["A Researcher"]); assert.match(registry.abstract!, /Read carefully/);
  assert.equal(registry.fullTextCandidates[0].access, "unknown"); // PDF metadata is not open-access proof.
  const fallback = crossref({ ...crossrefRecord, issued: {}, created: { "date-time": "2023-01-02T00:00:00Z" } });
  assert.equal(fallback.date?.kind, "registration");
  assert.equal(scholarlyAdapters.crossref.parse({ message: { items: [{ title: [] }, crossrefRecord] } }, at).skipped, 1);
  assert.throws(() => scholarlyAdapters.openalex.parse({ unexpected: [] }, at));
});

test("stable IDs deduplicate metadata without merging versions, notices or uncertain bibliographic matches", () => {
  const merged = consolidateWorks([alex(), crossref()]); assert.equal(merged.results.length, 1); assert.equal(merged.results[0].provenance.length, 2);
  assert.equal(merged.results[0].fullTextCandidates.length, 3);
  const preprint = alex({ ...alexRecord, type: "preprint" });
  const versions = consolidateWorks([preprint, crossref()]); assert.equal(versions.results.length, 2); assert.equal(versions.uncertainMatches.length, 1);
  const retraction = crossref({ ...crossrefRecord, DOI: "10.1234/notice", "update-to": [{ DOI: "10.1234/abc", type: "retraction" }] });
  assert.equal(retraction.workType, "retraction-notice"); assert.equal(retraction.retracted, null);
  assert.equal(retraction.relations[0].doi, "10.1234/abc");
  const corrected = crossref({ ...crossrefRecord, "update-to": [{ DOI: "10.1234/original", type: "correction" }] });
  assert.equal(consolidateWorks([alex(), corrected]).results.length, 2);
  const retracted = alex({ ...alexRecord, is_retracted: true }); assert.equal(consolidateWorks([crossref(), retracted]).results[0].retracted, true);
  const withoutDoi = { ...alex(), doi: undefined, identifiers: [{ scheme: "openalex", value: "W123" }] };
  const uncertain = consolidateWorks([withoutDoi, { ...crossref(), doi: undefined, identifiers: [{ scheme: "crossref", value: "other" }] }]);
  assert.equal(uncertain.results.length, 2); assert.equal(uncertain.uncertainMatches.length, 1);
});

test("work types remain distinct and version relationships do not become extra independent sources", () => {
  for (const [raw, expected] of [["book", "book"], ["book-section", "book-chapter"], ["dissertation", "thesis"], ["dataset", "dataset"], ["unrecognized", "other"]]) {
    assert.equal(crossref({ ...crossrefRecord, type: raw }).workType, expected);
  }
  const preprint = crossref({ ...crossrefRecord, type: "posted-content", relation: { "is-preprint-of": [{ id: "10.1234/published", "id-type": "doi" }] } });
  assert.equal(preprint.version, "submitted"); assert.equal(preprint.relations[0].type, "is-preprint-of");
});

test("service uses approved fixed endpoints only, caches privately and distinguishes partial failure from true empty results", async () => {
  let calls = 0;
  const service = new ScholarlyDiscovery({ env: {}, minIntervalMs: 0, fetchImpl: async (input, init) => {
    calls++; const url = new URL(String(input));
    assert.equal(init?.credentials, "omit"); assert.equal(init?.redirect, "error");
    assert.equal(url.searchParams.has("sort"), false);
    if (url.hostname === "api.openalex.org") { assert.equal(url.searchParams.get("per-page"), "5"); return Response.json({ results: [alexRecord] }); }
    assert.equal(url.hostname, "api.crossref.org"); assert.equal(url.searchParams.get("rows"), "5");
    return new Response("must not leak a response secret", { status: 429, headers: { "retry-after": "60" } });
  } });
  const result = await service.search("research question");
  assert.equal(calls, 2); assert.equal(result.results.length, 1);
  assert.equal(result.coverage[1].status, "failed"); assert.equal(result.coverage[1].error, "HTTP 429");
  assert.ok(!JSON.stringify(result).includes("secret"));
  const cached = await service.search("research question", ["openalex"]); assert.equal(calls, 2); assert.equal(cached.coverage[0].cached, true);
  const empty = new ScholarlyDiscovery({ env: {}, fetchImpl: async () => Response.json({ results: [] }) });
  assert.equal((await empty.search("empty", ["openalex"])).coverage[0].status, "ok");
  const malformed = new ScholarlyDiscovery({ env: {}, fetchImpl: async () => Response.json({ error: "secret" }) });
  assert.equal((await malformed.search("bad", ["openalex"])).coverage[0].status, "failed");
  await assert.rejects(service.search("no providers", []), /approved/);
  assert.throws(() => configSchema.parse({ scholarlyProviders: ["core"] })); // Not enabled in this slice.
});

test("deadlines, courtesy pacing, body limits, cancellation and output caps are enforced", async () => {
  const times: number[] = [];
  const service = new ScholarlyDiscovery({ env: {}, minIntervalMs: 30, fetchImpl: async () => { times.push(Date.now()); return Response.json({ results: [alexRecord] }); } });
  await Promise.all([service.search("one", ["openalex"]), service.search("two", ["openalex"])]);
  assert.ok(times[1] - times[0] >= 25);
  const slow = new ScholarlyDiscovery({ env: {}, timeoutMs: 5, fetchImpl: async () => { await delay(30); return Response.json({ results: [] }); } });
  assert.match((await slow.search("slow", ["openalex"])).coverage[0].error!, /deadline/);
  const huge = new ScholarlyDiscovery({ env: {}, fetchImpl: async () => new Response("x".repeat(2_000_001)) });
  assert.match((await huge.search("large", ["openalex"])).coverage[0].error!, /2MB/);
  await assert.rejects(service.search("cancel", ["openalex"], AbortSignal.abort()));
  const malformed = new ScholarlyDiscovery({ env: {}, fetchImpl: async () => Response.json({ results: [{ title: null }, ...Array.from({ length: 10 }, () => alexRecord)] }) });
  assert.equal((await malformed.search("partial", ["openalex"])).coverage[0].status, "partial");
});

test("output truncation and rate-limit backoff remain explicit rather than fabricating empty success", async () => {
  const verbose = new ScholarlyDiscovery({ env: {}, fetchImpl: async () => Response.json({ results: Array.from({ length: 5 }, (_, index) => ({
    ...alexRecord, id: `https://openalex.org/W${index}`, doi: `10.1234/paper-${index}`, authorships: Array.from({ length: 20 }, () => ({ author: { display_name: "Long author ".repeat(20) } })),
    locations: Array.from({ length: 3 }, (_, location) => ({ landing_page_url: `https://example.org/${index}/${location}/` + "x".repeat(1800), pdf_url: `https://pdf.example.org/${index}/${location}/` + "x".repeat(1800) })),
  })) }) });
  const result = await verbose.search("large normalized output", ["openalex"]);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 45_000); assert.equal(result.coverage[0].status, "partial"); assert.match(result.coverage[0].error!, /Output budget/);
  let requests = 0;
  const limited = new ScholarlyDiscovery({ env: {}, timeoutMs: 20, fetchImpl: async () => { requests++; return new Response(null, { status: 429, headers: { "retry-after": "60" } }); } });
  await limited.search("first", ["crossref"]);
  const blocked = await limited.search("second", ["crossref"]); assert.equal(requests, 1); assert.match(blocked.coverage[0].error!, /deadline/);
});

test("composed discovery never invokes Python or a storage operation", async () => {
  let storageCalls = 0;
  const service = new ResearchServices({ async call<T>() { storageCalls++; throw new Error("Storage must not handle discovery"); } },
    new ScholarlyDiscovery({ env: {}, fetchImpl: async () => Response.json({ results: [alexRecord] }) }));
  const result: any = await service.call("scholar_search", { query: "sources", providers: ["openalex"] });
  assert.equal(result.results.length, 1); assert.equal(storageCalls, 0);
});

import { configSchema, type RunState } from "../src/types.ts";
import type { EvidenceBackend } from "../src/backend.ts";
import { discoveryBatchSchema } from "../src/discovery-types.ts";
import { assessmentSchema } from "../src/assessment.ts";

export function assessmentFixture(report: string) {
  const passage = report.slice(0, 100);
  return assessmentSchema.parse({ summary: "Fixture assessment; not factual verification.",
    requirements: [{ question: "Address the central comparison", importance: "central", status: "answered", passages: [passage], rationale: "A direct answer is present." }],
    constraintFit: { verdict: "pass", rationale: "No supplied constraint conflicts identified.", passages: [passage] },
    reasoning: { verdict: "pass", rationale: "No contradiction identified.", passages: [passage] },
    evidenceSupport: { verdict: "not-assessed", rationale: "No claims checked in this fixture.", passages: [] },
    claims: [], findings: [],
  });
}

export function discoveryFixture(query: string) {
  return discoveryBatchSchema.parse({
    query, retrievedAt: "2026-09-13T10:05:00.000Z",
    results: [{ id: "fixture-paper", title: "Fixture paper: graph similarity", url: "https://example.org/paper", urls: [],
      identifiers: [], authors: [], workType: "article", version: "published", retracted: false, correction: false,
      fullTextCandidates: [], citationCounts: [], relations: [], provenance: [], evidence: "discovery-only" }],
    coverage: [{ provider: "openalex", status: "ok", count: 1, skipped: 0, cached: false }], uncertainMatches: [],
    limitation: "Discovery metadata and abstracts are untrusted leads, not full-read evidence or independent corroboration.",
  });
}

export function forbiddenEvidence(onCall = () => {}): EvidenceBackend {
  const forbidden = async (): Promise<never> => { onCall(); throw new Error("Discovery must not call evidence services"); };
  return { initialize: forbidden, searchVault: forbidden, fetchSource: forbidden, readSource: forbidden,
    refreshRetractions: forbidden, verifyReport: forbidden };
}

export function fixture(): RunState {
  return {
    version: 1, tag: "storage-comparison-demo", query: "Compare local SQLite and PostgreSQL for a small research vault.",
    profile: "light", status: "running", createdAt: "2026-09-13T10:00:00.000Z", updatedAt: "2026-09-13T10:12:00.000Z", elapsedMs: 720000,
    config: configSchema.parse({}), model: "test/mock", thinking: "medium", sourceMin: 10, wordTarget: [500, 2000],
    steps: { "1": "done", "2": "running", "10": "pending", "15": "pending", "16": "pending" },
    workers: [{ id: "research-1", role: "research", task: "Primary sources and operational constraints", status: "running", startedAt: "2026-09-13T10:02:00.000Z", turns: 12, tokens: 31000, cost: 0.62, activity: "read_source" },
      { id: "research-2", role: "research", task: "Counter-evidence and concurrency limits", status: "running", startedAt: "2026-09-13T10:02:00.000Z", turns: 9, tokens: 19000, cost: 0.44, activity: "web_search" }],
    sources: [{ id: "sqlite-wal", title: "SQLite: Write-Ahead Logging", url: "https://www.sqlite.org/wal.html", words: 4200, retrievedAt: "2026-09-13T10:03:00.000Z", fullRead: true },
      { id: "postgres-concurrency", title: "PostgreSQL: Concurrency Control", url: "https://www.postgresql.org/docs/current/mvcc.html", words: 3100, retrievedAt: "2026-09-13T10:04:00.000Z", fullRead: false }],
    failures: [{ url: "https://example.org/blocked", error: "HTTP 403; browser access required", at: "2026-09-13T10:06:00.000Z" }],
    cost: 1.06, tokens: 50000, pricingKnown: true, research: [], patches: {}, checks: [], feedback: [],
    decomposition: { title: "SQLite or PostgreSQL for a research vault?", questions: ["What concurrency does this workload need?"], required_section_headings: ["## Recommendation"], searches: [{ query: "SQLite WAL limits", angle: "primary" }, { query: "PostgreSQL operational overhead", angle: "context" }, { query: "SQLite concurrent writers limitations", angle: "adversarial" }] },
  };
}

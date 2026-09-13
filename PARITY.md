# Research parity tracker

Target: [jordan-gibbs/hyperresearch](https://github.com/jordan-gibbs/hyperresearch),
0.11.1, commit `75b1ecfb2891184fad2cc1a2ddf9abe476f5b54c`.

This is a capability inventory, not a claim of behavioral or benchmark parity.
Tests listed below are offline fixtures unless stated otherwise. No comparative
model-driven research or public-provider smoke tests have been run in this
implementation session. Add evidence before changing a row to verified parity.

| Research contract | Current implementation | Evidence / remaining work |
| --- | --- | --- |
| Decomposition, width sweep, single draft | Implemented in TypeScript, light scope only | `tests/runner.test.ts`; comparative outcome evaluation pending |
| Bounded polish/readability | Implemented in TypeScript | Patch, cost, pause/resume and steering fixtures; not a full critic suite |
| Budgets and scoped worker tools | Implemented in TypeScript/Pi SDK | `tests/runner.test.ts`, `tests/worker.test.ts`; no inherited shell/project tools |
| Saved runs, revisions, steering | Implemented in TypeScript | Recovery, lineage, prompt isolation and saved-config approval fixtures |
| Web discovery | Brave/DuckDuckGo TypeScript adapters | `tests/search.test.ts`; explicitly selected provider, no fallback; other upstream web providers intentionally not enabled |
| OpenAlex/Crossref discovery | Normalized TypeScript adapters | `tests/scholarly.test.ts`; DOI/version/type/notice distinctions, provider provenance, failures, bounded bodies, cancellation, cache and courtesy pacing; public-network validation pending |
| Scholarly ranking/deduplication | Provider relevance order, stable-ID deduplication, uncertain bibliographic matches retained | Never rank by citation count alone or count duplicate provider records as independent evidence; explicit evidence-kind routing within approved services; advanced filters pending |
| CORE/DOAB discovery | Normalized TypeScript adapters, opt-in | `tests/specialist.test.ts`; repository version uncertainty, chapters/editors, withdrawn records, credential revocation; live checks pending |
| ClinicalTrials.gov / EDGAR / FRED | Normalized TypeScript adapters, opt-in | `tests/specialist.test.ts`; trials/filings/series retain distinct semantics, filing exhibits deduplicate, required credentials/contact, scoped routing and redacted failures; live checks pending |
| RePEc | No working search adapter | The pinned registry lists it, but its API search limitation remains an upstream gap; do not fabricate parity by exposing a nonfunctional tool |
| Legacy retraction refresh | Temporary Python OpenAlex operation, gated by the saved approval list | `tests/approval_test.py`; Semantic Scholar fallback disabled before cache or transport; absent OpenAlex approval blocks the gate explicitly; TypeScript replacement pending |
| Static HTML and PDF acquisition | Temporary Python adapter with typed extraction diagnostics | `tests/extraction_test.py`, `tests/evidence.test.ts`, `tests/runner.test.ts`; preserved-byte hashes, real PDF page spans, scans/missing text refusal, explicit unverified column/table/math/figure limitations. OCR/visual reading and TypeScript replacement pending |
| Open-access full-text resolution | Temporary composed upstream resolver, separate opt-in `fullTextResolvers` approval | `tests/approval_test.py`; unapproved resolvers never execute, missing credentials are explicit, contact comes from the environment rather than ambient vault settings. Resolver availability is not proof that a candidate was read; extraction diagnostics and TypeScript replacement pending |
| Complete source reading | Paged reads pinned to content hashes | `tests/core.test.ts`, `tests/runner.test.ts`; extracted text coverage is not visual/PDF comprehension |
| Browser/OCR/visual reading | Not implemented | Must be approved scoped readers; no login/CAPTCHA/2FA automation |
| Local files and additional instructions | Implemented for bounded, explicitly selected UTF-8 files | `tests/context.test.ts`, runner/extension tests, `tests/local_evidence_test.py`, Playwright export-denial tests; separate model/search/export consent, immutable snapshots, purpose/citation distinctions, pinned revisions, revocation and crash-cleaned temporary quote views. File refresh requires a fresh run/approval |
| Additional scoped capabilities | Pending | Integration resolution, procedure-definition pinning and revoked/changed tool-binding tests remain M3b work; no ambient skills/tools are inherited |
| Contradiction/depth/reconciliation/digest | Not implemented | M4 scheduling, evidence fixtures and evaluations pending |
| Corpus critique / independence analysis | Not implemented | Syndication/shared-primary-evidence fixtures and persisted findings pending |
| Claim-support audit and re-audit | Not implemented | Current structural/quote gates cannot establish factual support or truth |
| Multi-angle synthesis and full critic suite | Not implemented | M5 bounded stage/recovery/budget contracts pending |
| Extended/chaptered reports | Not implemented | Bounded chapter contexts, global reconciliation and evaluations pending |
| Portable reports and interfaces | Implemented in TypeScript | Export/save tests, TUI capture, and Playwright inventory/search/switching/offline/math/download tests; product surface intentionally differs from upstream |
| Working-state migration | Explicit TypeScript copy/validation/rollback | `tests/migration.test.ts`; one real legacy run migrated with originals preserved; both SQLite databases passed integrity checks |
| Pure TypeScript installation/runtime | Not yet | Discovery, orchestration and delivery no longer need Python; acquisition/working-state/backend gates still do. M6 removes these dependencies after contract parity tests |

## Intentional product exclusions

Do not port upstream knowledge-base catalog/index/graph maintenance, note lifecycle,
import/watch/MCP workflows, Claude installation/browser coupling, or an end-to-end
storage-management UI merely to match a feature count. Minimal private run/evidence
state remains necessary for reproducibility. Optional destinations must be separate
adapters; research cannot require a brain, vault-management workflow or storage server.

## Replacement rule

For each remaining Python operation, record its retained research behavior and
fixtures, implement a composable TypeScript replacement, test old/new contracts,
then remove the Python route/dependency. Preserve source identifiers, content hashes,
provenance, report links, read coverage, spend and revision identity. Record deliberate
behavior changes and unresolved differences rather than hiding them behind a parity label.

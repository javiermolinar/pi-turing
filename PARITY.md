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
| Scholarly ranking/deduplication | Provider relevance order, stable-ID deduplication, uncertain bibliographic matches retained | Never rank by citation count alone or count duplicate provider records as independent evidence; advanced evidence-type routing/filters pending |
| CORE/DOAB discovery | Not integrated into the Pi surface yet | Existing upstream adapters inspected; normalized adapter batches and credentials/consent tests pending |
| ClinicalTrials.gov / EDGAR / FRED | Not integrated | Work types reserved in the normalized contract; credential/contact rules and relevant routing pending |
| RePEc | No working search adapter | The pinned registry lists it, but its API search limitation remains an upstream gap; do not fabricate parity by exposing a nonfunctional tool |
| Legacy metadata enrichment/retraction refresh | Temporary Python operations, including upstream OpenAlex/Crossref/Semantic Scholar enrichment | Separate from discovery routing; field/provider approval parity and TypeScript replacement still require audit |
| Static HTML and PDF acquisition | Temporary Python adapter | `tests/backend_test.py`; representative scan/column/table/math fixtures and TypeScript replacement pending |
| Open-access full-text resolution | Temporary composed upstream resolver | Acquired-version/provenance diagnostics, resolver approval/routing and explicit coverage need improvement; discovery provider selection does not control the Python resolver. Metadata candidates are not proof of readable full text |
| Complete source reading | Paged reads pinned to content hashes | `tests/core.test.ts`, `tests/runner.test.ts`; extracted text coverage is not visual/PDF comprehension |
| Browser/OCR/visual reading | Not implemented | Must be approved scoped readers; no login/CAPTCHA/2FA automation |
| Local files and additional capabilities | Not implemented | M3 consent, snapshot, definition-pinning, revocation and disclosure contracts pending |
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

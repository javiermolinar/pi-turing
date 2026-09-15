# Plan: dogfood light, then establish research parity

## 1. Current direction

**Light is the only executable pipeline. Full/extended code was removed, not disabled.**
The next step is to measure whether light produces useful, accurate reports at an
acceptable cost. Do not rebuild the deleted orchestration to match a feature list.

Upstream reference: [Hyperresearch 0.11.1](https://github.com/jordan-gibbs/hyperresearch)
at `75b1ecfb2891184fad2cc1a2ddf9abe476f5b54c`. This is now a source reference;
Python packaging and the runtime dependency have been removed.

[PARITY.md](PARITY.md) records the capability comparison and known differences.
This plan describes priorities and acceptance criteria. Neither document claims
verified research-quality or end-to-end upstream parity.

Paid research, comparative evaluations, new provider enablement and private-data
disclosure require explicit approval. Updating this plan does not authorize them.

### Product boundary

Build a Pi research tool, not a knowledge-management product:

- Ask a question; optionally attach explicitly approved context.
- Research, produce a report, expose progress and limitations.
- Pause, resume, steer or revise light runs with preserved spend and lineage.
- Browse/search saved investigations and export portable reports without model work.
- Keep checkpoints and evidence private, outside the package repository.

Knowledge-base catalogs, graphs, note lifecycle, import/watch/MCP workflows,
Claude-specific installation/browser coupling and automatic publication are not
parity requirements. A knowledge-base integration is an optional source or
publication destination, not the required backend.

## 2. What exists now

| Area | Implemented behavior | Main evidence |
| --- | --- | --- |
| Research | Decompose → parallel search/retrieval → one draft → bounded polish → readability → shipping gates | `src/runner.ts`, `tests/runner.test.ts` |
| Pi startup | No saved-run scan, automatic selection, widget or run-context injection; explicit commands/tool use activate research | `extensions/index.ts`, `tests/extension.test.ts` |
| Workers | Isolated Pi SDK sessions, scoped tools, structured results, cancellation and usage accounting; no ambient shell/project tools | `src/worker.ts`, `tests/worker.test.ts` |
| Web discovery | DuckDuckGo by default (free/keyless, subject to rate limits and blocking); opt-in Brave, Tavily, Serply or Kagi with provider-scoped keys and no silent fallback | `src/search.ts`, `src/search-providers.ts`, search/provider/extension tests |
| Scholarly discovery | OpenAlex/Crossref by default; opt-in CORE, DOAB, ClinicalTrials.gov, EDGAR and FRED; normalized records, bounded caching and visible provider failures | `src/scholarly.ts`, provider modules, scholarly/specialist tests |
| Acquisition | Static HTML via Mozilla Readability/LinkeDOM, PDF text via PDF.js, safe HTTP via Undici; opt-in Unpaywall/Europe PMC/CORE recovery | Native backend, extraction, acquisition and public-HTTP modules/tests |
| Reading | Paginated content-hash coverage; extraction diagnostics and PDF page spans; incomplete text and unmet visual-reading requirements cannot count as sufficient reads | `src/coverage.ts`, `src/evidence.ts`, evidence/runner/extraction tests |
| Local/scoped context | Explicit file snapshots and adapter bindings; separate model/search/export consent, private provenance, revocation and secret/path protections | `src/context.ts`, `src/capabilities.ts`, [INTEGRATIONS.md](INTEGRATIONS.md) and associated tests |
| Working state | Central run identity, private workspaces, locks, atomic checkpoints, explicit copy/validation/rollback migration | Paths/store/locks/migration modules and tests |
| Run control | One controller owns startup, cancellation and locks; saved-config resume uses blocker-specific recovery; steering/revisions/top-ups preserve spend | Controller, runner, feedback, budget and extension tests |
| Delivery | Dashboard-first interface with selected-run focus, session-owned feedback, follow-ups with checkpoint-bound browser spending authorization and separate private-context approval, explicit hide/pause-and-close, live updates, offline HTML, search and exports; terminal commands retained as advanced compatibility paths | UI/server/control/search/export tests and browser smoke tests |
| Historical runs | Full/extended reports, status, cost and checks remain read-only; no resume, revision, steering, top-up or silent conversion to light | `src/run-policy.ts`, `tests/light-only.test.ts` |

Ordinary starts use configured defaults and cost confirmation, not an optional
context questionnaire. Attachments/readers come from configuration or explicit
`/hyperresearch context`, with separate approval.

The runtime uses typed service methods, not backend action strings. The checkpoint
owns decomposition and editing decisions; redundant JSON views are retired on
writable light runs. Only changed or repaired reports are rematerialized. Shared
Markdown syntax keeps citation gates, HTML and exports consistent.

OpenAlex approval is required before execution. Metadata outages retry verification
without paid editing; missing headings require explicit replanning or a new run.
Polish and readability remain separate pending an approved comparison.

State lives under `~/.pi/hyperresearch/` by default, with an explicit data-root
override. Project configuration, package files, workspaces and export destinations
have separate paths. Opening an old run never starts workers.

### Limits that remain

- Light checks complete reads and known citation IDs. The backend checks required
  headings, length, citation density, scaffold leakage, quote integrity and known
  retracted citations. These checks **do not establish claim support or factual accuracy**.
- Browser retrieval, authenticated access workflows, OCR and visual understanding
  are absent. PDF text extraction is not reliable interpretation of tables,
  figures, columns or equations.
- Stable-ID/bibliographic deduplication does not establish source independence.
  Quality-aware source ranking and advanced discovery filters remain limited.
- Scoped reader infrastructure exists; arbitrary installed skills/tools and
  production knowledge-base connectors are not automatically available.
- Public-provider coverage and end-to-end research quality need live evaluation.
  Mock-provider and deterministic worker tests do not establish either.
- Native extraction and legacy-source compatibility have deterministic fixture
  coverage, not broad live-document or old/new output equivalence. Deliberate
  differences and limits are documented in [PARITY.md](PARITY.md#6-native-runtime-and-saved-source-compatibility).

### Cost and completion are not solved

Current defaults include two research workers, a 15-source target, an upstream
light minimum of 10 reads, a 500–2,000-word report target, 80 turns per worker,
a 30-minute per-worker timeout and an approximately $15 catalog-priced model ceiling.
These are configuration limits, not demonstrated optimal settings or a promise
of completion. Search fees are separate; in-flight responses may overshoot.

There is no run-wide elapsed-time limit, remaining-stage budget reservation or
validated completion-cost forecast. Failed gates can require more work. Do not
recommend another top-up without inspecting the blocker and remaining work.

## 3. What parity means now

Separate three goals:

1. **Retained light-contract parity:** understand and test equivalent research
   behavior where we retain upstream light capabilities. Document deliberate
   differences rather than silently calling them equivalent.
2. **Outcome parity:** compare useful coverage, factual errors, citation support,
   time, cost and failure behavior on the same questions. This is not established.
3. **Broader upstream coverage:** full research, richer analysis and larger profiles
   are not implemented. They remain outside the current delivery scope; their
   removal means we cannot claim complete upstream research parity.

A pure TypeScript runtime and quiet Pi startup are product goals, not evidence of
research parity. More stages or matching profile names are not acceptance criteria.

### Known light-contract differences to assess

The pinned upstream profile uses steps 1, 2, 10, 15 and 16, one draft and no critic
suite. Those structural choices match our current pipeline, but procedures differ:

| Contract | Known difference / unresolved question |
| --- | --- |
| Query planning | Upstream records atomic requirements, response format, citation style and posture levers. Our schema has questions/headings/searches plus register/depth preferences. Does it preserve explicit asks without inventing scope? |
| Report format | Upstream light drafting supports selected response formats, commonly short or structured. We currently fix the report target to the short range; longer formats are not implemented. |
| Research breadth | Upstream authors source targets, batches and fetcher waves. We use configurable parallel lanes and a hard source cap. Coverage, failed-fetch recovery and wasted reads need comparison. |
| Scholarly work | Upstream's width-sweep skill says light skips academic APIs. Our light enables OpenAlex/Crossref by default. This is a deliberate capability difference with unmeasured cost/quality impact. |
| Source selection | Upstream has source ranking/provenance procedures; our provider ordering and deduplication do not reproduce the full selection policy. Audit the light-relevant subset before adding anything. |
| Polish/readability | Upstream has auditor/recommender procedures and separate decision artifacts. We use constrained patch workers. Measure whether the simpler implementation misses material improvements. |
| Output citations | We draft with source IDs and export portable references. Upstream supports different citation styles. Check preservation of claims, links, quotes and source provenance, not identical internal Markdown. |
| Gate behavior | Native adaptations retain light length/density, scaffold and retraction rules, with stricter source-bound quote matching, Markdown headings and readability decisions. Expand shared pass/fail fixtures and compare on real reports. |

Evidence and remaining verification for these differences belong in [PARITY.md](PARITY.md).
The upstream light profile itself contains an authored `~30–40 min` estimate;
that is not a measured prediction for this port. Do not market light as instant.

## 4. What was removed and why

Deleted: corpus/depth/digest orchestration, multi-angle drafts and synthesis,
critics and adjudication, chapter assembly, semantic block-audit/re-audit loops,
their schemas/backend actions and dedicated tests.

Our SQLite/PostgreSQL comparison consumed roughly **104 minutes and $30.20** and
still did not complete. Its isolated-block review and repeated source reads
produced expensive, partly unhelpful findings. This is evidence against that
implementation; it is not a controlled test of upstream.

Preserve historical artifacts without interpreting old journals as current
verification. Do not restore these features as a prerequisite for light parity.
Any future addition needs a demonstrated user problem, a bounded design and an
approved comparison showing that its benefit justifies the extra cost.

## 5. Ordered next work

### P0 — Dogfood light before changing the pipeline

- [ ] Agree on a small evaluation set: a documentation comparison, a bounded
      factual explanation and a literature question. Select actual questions
      and approve each trial's cost/time limits before execution.
- [ ] Define the review rubric and acceptable completion/error/cost thresholds
      before seeing results. Use human review; do not build another critic loop.
- [ ] Record query, code revision, model/thinking level, provider/configuration,
      context permissions, run ID, completion status, elapsed time, tokens,
      model cost, known search fees and every resumed/failed attempt.
- [ ] Review explicit question coverage, material factual errors, citation support,
      source quality, useful uncertainty and readability. Distinguish an accurate
      limitation from an unanswered required question.
- [ ] Report completion rate and total cost across attempts, not only successful
      runs. Count manual intervention and configuration changes.
- [ ] Inspect source-count, fan-out, repeated-read and timeout costs. Change
      defaults only where observations justify it; propose a run-wide limit if needed.

**Acceptance:** recorded results and a decision to keep, simplify or repair light.
No automatic retries/top-ups, new orchestration layers or quality claims based
only on passing fixture tests.

### P1 — Close measured light-parity gaps

- [ ] Finish the retained-light contract comparison against the pinned upstream
      skills, profile and backend gates; turn each difference into a deliberate
      divergence or a specific regression/evaluation case.
- [ ] Compare drafting/gates on shared source fixtures, then run an explicitly
      approved end-to-end comparison with upstream light and a simple single-draft
      baseline. Match models, inputs and budgets where possible; record differences
      in host/tool/provider access rather than hiding them.
- [ ] Prioritize fixes demonstrated by P0/P1: omitted requirements, unsupported
      claims, broken citations, bad acquisition or unnecessary cost. Keep each
      fix small and compare before/after results.
- [ ] Decide whether structured output, richer requirement mapping or improved
      ranking is worth implementing. None automatically implies another pipeline.
- [ ] Record unresolved differences and evaluation artifacts in `PARITY.md`.

**Acceptance:** named contracts and outcomes supported by evidence. Do not claim
full research parity while broader upstream capabilities remain absent.

### P2 — Improve acquisition only where trials expose a need

- [ ] Run separately approved provider/resolver smoke tests; record credential,
      coverage, throttling, failure and version-substitution behavior.
- [ ] Add extraction fixtures from failures found in practice. Preserve incomplete
      reads and unavailable layout capabilities as explicit limitations.
- [ ] If needed, compose a bounded browser/OCR/visual reader with explicit access
      approval. No automated login, CAPTCHA/2FA solving or ambient browser profiles.
- [ ] Add a production scoped reader only for a requested source, with binding,
      transport, privacy, cancellation and evidence-provenance tests.

**Acceptance:** a concrete retrieval gap is resolved without expanding ambient
permissions or counting metadata/extracted fragments as complete evidence.

### P3 — Native runtime implemented

- [x] Replace remaining evidence services with TypeScript/Node. Reuse Readability,
      LinkeDOM, PDF.js, Undici, ipaddr.js and YAML rather than hand-writing parsers.
- [x] Remove duplicate upstream run bookkeeping; the Pi checkpoint is authoritative.
      Native structural/quote gates consume it directly, with local evidence in memory.
- [x] Read legacy Markdown sources without changing IDs, bodies, assets or database
      files. No source-format conversion is needed. Existing checkout-to-central
      migration retains preview, locks, validation and rollback.
- [x] Keep full/extended artifacts read-only. No historical gate results are rewritten.
- [x] Remove bridge, Python packaging/tests and executable setup/uv dependencies;
      replace backend tests with native fixtures and a no-PATH light lifecycle test.
- [x] Document routes, source compatibility and deliberate stricter checks in
      [PARITY.md](PARITY.md#6-native-runtime-and-saved-source-compatibility).
- [ ] Expand shared old/new acquisition fixtures using difficult documents from
      approved trials. Exact extractor output and live resolver coverage are not
      established by the deterministic fixture suite.

Runtime replacement does not establish outcome parity. P0/P1 evaluation remains
necessary; it does not justify restoring removed orchestration.

### Deferred, not scheduled

- Full/extended orchestration and semantic audit ensembles.
- Automated cross-run synthesis and private evidence bundles.
- Publication adapters, including Lumbrera, unless explicitly requested.
- Knowledge-management features outside the product boundary.

## 6. Validation and maintenance

The native regression suite includes the former backend contracts, HTTP/SSRF and
extraction fixtures, and complete light acquisition/pause/resume/revision without
PATH executables. Run `npm run typecheck`, `npm test`, `npm run test:backend` and
`npm run test:browser`. These establish fixture coverage, not live quality or
upstream equivalence; see tests and scripts for the actual contracts.

Preserve regression coverage for quiet startup, explicit cost/disclosure approval,
light execution and recovery, source reads, source-content isolation, safe exports,
read-only legacy runs and refusal of removed scopes before paid work.

Keep this plan focused on priorities. Keep operational instructions in
[README.md](README.md), adapter contracts in [INTEGRATIONS.md](INTEGRATIONS.md),
and capability status/evidence in [PARITY.md](PARITY.md). Update the latter when a
contract or evaluation changes; do not infer progress from implementation volume.

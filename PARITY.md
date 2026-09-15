# Research parity: light baseline and remaining gaps

## Reference and meaning

Upstream: [jordan-gibbs/hyperresearch](https://github.com/jordan-gibbs/hyperresearch),
0.11.1 at `75b1ecfb2891184fad2cc1a2ddf9abe476f5b54c`.
This is the source reference, not a runtime dependency. Python and uv have been removed.

**Current target: retained light research contracts and useful outcomes, not all
upstream functionality.** Full/extended execution has been deleted. We do not
claim complete research parity, end-to-end light equivalence or superior outcomes.
[PLAN.md](PLAN.md) sets the evaluation order and acceptance criteria.

Evidence levels below:

- **Implemented / fixture-tested:** local code and deterministic tests exist;
  this does not establish live provider coverage or model quality.
- **Adapted:** a retained upstream contract has a native implementation;
  adaptation and outcome equivalence still need comparison.
- **Partial / unverified:** a narrower implementation exists or validation is missing.
- **Removed / deferred:** not executable; not an automatic restoration commitment.
- **Intentional difference / exclusion:** product or permission boundary, not a
  defect to erase merely to match upstream.

## 1. Light workflow comparison

The following upstream facts were checked against the installed pinned package's
`core/profiles.py`, `core/runs.py` and stage skills. This was source inspection,
not an upstream research run. Paths below are package-relative.

| Contract | Pinned upstream behavior | Current Pi behavior | Status / next evidence |
| --- | --- | --- | --- |
| Stage set | `_LIGHT`: 1, 2, 10, 15, 16; one draft, no critic suite | Same five stages; Pi-owned runner | Structural match only. Runner fixtures pass; compare actual outputs and failures |
| Planning | `skills/hyperresearch-1-decompose.md`: atomic items, required formats, response format, citation style and posture levers | Questions, headings, searches; user query and applied instructions preserved; register/depth settings | Partial. Evaluate missed asks, invented scope and whether richer planning is needed |
| Scope selection | Upstream entry/planning supports multiple tiers | Light only; old full/extended records are read-only | Intentional product restriction. Broader parity is absent |
| Report shape | `skills/hyperresearch-10-triple-draft.md`: light single-draft path obeys the selected response format, commonly short or structured | Report target fixed to 500–2,000 words | Partial. Structured format is missing; add only if evaluation justifies it |
| Breadth and fan-out | `_LIGHT`: minimum 10 sources, target 15–25, authored fetcher batches/waves; width skill has coverage procedures | Default target 15, configurable 10–30 and 1–4 research lanes; native light minimum 10; source cap 30 | Deliberate orchestration difference, outcome unverified. Compare coverage, gaps and acquisition cost |
| Scholarly discovery | `skills/hyperresearch-2-width-sweep.md` says light skips academic APIs | OpenAlex/Crossref enabled by default, other providers opt-in | Intentional capability difference; additional cost/benefit unmeasured |
| Draft reading | Light skill selects relevant non-deprecated notes and reads them directly; no full-mode digest | Draft worker must complete at least the source minimum and every cited source in its session | Implemented, not procedure-equivalent. Compare relevance, read duplication and source quality |
| Selection/ranking | Upstream width/drafting procedures include source ranking and provenance signals | Provider relevance order, stable-ID deduplication and uncertain bibliographic matches | Partial. No proven independence or equivalent quality-ranking policy |
| Polish/readability | Stages 15/16 use auditor/recommender procedures and decision artifacts | Separate constrained patch workers; max eight hunks, 800 characters per side, 15% changed span; headings/citations preserved | Intentional simplification. Measure useful edits missed, not artifact-name equivalence |
| Citation presentation | Draft skill supports wikilinks or numbered public citations | Source-ID draft citations and portable Markdown export | Intentional representation difference. Test valid attribution, links, quotes, math and unresolved references |
| Shipping checks | `core/runs.py:verify_run`: structure, length/density, artifact presence, quote integrity and known retracted citations; additional gates depend on stages | Native structural/quote gates plus host stage/read/citation-ID checks and explicit metadata refresh | Adapted/fixture-tested, with stricter exact quotes, actual Markdown headings and mandatory readability decisions. Broad old/new differential evaluation remains pending |
| Semantic claim support | Not supplied by the light stage set | No semantic support audit or critic suite | Neither a light feature nor a reason to claim factual verification |
| Time/cost | `_LIGHT` contains an authored `~30–40 min` estimate | Catalog-based model ceiling, worker timeouts and accounting; no validated completion forecast or run-wide elapsed limit | Unverified. An authored estimate or $15 ceiling is not a completion promise |

## 2. Supporting capabilities

| Capability | Current status | Evidence and remaining work |
| --- | --- | --- |
| Quiet Pi startup | Implemented; Pi-specific behavior | `tests/extension.test.ts`: no run scan, widget or run-context injection before explicit use, including reload/session switches |
| Isolated workers and budgets | Implemented / fixture-tested | Runner, budget, extension and worker tests: scoped tools, cancellation, cumulative usage, explicit top-ups; model prices and in-flight overshoot remain limitations |
| Web discovery | Implemented / fixture-tested | `src/search.ts`, `src/search-providers.ts`, search/provider/extension tests: Brave, DuckDuckGo, Tavily, Serply and Kagi; fixed endpoints, scoped keys, bounded responses and no fallback. Parallel remains unsupported; live provider coverage is unverified |
| OpenAlex/Crossref | Implemented / fixture-tested | `src/scholarly.ts`, `tests/scholarly.test.ts`: normalized metadata, versions, provenance, caching, cancellation and provider failures. Live coverage/ranking validation pending |
| CORE/DOAB and ClinicalTrials.gov/EDGAR/FRED | Implemented, opt-in / fixture-tested | `src/scholarly-providers.ts`, `tests/specialist.test.ts`: distinct evidence types, identities and credential/contact handling. Live validation pending |
| RePEc | No working adapter | Document the upstream search limitation; do not expose a nonfunctional provider to claim parity |
| HTML/PDF acquisition | Native / fixture-tested | Mozilla Readability + LinkeDOM, PDF.js in a terminable Node worker; Undici with socket-level public-IP validation. `tests/extraction.test.ts`, `tests/public-http.test.ts`: text/page diagnostics, missing pages, assets, redirects and cancellation. Compare difficult real documents |
| Open-access recovery | Native / fixture-tested, opt-in | `src/acquisition.ts`, `tests/native-backend.test.ts`: Unpaywall/Europe PMC/CORE allowlist, credentials, JATS/full-text recovery and acquired-version distinctions. Resolver availability is not proof of reading |
| Browser, OCR and visual reading | Not implemented | Compose a bounded approved reader only when needed. No ambient browser profile or login/CAPTCHA/2FA automation; extraction alone cannot clear visual requirements |
| Source-read coverage | Implemented / fixture-tested | `src/coverage.ts`, core/runner tests: paginated reads tied to hashes. This is byte/text coverage, not comprehension or factual verification |
| Retraction refresh | Native / intentionally restricted | Native-backend/runner/extension tests: OpenAlex approval is checked before research starts; no Semantic Scholar fallback. Missing records stay unknown; outages block completion but resume retries verification without paid editing. Empty/non-DOI source sets require no metadata requests; local/scoped identifiers are not sent |
| Local files and instructions | Implemented / fixture-tested | Context/runner/extension/local-evidence tests: explicit snapshots, purpose distinctions, separate model/search/export consent and revocation. No automatic startup questionnaire |
| Scoped procedures/readers | Implemented infrastructure; production connectors incomplete | Capability tests and [INTEGRATIONS.md](INTEGRATIONS.md): pinned bindings and documents, private/public provenance, completeness and tool isolation. Arbitrary installed skills are not supported |
| State and recovery | Implemented for light / fixture-tested | Store/controller/runner/migration tests: central IDs, atomic checkpoints, saved configuration, blocker-specific recovery, stage-boundary steering and preserved revisions. One controller owns startup, worker cancellation and lock release. Immutable source records; read-only legacy Markdown compatibility; no upstream database writes |
| Historical full/extended reports | Read-only compatibility | `tests/light-only.test.ts`, extension tests: preserved report/status/cost, no writes or paid-work fallback; old journals remain opaque, not currently revalidated |
| Delivery | Implemented; intentional Pi product surface | Export/report/search/server/control tests and browser scripts: full-inventory dashboard focused on the selected run, authenticated session-owned steering, linked revisions with recorded browser spending authorization and separate private-context permission, hide/pause-and-close lifecycle, retained compatibility picker, literal search, Markdown/HTML export, safe Save report and math rendering |
| Pure TypeScript runtime | Implemented / fixture-tested | `tests/native-runner.test.ts`: acquisition → pause → disk resume → gates → revision with an empty executable PATH. Package installation needs Node 22.13+, not Python/uv. This is not evidence of research-quality parity |

### Web search contracts

New runs default to DuckDuckGo's free, keyless HTML search, which can be rate-limited
or blocked by bot challenges. Brave, Tavily, Serply and Kagi require explicit
configuration and their own environment key. Saved runs retain their provider;
historical checkpoints without a provider field retain the old Brave default.
Legacy Serply light runs can resume with a configured key and normal approval;
Parallel checkpoints remain readable but cannot execute. No credentials are saved
in configuration/checkpoints or included in provider URLs or request bodies.

- **Tavily:** `POST https://api.tavily.com/search`, Bearer `TAVILY_API_KEY`.
  Basic/general search, five results, automatic parameter selection disabled;
  no generated answer, raw-content extraction or images requested.
- **Serply:** `GET https://api.serply.io/v1/search/q=…&num=5`, `X-Api-Key:
  SERPLY_API_KEY`. Google's encoded parameters are in the path. Only organic
  `results` become source leads; ads and answer boxes are ignored. Serply's page
  extraction endpoint is not used.
- **Kagi:** `POST https://kagi.com/api/v1/search`, Bearer `KAGI_API_KEY`.
  The linked current v1 API uses `query`, `workflow: search`, `format: json`,
  and `limit: 5`; this is not the old v0 API. Only `data.search` becomes source
  leads. Optional paid `extract` is not requested.

All providers share the five-result cap, URL validation/deduplication, untrusted
snippet wrapping, 1 MB response limit and 30-second deadline. HTTP errors,
malformed/error envelopes, stream failures and cancellation never trigger retries
or another provider. Search leads do not count as source reads; acquisition stays
in the native evidence service. Search fees/credits are separate from model spend.

Contracts were checked against [Tavily's Search documentation](https://docs.tavily.com/documentation/api-reference/endpoint/search),
[Serply's Google Search documentation](https://serply.io/docs/resources/google-search),
and [Kagi's current OpenAPI documentation](https://kagi.com/api/docs/openapi/search/search).
The full 157-test suite and TypeScript checking passed after these additions;
all 24 search tests also passed on Node 22.13.1. Tests use mocked transports,
not paid requests or proof of live provider coverage.

## 3. Broader upstream coverage not implemented

The deleted Pi full/extended pipeline included corpus critique, contradiction/depth
work, reconciliation/digest, multi-angle drafting, critics/adjudication, chapters
and block audits. Those are no longer available. The former implementation was
not a verified reproduction of upstream full, premier or dissertation profiles.

Restoring these stages is **not required for retained light parity**. Claiming
complete upstream research parity would require addressing the missing contracts
and evaluating outcomes; that is not the current delivery commitment.

The failed Pi documentation comparison used roughly 104 minutes and $30.20 without
completion. It is a negative dogfooding result for our removed implementation,
not evidence that upstream is wrong or that light has superior measured quality.

## 4. Intentional exclusions and differences

Do not port knowledge-base catalogs/graphs, note lifecycle, import/watch/MCP,
Claude installation/browser coupling or storage-management UI to match a feature
count. Publication adapters and private evidence bundles are deferred product
features, not prerequisites for research delivery.

Explicit provider allowlists, model/search/export consent, shell-free workers,
no automatic saved-run selection and no automatic tier escalation remain product
constraints even where upstream operates differently.

## 5. Evidence required before a parity claim

- [ ] Complete the retained-light contract inventory against the pinned skills and
      operations; classify each difference as intentional, partial or unresolved.
- [ ] Run shared-source drafting and gate fixtures against old/new paths; preserve
      both passing and failing cases, not just compatible happy paths.
- [ ] Conduct separately approved live provider/resolver checks with recorded
      settings, dates, credential requirements and failure/coverage results.
- [ ] Dogfood light with a predeclared human rubric and approved budgets. Preserve
      failed/resumed attempts, tokens, time, model costs and known external fees.
- [ ] Compare upstream light and a simple single-draft baseline on the same questions;
      match models, source conditions and budgets where possible and disclose
      unavoidable differences in tools/providers/hosts.
- [ ] Publish measured coverage, material factual/citation errors, readability,
      completion rate and total cost. Record human interventions and limitations.

No end-to-end comparative results are established by the existing test suite.
Do not add paid evaluations to ordinary tests or replace human evaluation with
another automatic critic ensemble.

## 6. Native runtime and saved-source compatibility

`NativeBackend` implements typed evidence methods, not a string-dispatched RPC
protocol or the upstream vault product. `ResearchServices` composes these with
`searchWeb` and `searchScholarly`; worker-facing tool names remain unchanged.

| Method | Native contract |
| --- | --- |
| `initialize` | Create private evidence directories; return the fixed light profile. No external setup or agent files |
| `searchVault` | Bounded literal word search of saved public sources; return metadata, never source bodies |
| `fetchSource` | Public HTTP(S) URL, optional real provenance parent and explicitly approved resolvers → immutable source ID, raw bytes, extraction diagnostics and acquired-version metadata |
| `readSource` | Source ID + offset → at most 8,000 UTF-16 code units, SHA-256 of the complete UTF-8 body, untrusted fence, next offset and physical PDF page spans |
| `refreshRetractions` | Current public source IDs + approved OpenAlex → checked/unknown/throttled counts and known retractions; no local/private identifiers or provider fallback |
| `verifyReport` | Checkpoint report/decomposition/patch decisions + source IDs/hashes + approved in-memory local evidence → direct structural/quote checks. No report writes or temporary public local-evidence views |

`doctor`, `create_run`, `set_step` and `set_status` are gone. The central Pi
checkpoint already owns scheduling, report text, cost and status; the runner no
longer mirrors them into a second manifest. `/hyperresearch setup` is a harmless
compatibility message, not an installer.

Acquisitions serialize per normalized URL, preserving each caller's resolver
approval and cancellation. Unrelated fetches and saved reads no longer wait on a
global queue. Retraction requests remain serialized separately.

Only `pi-state.json` and the changed/repaired `report.md` view are maintained.
Decomposition and editing decisions stay in the checkpoint; redundant bridge-era
JSON views are removed on the next writable light-run save. Historical
full/extended artifacts remain untouched. Cosmetic activity writes are coalesced;
usage, approvals, evidence and stage transitions remain synchronous checkpoints.

New source JSON, raw assets and public retraction observations live under each
workspace's `.pi-research/`. A known retraction survives reloads and subsequent
missing metadata; an unknown response never clears a previously observed flag.
Legacy `research/notes/*.md` sources are read through YAML, without importing or
rewriting them. IDs, UTF-8 bodies/hashes and original assets stay unchanged;
SQLite/cache files and historical run artifacts are untouched. Generated notes,
reports and interrupted local quote views are excluded from public source access.
No destructive source-format migration or database conversion is needed. The
existing explicit checkout-to-central copy/validation/rollback migration remains
available for checkout-local runs. Never run upstream writers against an active
Pi workspace; they do not honor Pi's locks.

Legacy PDF bytes are parsed with PDF.js and must map to the preserved body. If
mapping fails, the source is incomplete—not silently rewritten or marked fully
read. Missing/corrupt assets also fail closed. Start a new investigation to acquire
fresh sources when an old PDF is incompatible. Historical full/extended reports
remain viewable/exportable and cannot execute.

### Deliberate differences from the Python adapter

- Readability replaces the upstream HTML extractor; PDF.js replaces PyMuPDF.
  Extracted text can differ. Layout/tables/figures/equations remain unverified.
- PDF parsing runs in a terminable Node worker with a 60-second deadline,
  300-page/20 MB input limits and bounded extracted text. No page scripts, browser,
  cookies, OCR or login fallback run. Socket DNS rejects private/mixed resolutions
  and every redirect is revalidated.
- Thin DOI-bearing HTML/text is marked incomplete instead of counting an abstract
  as a complete paper. Approved full-text recovery must yield at least 6,000
  characters and improve on the original. Resolver failures remain visible.
- Search is literal word matching, not upstream SQLite FTS/stemming/ranking.
- Quotes of five or more words use exact, case-sensitive matching after whitespace
  normalization against the supplied read sources. Upstream used stemmed FTS over
  the vault, which could accept inflection changes or unrelated/generated notes.
  This stricter rule still does not prove semantic support, and short quotes are
  outside its retained scope.
- Required headings must be Markdown headings, not substrings. Both polish and
  readability decisions are required in the checkpoint, not separate files. The
  light length/density rules retain script-neutral counting, ±20% tolerance and
  the density floor of nine. Gates, HTML and Markdown share citation/math syntax;
  literal code, math and numeric citation stand-ins do not inflate citation density.
  Retraction acknowledgment must be near the citation within its Markdown block.
- Local quote evidence is checked in memory and never enters public search/storage.

`npm run test:backend` runs native fixtures, including the retained Python-test
scenarios. `npm test` includes the full light lifecycle without PATH executables.
Validation also used a packed production-only installation (`npm ci --omit=dev
--ignore-scripts`) on Node 22.13.1: the light lifecycle and PDF extraction passed
with an empty executable PATH. The package contains no Python files. TypeScript
checking, the then-current regression suite, native-backend tests on Node
22.13.1, and browser smoke tests passed during the runtime conversion. No live provider requests or paid research ran during conversion.

These fixtures establish the tested contracts, not live acquisition coverage,
complete old/new output equivalence or factual accuracy.

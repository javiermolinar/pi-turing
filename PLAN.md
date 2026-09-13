# Plan: first-class investigation and report generation

Status: implementation in progress. The user authorized implementation, per-block
commits, and explicit migration of existing runs. Provider enablement and paid
research/evaluation runs still require separate approval.

Upstream: https://github.com/jordan-gibbs/hyperresearch. Adapt its research
capabilities for Pi through composable contracts, not its end-to-end storage product.
Research parity is the target; measured coverage, not feature names, establishes it.

Comparison baseline: Hyperresearch 0.11.1 at
`75b1ecfb2891184fad2cc1a2ddf9abe476f5b54c`.

## 1. Product boundary

**Build a research engine, not another knowledge base.**

The original Hyperresearch combines investigation with persistent knowledge
storage. This project should make investigation and report generation first-class
while composing existing retrieval and storage implementations where useful.

The user should be able to:

1. Ask a research question and optionally supply local context.
2. See the proposed scope, external services, and cost ceiling.
3. Follow the investigation, inspect findings, and steer or pause it.
4. Receive a report with usable citations, equations, and disclosed limitations.
5. Download it, save it to a chosen folder, or optionally publish it elsewhere.
6. Revise it without overwriting the original.
7. Select previous runs in Pi or the web interface and search across their reports
   without starting another investigation or model request.

A named vault, Lumbrera brain, storage-server setup, or knowledge-management
workflow must not be a prerequisite for doing research.

### Own versus compose

| Own in Hyperresearch | Compose behind the scenes | Optional destinations |
| --- | --- | --- |
| Question decomposition and investigation strategy | Web/scholarly provider clients | A user-selected folder |
| Source selection, full-read requirements, provenance and evidence use | HTTP, PDF, and browser readers | Browser download/export |
| Contradiction analysis, gap finding, and deeper investigation | Open-access resolvers and metadata services | A Lumbrera brain |
| Synthesis, report generation, criticism, and citation-support checks | Existing caches and source stores | Other publication integrations when justified |
| Budgets, recovery, steering, revisions, and visible progress | Existing backend CLI/library operations | |
| Report rendering and portable export | Storage/index implementations if needed internally | |

Owning a capability means defining and testing its behavior, not writing every
parser, crawler, or database implementation ourselves. Searching different places
and actually reading the evidence are core research features even when their
implementation comes from another package.

The retained Python backend supplies useful operations, including static/PDF
retrieval. Use it temporarily behind replaceable adapters while research features
are developed. Its storage is an implementation dependency to retire, not the
product architecture. The final delivery phase replaces all retained Python code
with TypeScript for a pure Pi package, without porting upstream knowledge-base
features that are outside the research boundary.

## 2. Current capabilities and research gaps

Today the port runs the light pipeline: decompose, parallel search/retrieval,
single draft, bounded polish, readability, and basic shipping gates. It supports
Brave/DuckDuckGo web search, OpenAlex/Crossref scholarly discovery, static/PDF
fetching through Python, complete-read tracking, live/offline dashboards, math
rendering, explicit steering, and preserved revisions.

PDF reading is not absent: full-text extraction exists today. Browser retrieval,
OCR/visual understanding of scanned pages, and reliable table/figure interpretation
must not be implied by a successful PDF text extraction.

| Research capability | Gap to close |
| --- | --- |
| Broader scholarly/specialist discovery | Integrate providers beyond OpenAlex/Crossref behind one search capability |
| Full-text acquisition | Improve open-access resolution and explicit handling of missing/incomplete text |
| PDF evidence quality | Detect scans/extraction failures; preserve page/section provenance where supported; handle tables/figures when the question requires them |
| Browser retrieval | Compose a Pi-compatible browser reader for JavaScript-heavy pages and user-authorized access |
| Source independence | Identify syndication, derivative reports, and shared primary evidence |
| Contradiction analysis | Structure competing claims and the evidence behind each |
| Focused depth investigation | Select high-value unresolved questions and allocate bounded investigation budgets |
| Reconciliation and evidence digest | Consolidate comparisons, claims, and exact supporting passages before writing |
| Corpus critique and gap filling | Independently ask what important evidence is missing and retrieve it |
| Multiple drafts and synthesis | Support independent angles and synthesis when warranted |
| Post-draft critics | Add dialectic, depth, width, and instruction review without making users operate four agents |
| Citation-support audit | Check whether a cited source supports the associated claim, not just whether its ID exists |
| Critic-driven corrections and re-audit | Apply bounded patches and recheck affected claims; escalate structural issues |
| Scope/register controls | Respect teaching, survey, analysis, advocacy, and depth preferences consistently across roles |
| Extended/chaptered work | Add bounded chapter workflows, global reconciliation, and resumable artifacts |
| Portable delivery | Export standard Markdown and save to a chosen folder without relying on the dashboard or vault-specific wiki links |
| Quality evaluation | Measure research outcomes; fixture tests alone do not establish parity or factual accuracy |

Upstream knowledge-base features—catalog generation, note lifecycle, semantic
indexing, graph maintenance, deduplication workflows, import/watch/MCP—are not
features we must independently rebuild to claim a capable research workflow.
If a selected storage integration offers them, compose or delegate them.

## 3. First-class scholarly discovery

Expose one scholarly discovery capability, not a command per provider. The
investigation selects relevant, enabled sources and receives a normalized result
set with explicit provider coverage and failures.

| Provider | Evidence role | Integration direction |
| --- | --- | --- |
| OpenAlex | Broad literature and citation metadata | Retain and improve |
| Crossref | DOI/publication metadata | Retain and improve |
| CORE | Open-access literature/full text | Compose existing adapter when a key is configured |
| DOAB | Scholarly books and chapters | Add for book-heavy disciplines |
| ClinicalTrials.gov | Registered studies, including unpublished work | Add for relevant biomedical questions |
| SEC EDGAR | Filings and disclosures | Add for financial/company questions; require contact configuration |
| FRED | Economic series | Add for economic-data questions when a key is configured |
| RePEc | Economics discovery | Document the upstream API search limitation; do not claim a working adapter |

Requirements:

- Normalize identifiers, DOI, title, authors, dates, work type, version, source
  URLs, full-text candidates, provider provenance, and retrieval time.
- Deduplicate by stable identifiers first; use conservative bibliographic matching
  otherwise. Expose uncertain matches. Two providers returning one paper do not
  provide two independent sources.
- Distinguish preprints, publications, corrections, and retractions. Do not flatten
  version differences or mistake filings, trials, and series for academic papers.
- Rank for the question and evidence type, not citation count alone.
- Apply cancellation, bounded responses, per-provider deadlines, caching, and
  courtesy limits. Distinguish partial failure from a genuine empty result.
- Route only within the user's enabled/approved services. Missing credentials are
  a visible capability gap, not permission to enable another paid provider.
- Preserve the explicitly selected Brave/DuckDuckGo web provider and no-fallback
  rule. Web discovery complements scholarly discovery rather than replacing it.

Discovery is not reading. Abstracts and search snippets are leads, not full-read
sources. Retrieve the actual available version, read it completely where required,
and record substitutions, extraction problems, and inaccessible evidence.

## 4. Acquisition and evidence use

Compose existing readers and resolvers behind a small research-facing contract:

- Discover candidate works and URLs.
- Resolve available full text and identify its version.
- Retrieve source content with provenance and acquisition diagnostics.
- Read bounded pages/sections against a pinned content hash.

Keep search, acquisition, and evidence assessment distinct. A fetched page may be
a login wall; extracted PDF text may omit essential equations or table structure.
Neither outcome should silently count as sufficient evidence.

For PDFs, test born-digital text, scans, columns, tables, mathematical notation,
and missing pages. Use OCR or visual reading only when an appropriate composed
reader is available and approved. Otherwise disclose the limitation or seek an
accessible equivalent—do not imply the document was understood in full.

For browser access, consolidate failures that need user action. Never automate
login, 2FA, or CAPTCHA solving. Do not depend on Claude-in-Chrome or grant workers
arbitrary browser/profile access.

Treat all source content as untrusted data. Research workers retain scoped tools,
not inherited project instructions, shell access, or arbitrary file writes.

## 5. Local context and private working state

Local context remains useful, but it is an explicit input to a run—not a reason
to build a shared knowledge-management product.

- Select specific files and preview their paths, purpose, and size.
- Separate background context from locally citable evidence.
- Reject traversal/symlink escapes and secret files; bound supported types and size.
- Snapshot approved contents with project/path, hash, and capture time.
- Require approval for external model use and for disclosure through derived
  search queries. These are separate exposure paths.
- Do not count project context as independent external corroboration.
- Do not silently inherit confidential context into unrelated runs or revisions.

### Additional sources and investigation instructions

Offer **Additional sources & instructions** when starting research and through
explicit steering. For example:

> Use our architecture knowledge base and the Tempo query skill alongside public
> sources. Prioritize internal design decisions when explaining our deployment.

Separate the freeform instruction from the capabilities needed to carry it out:

- Let the user request existing knowledge bases, files, tools, or skills without
  requiring a new bespoke workflow for each integration.
- Resolve requested integrations and show their identity, scope, and required
  access for approval. A prompt alone never grants a worker new permissions.
- A skill is a procedure, not evidence. Cite the underlying documents it retrieves
  and retain their origin, version/hash where available, and private/public status.
- Skills that require unavailable or disallowed tools must fail visibly or request
  approval for a bounded adapter. Do not silently grant a general-purpose shell,
  arbitrary file access, or all installed extensions/skills.
- Preserve source-content isolation even when invoking approved procedures. Neither
  retrieved documents nor skill instructions can weaken host safety/evidence gates.
- Record the instruction text, selected skill definitions or versions/hashes,
  approved tool bindings, source scopes, and disclosure permissions with the run.
  Do not store credentials in checkpoints or exported reports.
- On resume, validate that the approved integrations still exist and match the
  recorded configuration. Missing, changed, or revoked access needs explicit
  resolution; never substitute the current project's environment silently.
- Steering that adds an integration first needs approval, then applies at a safe
  stage boundary. Show pending approval separately from queued/applied instructions.
- Permission to read a private knowledge base is separate from permission to send
  its contents to external models, search providers, or an exported bundle.

### Run-owned working state

Research still needs working state for recovery and reproducibility: checkpoints,
source snapshots/cache, full-read coverage, audit findings, report revisions, and
cost records. This is operational state, not a user-managed brain.

The planned default is outside the package repository, under `~/.pi`:

```text
~/.pi/hyperresearch/
  runs/<run-id>/                  # Checkpoints, report, revisions, audits
  workspaces/<workspace-id>/      # Private source/cache/backend working files

<chosen-output-folder>/report.md  # User-controlled published copy
```

The repository contains code, shared web assets, and tests—not live runs. Its
ignored `artifacts/` directory contains development screenshots/previews and is
written by UI tests or explicit captures, not by each research run. Keep that
separate from report/checkpoint/evidence artifacts produced by research.

Project-local `.pi/hyperresearch.json` may select context and preferences; it does
not become the location of centrally stored results. Support an explicit data-root
override and private permissions. Centralizing paths does not authorize cross-run
or cross-project disclosure; preserve access boundaries in inventory and search.

This is a proposed logical layout. A composed backend may require its own internal
SQLite/config directories. Keep those implementation details private rather than
inventing a new source-store format or UI around them.

Resolve project context, run/workspace state, package files, and output destination
separately. Record stable paths so resume does not depend on the current working
directory or the package installation location. Serialize access where a composed
backend requires it; do not promise multi-writer safety from SQLite alone.

Keep working data until an explicit cleanup/retention policy applies. Distinguish
“exported report” from “reproducible run with preserved evidence.” Never silently
move or delete the existing checkout's vault during reload or an upgrade.

Provide an explicit migration with preview, source/destination locking, collision
checks, copy-and-validate staging, and rollback. Preserve the original until the
user explicitly removes it. Existing run IDs, citation mappings, source assets,
and revision relationships must survive; do not relocate a shared backend workspace
as though each run owned a separate copy.

### Central run identity and recovery

Resolve run IDs under the configured central run directory, independent of cwd.
Record originating project, workspace identity, timestamps, status, and parent
revision alongside the existing question/report/checkpoint data.

Opening, listing, searching, and exporting an existing run must not start workers
or incur model costs. Resume is an explicit action for a resumable run; revision
creates a new run from a completed report. Preserve the distinction between a
saved `running` status and a runner actually owned by the current session.

Resume uses the saved context and approved integrations. It must never silently
substitute files from the repository currently open in Pi. If credentials, models,
context, or configuration need changing, display the proposed changes and require
explicit approval before paid work resumes.

## 6. Report delivery and optional persistence

### Default: a portable report

A successful run produces Markdown with standard links or footnotes, a source
list, preserved LaTeX, and explicit limitations. Export must translate known
internal citation IDs through the recorded source map, not guess URLs or leave
unresolved vault-specific syntax behind.

Keep draft/unverified/stale status visible when exporting an incomplete result.
A successful file save is not a successful evidence audit.

Provide two simple delivery actions:

- **Export Markdown** in the live and offline dashboard: browser-managed download.
  This does not require an arbitrary filesystem-write endpoint; the dashboard can
  remain read-only with respect to the host's research state.
- **Save report…** in Pi: select an output path, validate it, confirm overwrites,
  and write atomically. Never interpret paths embedded in a report as destinations.

A browser may choose the download directory or offer “Save As” according to its
settings. Do not promise the page can write to any host folder without permission.
Browser file-picker support can be a progressive enhancement, not a requirement.

Export is a copy. The user's edited copy is not silently overwritten on resume.
Revisions get separate identity/output or explicit overwrite confirmation. Local
citations must be identified honestly; offer a portable evidence bundle only with
explicit approval to include local files or preserved source material.

### Optional: publish to an existing knowledge system

Lumbrera is a possible destination and existing-context source, not the research
backend by default. At reviewed commit
`e039869a5df9fde285f80473dbc9161bb1ee9375`, its CLI supplies managed Markdown,
immutable sources/assets, SQLite/FTS5 search, citation/path integrity checks, and
knowledge maintenance. It does not itself supply scholarly discovery, web/PDF
acquisition, or semantic citation-support auditing.

If publication is wanted later:

- Use its CLI boundary rather than editing managed files or its SQLite cache.
- Publish selected durable synthesis, not every checkpoint or generated draft.
- Respect its evidence kinds, citation syntax, generated metadata, and 400-body-line
  limit for notes/wiki pages. Long reports may remain standalone exports with
  selected smaller pages published separately.
- Do not store generated reports as immutable external evidence.
- Handle locking, retries, and partial publication explicitly. A failed publication
  must not destroy an otherwise completed research report.

No Lumbrera installation, brain initialization, storage migration, or automatic
publication belongs on the critical path for basic research and report delivery.

## 7. A small Pi surface

Keep one entry point:

- `/hyperresearch <question>` starts the normal workflow.
- `/hyperresearch` opens a searchable run picker with **New research** at the top.
- `/hyperresearch help` retains the current command documentation.
- The report view exposes inspect, revise, export, and save as appropriate.

The normal start surface shows question, optional context, proposed scope, and
cost ceiling. Provider details, role models, concurrency, and internal stage
numbers belong in advanced settings or inspectable run details.

### Pi run picker

List runs by question/title with status and date; show originating project and run
ID in the details. Support typing to filter, arrow-key navigation, Enter to open
run actions, and Escape to dismiss without touching the user's draft prompt.
Actions depend on status: View, Resume, Revise, Export, and Save report, plus
Steer/Pause/Cancel when this session owns an active run. Handle empty history,
missing workspaces, corrupt checkpoints, and externally owned runs explicitly.

Preserve direct commands such as `status <run-id>`, `dashboard <run-id>`,
`resume <run-id>`, and `revise <run-id> <feedback>` for automation and compatibility.
All resolve against central storage. Ordinary chat stays separate from steering;
show queued versus applied feedback. Opening a selection is read-only, not an
implicit resume.

### One shared web application

Keep the dashboard's fixed layout, CSS, and browser behavior in shared package
assets, separate from research data. They are authored application code, not
model-generated presentation. One application displays multiple investigations.

```text
<package>/web/                    # Shared shell, stylesheet, browser scripts
~/.pi/hyperresearch/runs/<id>/    # Per-run data, Markdown, checkpoints, audits
```

Load the selected run's data and receive updates for that run. Do not rewrite a
complete website, stylesheet, and script into every checkpoint. Generate a
self-contained HTML snapshot only on explicit export, embedding the shared assets
and selected data then so it works offline. Normal research still checkpoints data.
Use the same rendering/sanitization rules for live views and exports; preserve
math, safe citations, keyboard access, and reduced-motion behavior.

### Web inventory and cross-run search

Add a simple inventory page with recent runs, title/question, status, date, and
originating project. Select a run to open its report/progress and return to the
inventory without starting a different server or investigation. Run selection must
switch live subscriptions cleanly so late events cannot replace another run's view.

Provide two clearly named operations:

- **Filter runs:** match inventory metadata such as title, question, or project.
- **Search reports:** grep-like text search across all accessible runs or an explicit
  selection. Return run identity, a matching excerpt, and a line/location that opens
  the correct report. Keep this distinct from metadata filtering.

Start with directory enumeration, existing checkpoint metadata, and literal,
case-insensitive search over materialized Markdown reports. No new database,
vector index, embeddings, or model call is needed. Do not grep serialized
checkpoints containing entire reports as single escaped JSON lines. Source bodies,
private attachments, logs, and credentials are outside the default search scope.

Use either an in-process scan or a shell-free `rg` invocation with validated,
allowlisted report paths and literal query handling. Bound query length, file
sizes, scanned work, result count, excerpts, and execution time; support cancellation
and disclose truncated/partial results. Treat matches as untrusted text and escape
output. A file's deletion or an interrupted checkpoint must not crash the inventory.
Inventory metadata may be cached in memory; durable run data remains authoritative.

Search is retrieval, not a generated cross-run answer. If model-assisted comparison
is added later, require explicit run selection and the usual cost/disclosure
approval; never silently merge private contexts or present literal matches as a
verified synthesis.

Keep loopback binding, Host/Origin validation, and capability-token access. A central
inventory token exposes more than a single-run token: clearly disclose its scope,
filter all results to the authorized run set, and exclude inaccessible runs from
counts and snippets. Provide run-scoped access where sharing a single result is
needed. Never turn a requested run ID or search string into an arbitrary filesystem
path. Broader inventory access must be explicit, not an upgrade of an existing
single-run capability behind the user's back.

The web remains read-only for host research state. Download/export is browser-
managed; save-to-folder and paid-work controls remain in Pi. Dashboard actions must
not become a second independent orchestration implementation.

Use plain scope presets rather than exposing both upstream tiers and gears.
Recommendations cannot silently increase spending or start extended work. Keep
core safety rules unchanged and disclose audit coverage in every mode.

## 8. Delivery sequence

### M1 — Central runs, shared interface, and report delivery

Deliver in bounded slices: central path/identity resolution and explicit migration;
Pi run picker; shared web shell and inventory; grep-like report search; portable
Markdown/HTML export and save-to-folder. Keep the composed backend and existing run
compatibility; no knowledge-store rewrite is a prerequisite.

Acceptance: opening the same run from different projects preserves its context;
listing/viewing/searching starts no model work; inventory and direct commands agree;
run switching cannot mix events; web styles are shared rather than regenerated per
checkpoint; report search is bounded and respects access scope; portable citations
and math survive export; save confirms overwrites and failures preserve the run.
No arbitrary filesystem-write route is added to the dashboard.

### M2 — Broader scholarly investigation

Normalize discovery results and compose additional providers in small batches:
OpenAlex/Crossref improvements, then CORE/DOAB, then relevant specialist sources.

Acceptance: fixtures cover identifiers/versions, conservative deduplication, work
types, credentials, partial failures, cancellation, and rate limits. Approved
public-network checks verify adapters without launching model-driven research.
No new top-level command is required per provider.

### M3 — Better reading and user-supplied research capabilities

Improve full-text resolution and PDF acquisition diagnostics; compose browser,
OCR, or visual readers where justified. Add bounded local-context attachments and
Additional sources & instructions, with approved knowledge-base/tool/skill bindings.

Acceptance: scans and incomplete extractions cannot silently pass as complete
reads; provenance identifies the version actually read; access escalation stays
user-controlled; attachment/integration consent, exclusions, safe paths, definition
pinning, revoked access, snapshot recovery, and export privacy are tested. A skill
is never counted as evidence, and prompt text alone cannot grant capabilities.

### M4 — Deeper investigation and evidence auditing

Add structured contradiction/depth investigation, reconciliation, corpus critique,
and an evidence digest. Add claim-support and independence checks, targeted gap
fetches, bounded corrections, and re-auditing.

Acceptance: evaluation fixtures include unsupported claims, conflicting sources,
fabricated quotes, and syndicated copies. Findings and coverage are persisted;
unresolved evidence cannot disappear behind a generic “verified” label. A model
assessment is not a proof of truth. Cost exhaustion cannot silently skip review.

### M5 — Full and extended reports

Add multi-angle drafts, synthesis, the full critic suite, consistent register/depth
policies, and eventually chaptered investigation with global reconciliation.

Acceptance: each capability has scheduling, cancellation, recovery, and budget
tests. Chaptered work uses bounded contexts and chunked artifacts, not just higher
source/report limits. Post-draft corrections remain bounded; structural changes
require an explicit new pass/revision. Compare outcomes on approved research tasks
before making any upstream parity claim.

### M6 — Pure TypeScript Pi runtime (final phase)

Replace every retained Python research operation and the Python bridge with
TypeScript implementations or approved JavaScript/TypeScript libraries behind the
same discovery, acquisition, evidence, and run-state contracts. Remove Python,
uv, the Python virtual environment, and the upstream storage backend from the
installed package and normal setup. This is a research-capability migration, not
a rewrite of upstream's end-to-end knowledge product.

Before replacement, maintain a capability-by-capability parity matrix against the
pinned upstream revision: supported inputs and outputs, research stages, evidence
gates, provenance, failure modes, budgets, cancellation, and recovery. Explicitly
mark intentional exclusions (knowledge-base lifecycle, catalog/index/graph
maintenance, import/watch/MCP) and unverified or deferred research capabilities.
Use fixture/contract tests and approved comparative evaluations to establish
behavioral parity. Do not infer equivalence from matching tool or stage names.

Deliver adapters incrementally, running old and new implementations against the
same offline fixtures. Preserve report/citation IDs, source hashes and assets,
read coverage, audits, revision lineage, spend, and resumability. Provide explicit,
previewed, locked, reversible migration of Python-owned working state; originals
remain until explicitly removed. Do not require users to operate a storage server
or adopt a knowledge-management workflow.

Acceptance: installation and research/report workflows work with Python and uv
absent; package contents contain no Python runtime dependencies; tests cover all
retained research contracts and the parity matrix explains every difference.
Network/evaluation costs require explicit approval. Keep optional destinations
independent and avoid replacing one monolith with another TypeScript monolith.

### Optional follow-up — Publication integrations

Add a Lumbrera or other destination adapter only when users need it. Reuse its
capabilities rather than recreating a knowledge product inside Hyperresearch.

Acceptance: basic research remains usable without the integration; publication
respects the destination's contracts; failures do not invalidate completed runs.

## 9. Implementation checklist

All boxes below track planned work, not a claim that existing functionality is
absent. Keep regression coverage for the working light pipeline throughout.

### M1a — Central state and safe recovery

- [x] Introduce explicit project, package, data-root, and workspace paths;
      output destinations follow in M1d;
      remove ambient-cwd assumptions from run loading and backend operations.
- [x] Default new runs to `~/.pi/hyperresearch/runs/<id>` and working data to the
      configured external workspace root; keep live data out of the code repository.
- [x] Persist originating project, stable workspace references, context/approval
      references, and revision lineage; support old checkpoints explicitly.
- [x] Implement a filesystem-based inventory and central run-ID resolver; do not
      add an inventory database.
- [x] Add explicit migration preview, locks, staged copy/validation, collision
      refusal, rollback, and original-preservation behavior.
- [x] Test cwd-independent loading, missing/corrupt runs, shared workspaces,
      lock ownership, and interrupted migration (including a killed process).
- [x] Test relocated-package asset/backend resolution from import.meta.url,
      independently of central state and cwd.
- [x] Test that view/list never resume work or replace saved context.
- [x] Extend the no-work/no-context-replacement assertion to report search in M1c.

### M1b — Pi run picker

- [x] Open the picker for bare `/hyperresearch`; retain `/hyperresearch help` and
      direct commands for automation/non-interactive modes.
- [x] Add New research, recent-run rows, filtering, keyboard navigation, and details.
- [x] Expose status-appropriate actions with explicit confirmation of resumed paid
      work and proposed configuration changes (context changes remain unavailable).
      Export/save actions are implemented in M1d.
- [x] Test empty history, active/external/stale statuses, selection/cancel behavior,
      terminal widths, and preservation of the existing prompt.

### M1c — Shared web app, inventory, and grep-like search

- [x] Extract shared web shell/CSS/browser code and package those assets once.
- [x] Serve central inventory and selected-run views through one read-only app;
      stop writing full `dashboard.html` files at every checkpoint.
- [x] Switch selected-run subscriptions safely; ignore stale events from previous
      selections and show connection/ownership status honestly.
- [x] Add metadata filtering and literal report-content search with run identity,
      escaped snippets, match locations, and explicit search scope.
- [x] Bound scan work, input/output sizes, time, and result counts; add cancellation,
      partial-result indicators, and useful empty/error states.
- [x] Define inventory-scoped versus run-scoped access and filter all metadata,
      counts, reports, and matches accordingly; expose no arbitrary file routes.
- [x] Test run switching, reconnect, mobile/keyboard use, reduced motion, hostile
      report text/queries, path traversal, inaccessible runs, and changing files.
- [x] Assert that searches make no model calls or external network requests.

### M1d — Portable report delivery

- [x] Export known internal citations as standard Markdown links/footnotes, retain
      LaTeX, source provenance, and draft/stale/verification limitations.
- [x] Add dashboard Export Markdown and explicit self-contained HTML export using
      the shared assets; support Markdown download from exported HTML too.
- [x] Add Pi Save report… with safe path handling, overwrite confirmation, atomic
      writes, and separate revision outputs.
- [x] Exclude local evidence/private attachments from current exports and label
      nonportable local references. Approved evidence bundles remain deferred until
      local-file/integration consent is implemented in M3.
- [x] Test offline exports, links/math, malicious markup, save failures, overwrite
      refusal, and preservation of user-edited exported copies.

### M2 — Scholarly investigation

- [x] Define the normalized discovery result and provider-capability contract.
- [x] Consolidate OpenAlex/Crossref results with version-aware, conservative
      deduplication and complete provider provenance.
- [x] Integrate CORE/DOAB through existing adapters where suitable.
- [x] Integrate ClinicalTrials.gov, EDGAR, and FRED for relevant questions with
      required credentials/contact configuration; document RePEc's search gap.
- [x] Add approved OpenAlex/Crossref discovery routing, versioned full-text
      candidates, courtesy limits, caching, deadlines, cancellation, and visible
      partial failures; persist batches without counting metadata as full reads.
- [x] Extend routing/resolution and credentials contracts to additional providers
      and Python-composed acquisition/resolver operations. Recovery defaults off;
      retraction metadata cannot silently fall back to Semantic Scholar.
- [x] Test work-type distinctions, missing credentials, false merges, retractions,
      incomplete results, and the rule that abstracts/snippets are not full reads.
- [ ] Run explicitly approved adapter smoke tests and document actual coverage;
      preserve the configured web-provider/no-fallback behavior.

### M3a — Reading and local files

- [x] Record extraction diagnostics, acquired versions, preserved-byte hashes and
      physical PDF page spans; incomplete or inaccessible evidence is explicit.
      Text-only readers cannot clear configured visual-reading requirements.
- [x] Add representative PDF fixtures for scans, columns, tables, equations, and
      missing text. No OCR/visual/browser adapter is currently approved or invoked;
      absence remains a visible capability gap, not a successful visual read.
- [ ] Add user-controlled access escalation without login/CAPTCHA/2FA automation.
- [x] Add local-file selection/preview, purpose labels, limits, secret exclusions,
      path protection, immutable run snapshots, and locally citable source records.
      Local quote-gate views are temporary, journaled and removed before searches.
- [x] Test separate model/search/export disclosure consent, snapshot reuse, changed
      selection refusal, cross-project isolation, revocation, local citations and
      export restrictions. Refresh uses a new run/approval rather than replacing
      evidence already used by an existing report.

### M3b — Additional sources & instructions

- [x] Add the optional instruction field to starts and explicitly approved,
      paused-run context steering. Ordinary chat still cannot steer workers.
- [x] Resolve selected reader/skill adapter IDs into explicit capability proposals;
      missing/unavailable adapters fail before model work. No natural-language
      request grants ambient skills or tools. INTEGRATIONS.md documents binding
      existing systems and the shipped explicit-file-collection reader.
- [x] Bind only approved scoped tools/procedures to isolated workers; no ambient
      skill/extension loading or unrestricted shell/file access.
- [x] Save instruction text, skill definition/version/hash, integration scope,
      approval records, and credential references—not secret values—with the run.
- [x] Track retrieved documents as evidence with origin, version/hash, declared
      completeness and privacy; procedures are not evidence and metadata queries
      do not establish complete reads. Internal context is not public corroboration.
- [x] Show pending approval separately from queued/applied steering. Context changes
      require pausing; approval queues a replan for explicit resume. Grants and
      parent checkpoints preserve the audit trail; revisions require new grants.
- [x] Test malicious source/skill instructions, missing or changed bindings, revoked
      permissions, resume from another project, partial documents, cancellation,
      immutable captures and external-disclosure boundaries. Production adapters
      still require their own scope/transport contract tests and explicit approval.

### M4 — Investigation depth and auditing

- [x] Add tested host-side audit foundations: exact raw-text passage proofs after
      hash-matched complete reads, bounded prose-block coverage, explicit unresolved
      findings, and conservative content/URL/DOI/near-copy relationship signals.
      Async result validation is awaited before accepting worker output. These
      helpers are not yet scheduled research stages or a semantic parity result.
- [x] Implement the composable bounded audit/correction loop with a versioned
      journal, complete reassessment after patches, original finding retention,
      saved-proof revalidation, and checkpoint/pause/budget fixtures. Its host must
      atomically save report, costs and journal; production runner wiring remains.
- [ ] Add contradiction mapping, bounded depth tasks, reconciliation, and a
      structured evidence digest with traceable claims and exact passages.
- [ ] Add corpus critique, targeted gap retrieval, and source-independence analysis.
- [ ] Add claim-to-source support checks, persisted coverage/findings, bounded
      correction passes, and re-auditing of affected claims.
- [ ] Evaluate unsupported claims, fabricated quotes, contradictions, and syndicated
      evidence; disclose limits and preserve unresolved findings at the ship gate.
- [ ] Test pause/resume, cancellation, costs, and failures across every added stage;
      never silently skip required review after budget exhaustion.

### M5 — Full and extended reports

- [ ] Add multi-angle drafting/synthesis and the dialectic/depth/width/instruction
      critics behind plain scope presets, not new user-operated agent commands.
- [ ] Apply register/depth preferences consistently without weakening evidence rules.
- [ ] Escalate structural rewrites to explicit passes/revisions; retain bounded
      post-draft patches and preserved originals.
- [ ] Add chaptered planning, bounded chapter contexts/artifacts, recovery, budgets,
      global reconciliation, and final report assembly.
- [ ] Run approved comparative evaluations before claiming upstream research parity.

### M6 — Pure TypeScript migration and research parity

- [x] Start PARITY.md against pinned upstream research behavior; maintain it as
      capabilities are replaced (this is not a parity claim).
- [ ] Complete the operation-level parity audit and comparative evaluation;
      classify supported, partial, deferred, unverified, and intentionally excluded
      capabilities, with evidence and tests for each retained contract.
- [ ] Replace Python discovery/acquisition/readers with composable TypeScript
      adapters, including PDF extraction and full-text recovery; compare fixtures.
- [ ] Replace Python orchestration/verification operations still used by Pi without
      weakening evidence, cancellation, budget, or recovery gates.
- [ ] Remove the upstream storage dependency; retain minimal private run/evidence
      state behind contracts, not upstream knowledge-base workflows.
- [ ] Migrate preserved Python-owned state explicitly with preview, locks,
      validation, collision refusal, rollback, and original preservation.
- [ ] Remove bridge, uv/setup, virtual environment, Python packaging and runtime
      dependencies only after replacement contracts pass regression tests.
- [ ] Verify clean install, research, resume, revise, inspect, search, and exports
      in an environment without Python or uv; run approved parity evaluations.

### Optional publication

- [ ] Add a destination adapter only when needed, respecting its CLI/write, evidence,
      citation, size, and locking contracts; do not rebuild its storage/index layer.
- [ ] Make publication explicit and retryable without damaging the completed report;
      test that research/export works without any knowledge-base installation.

## Next implementation slice

**M1a–M1d are implemented and tested.** One existing checkout-local run was copied
to central storage with its originals preserved. **M2's OpenAlex/Crossref batch**
now uses normalized TypeScript discovery independently of the Python working-state
adapter. CORE/DOAB and ClinicalTrials.gov/EDGAR/FRED now have opt-in, evidence-kind
routing and offline fixtures; public-network validation remains unperformed.
Continue with explicit resolver approval and M3 acquisition/context contracts.
The important remaining work is better research and reports—not a new database or central vault manager. Finish with M6's pure
TypeScript migration once the research contracts and parity evidence are in place;
do not port out-of-scope knowledge-base features merely because upstream has them.

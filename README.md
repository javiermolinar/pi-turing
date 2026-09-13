# pi-hyperresearch

An experimental Pi-native adaptation of [Hyperresearch](https://github.com/jordan-gibbs/hyperresearch)'s
research capabilities. The **light pipeline** runs today, with central private
working state, a Pi run picker, and a read-only web application. The Python backend
is a temporary adapter, not the product's storage architecture. The final planned
phase replaces it with TypeScript; upstream knowledge-base workflows stay out of scope.

**Implemented:** decompose → parallel width sweep → single draft → bounded polish
→ readability audit → verification. Upstream stage numbers (1, 2, 10, 15, 16) are
preserved in the dashboard and backend manifest.

**Not implemented:** full adversarial pipeline, dissertation runs, authenticated
browser access, Playwright retrieval, independent citation-sentence checking,
or upstream benchmark parity. Do not mistake a passing structural gate for proof
that a report is factually correct.

## Roadmap

See [PLAN.md](PLAN.md) for first-class investigation, broader scholarly discovery,
full-text/PDF reading, local context, and portable report delivery behind a smaller
Pi interface. Storage is composed, with optional destinations such as Lumbrera—not
a separate knowledge product to rebuild. Central runs, explicit migration, Pi/web
selection, literal report search, shared web assets, and portable exports are now
implemented. Broader scholarly investigation, approved context/integrations,
deeper research, and the final Python-to-TypeScript migration remain on the roadmap.
Research parity is a target, not an established result. [PARITY.md](PARITY.md)
tracks retained contracts, intentional exclusions, tests, and unverified differences.

## Try it

Requires Node 22+, a current Pi SDK (tested with 0.85.1), `uv`, and a configured Pi
model. Default web search also requires `BRAVE_SEARCH_API_KEY` in Pi's environment;
explicitly choose DuckDuckGo below for keyless search. Backend setup uses Python
3.13; uv can obtain it if missing.

From this checkout:

```bash
npm install --ignore-scripts
pi -e ./extensions/index.ts
```

Inside Pi, in a trusted project:

```text
/hyperresearch setup
/hyperresearch start Compare SQLite and PostgreSQL for a small local research vault.
/hyperresearch dashboard
```

Or install the local package (adds both the extension and skill), then restart Pi:

```bash
pi install /absolute/path/to/pi-hyperesearch
```

`setup` installs a lockfile-pinned Python environment under `backend/.venv/`.
It does not install Claude Code skills, modify `CLAUDE.md`, or start a browser.
The upstream dependency currently pulls in Crawl4AI even though this port uses
its static/PDF fetcher, so this test backend is relatively large (~600 MB here).
The environment is not included in the package tarball.

### Costs and discovery

By default all workers use the model and thinking level selected in Pi when the
run starts. The default ceiling is **approximately $15 in catalog-priced model
usage**. It is checked when usage arrives, not before billing: in-flight calls
can overshoot, and interrupted calls can have incomplete usage. Use provider-side
limits for a hard financial cap. Search-provider fees are not included.

Default web search calls **Brave Search's official API directly from Node**,
using `BRAVE_SEARCH_API_KEY` in the request header, never in the URL or saved
configuration. Missing keys fail before research starts. Brave API fees are
separate from the model-cost ceiling.

For a keyless option, explicitly choose **DuckDuckGo**. The Node adapter parses
`html.duckduckgo.com` results; it does not use the Instant Answer API, a search
aggregator, browser cookies, or an unofficial multi-engine client. This HTML
interface is less reliable: challenges and layout changes are reported as errors.
A live smoke check returned a CAPTCHA; the adapter refuses to bypass it.

**There is no automatic provider fallback.** Parallel and Serply are disabled,
and web searches no longer pass through Hyperresearch's search providers.
Scholarly discovery uses composable TypeScript adapters, independently of the backend.
Search queries leave your machine for the selected service; source bodies and
your research query are sent to the selected models.

A run normally needs at least 10 complete source reads and targets 15 sources.
Static/PDF fetch failures remain visible; browser-dependent pages cannot yet be
retrieved through this port. Approved backend resolvers retain open-access recovery and acquired-version
provenance. PDF diagnostics inspect preserved bytes, hash assets, retain physical
page numbers, and reject scans, sparse/missing pages, or failed text mapping as
complete reads. Text extraction does not verify columns, tables, figures, or math.
Set `readingRequirements` to any of `layout`, `tables`, `figures`, `equations` to
require those capabilities; the current text-only reader cannot clear them. No
OCR, visual model, login, CAPTCHA, or browser fallback runs automatically.

## Commands

| Command | Behavior |
| --- | --- |
| `/hyperresearch start <question>` | Start light research; a bare question also works |
| `/hyperresearch status [tag]` | Show persisted progress and queued/applied feedback |
| `/hyperresearch steer <feedback>` | Queue feedback for the active or selected paused/failed/blocked run |
| `/hyperresearch revise <tag> <feedback>` | Start a new revision of a completed report; preserve its parent |
| `/hyperresearch pause` | Abort active workers safely and preserve artifacts |
| `/hyperresearch resume [tag]` | Restart the first incomplete stage; defaults to the latest selected run |
| `/hyperresearch cancel` | Abort the run; artifacts remain, but cancelled runs cannot resume |
| `/hyperresearch dashboard [tag]` | Start/reuse a localhost dashboard and open it |
| `/hyperresearch snapshot [tag]` | Open the self-contained offline HTML |
| `/hyperresearch setup` | Install the pinned Python backend |

Pi also gets a `hyperresearch_run` tool for explicit research requests. It waits
for completion and returns artifact paths, not a giant report in the parent
context. Tool cancellation pauses the run. In print/JSON mode, the slash command
waits for the runner instead of leaving an orphaned background task. JSON mode
emits `hyperresearch_status` JSONL records for extension status messages.

## Interacting and iterating

The Pi prompt stays unlocked. Start with the slash command for background research;
ordinary chat does **not** change worker instructions. Pi gets a small status
context so it can answer progress questions or read the checkpoint/report. The
`hyperresearch_run` tool still waits for completion, so chat submitted during that
tool call follows Pi's usual message-queue behavior.

The widget animates only a run owned by this session. It shows the current stage,
source-read target, live worker count, cost, activity, and queued/applied feedback.
Activity timestamps come from stage/worker events, including throttled streaming
updates—not checkpoint heartbeats. A spinner means the local runner is active,
not that a remote model is making progress. Paused/completed/saved runs are static.
The web dashboard also stops animation on disconnect and respects reduced motion.

- **Ask:** chat normally about progress or findings. No implicit steering occurs.
- **Steer:** `/hyperresearch steer Prioritize primary sources`. Current workers
  finish their stage; feedback is then checkpointed as applied and **all stages
  replan**. Existing sources can be reread, but decomposition, research summaries,
  draft, polish, readability and verification run again. This conservative policy
  handles evidence/scope changes instead of leaving them to a polish-only pass.
  Source caps and cumulative cost ceilings do not reset. Feedback during
  verification triggers another pass rather than being silently dropped.
- **Pause first:** `/hyperresearch pause` waits for cancellation. Submit steering
  while paused, then `/hyperresearch resume`. Queued feedback survives reloads and
  failures. Another process's vault lock prevents competing edits.
- **Revise a completed report:** `/hyperresearch revise <tag> Expand the limitations`.
  This creates a new tag with a snapshot of the parent report, source IDs, and
  inherited steering. The parent report/checkpoint remain unchanged. The new run
  rereads evidence and reruns all gates with its **own fresh cost ceiling**; it is
  not a cheap patch-only edit or an automatic increase to the parent's budget.

“Applied” means feedback is included in worker instructions, **not** that its
fulfillment has been verified. Feedback is chronological; later instructions
supersede conflicts, but cannot bypass evidence, patch, tool or budget rules.
There are at most 20 feedback entries of 4,000 characters per run. Superseded
in-progress drafts are archived as `draft-before-feedback-<id>.md` in the run
directory and remain visibly stale in the preview until a replacement is written.

## Configuration

Create `.pi/hyperresearch.json` in the trusted working directory. Unknown keys
are rejected.

```json
{
  "searchProvider": "brave",
  "concurrency": 2,
  "sourceTarget": 15,
  "maxTurns": 80,
  "workerTimeoutSeconds": 1800,
  "budgetUsd": 15,
  "models": {}
}
```

- `searchProvider`: `brave` (default; requires `BRAVE_SEARCH_API_KEY`) or
  `duckduckgo` (keyless HTML search, subject to throttling/CAPTCHAs). No fallback
  occurs on missing keys, failures, or empty results. Fetching still uses the
  backend's `builtin` HTTP/PDF provider.
- `concurrency`: 1–4 research workers. Backend operations are serialized to avoid
  conflicting vault mutations; model calls can run concurrently.
- `sourceTarget`: 10–30, and at least the backend light profile's minimum.
- `maxTurns`: 5–150 **per worker**. `workerTimeoutSeconds`: 30–7200.
- `budgetUsd`: positive number, or `null` to explicitly disable the estimate
  ceiling. Models with unknown/zero catalog prices require `null`.
- `models`: optional overrides for `decompose`, `research`, `draft`, `polish`,
  and `readability`, each an exact `provider/model-id` available in Pi. Omitted
  roles inherit the run's original model. Pi provider credentials are reused;
  never put credentials in this file.

For DuckDuckGo, the minimal configuration is:

```json
{ "searchProvider": "duckduckgo" }
```

Resume uses the saved configuration, originating project, model, and workspace,
not the currently open project's configuration or files. UI starts/resumes require
cost confirmation. Completed stages are not repeated, except that a failed
verification can trigger another bounded polish/readability pass. Use `resume <tag> --use-project-config` to explicitly propose the current project's
preferences (including budget/provider changes); Pi shows the previous and proposed
configuration for confirmation. Saved context and the default model stay pinned.

After upgrading from the Parallel/Serply version, **pause active runs and reload
Pi**. Replace those provider names in `.pi/hyperresearch.json`; they are no longer
accepted for execution. Old checkpoints remain readable for status and dashboard
views. Legacy providers cannot execute and are never replaced silently. Existing
checkout-local artifacts require explicit migration before central resume.

## Scholarly discovery

One `scholar_search` capability composes TypeScript OpenAlex, Crossref, CORE, DOAB,
ClinicalTrials.gov, SEC EDGAR and FRED adapters independently of Python or storage.
`scholarlyProviders` defaults to `["openalex", "crossref"]`; additional providers
require explicit configuration and start/resume approval. An empty list disables
discovery. Workers select an evidence kind (`literature`, `book`, `trial`, `filing`,
`series`) within that allowlist. Unselected and unavailable services stay visible.
CORE requires `CORE_API_KEY`; FRED requires `FRED_API_KEY`; EDGAR requires
`HYPERRESEARCH_CONTACT_EMAIL` in its identifying User-Agent. Credentials are never
persisted in results or logs; FRED's required query key is used only in the request.
RePEc has no usable upstream search API here and is not an enabled adapter. Optional
`HYPERRESEARCH_CONTACT_EMAIL` supplies the providers' courtesy contact parameter.
Full-text recovery has a separate `fullTextResolvers` allowlist (default `[]`):
`unpaywall`, `europepmc`, and `core`. Unpaywall needs
`HYPERRESEARCH_CONTACT_EMAIL`; CORE needs `CORE_API_KEY`. Missing credentials are
reported, not substituted from another provider. Resolver availability is not a
successful extraction. The temporary retraction gate requires approved OpenAlex;
its upstream Semantic Scholar fallback is disabled. No resolver is enabled by
merely selecting a discovery provider.

Results retain identifiers/DOIs, authors/dates, work type, version-aware full-text
candidates, provider-specific citation counts, retraction/correction notices and
provenance. Stable identifiers deduplicate compatible records; uncertain
bibliographic matches and distinct versions stay explicit. Provider relevance
ranks are interleaved, not replaced by citation-count ranking. Abstracts never count
as full-read evidence. Batches and provider failures persist with the run and appear
in dashboard coverage; source acquisition/reading remains a separate operation.

Requests use fixed endpoints, no redirects/cookies, a ten-second provider deadline,
2 MB response cap, five records/provider, per-provider serialization/courtesy delay,
a private five-minute cache and bounded output. Rate limits do not trigger another
provider. Offline fixtures pass; public-network adapter smoke tests and comparative
research evaluation have not been performed. New provider defaults have not been
enabled, and no live provider requests were made during this implementation.

## Run picker

Bare `/hyperresearch` opens saved investigations with **New research** first.
Type to filter by question, project or run ID; arrows navigate, Enter opens actions,
and Escape dismisses without replacing the draft prompt. RPC uses native selection;
print/JSON modes list metadata without starting work. `/hyperresearch list` also
lists central runs directly, and `/hyperresearch help` retains command documentation.

View is read-only. Resume and Revise require explicit cost confirmation in the UI.
Steer/Pause/Cancel appear only for this session's active runner. Saved `running`
status is not ownership; external writer locks and missing workspaces disable paid
actions. Corrupt checkpoints remain visible as unavailable entries. Drafts and
completed reports expose Export Markdown and Save report… without starting workers.

## Dashboard

`/hyperresearch dashboard` starts a small Node HTTP server **only when requested**:

- Binds to `127.0.0.1` on a random port, behind a random per-server URL token.
- Serves shared package assets, scoped run views and SSE; no arbitrary filesystem
  routes, write endpoints, CORS access, frontend framework, or build pipeline.
- Updates pipeline, worker activity, sources, failures, cost estimates, and checks.
- Reconnects after a dropped connection and displays the last snapshot when offline.
- Stops on extension reload, session replacement, or Pi exit.

The shared application lives in `web/`. Checkpoints write data, not a website.
`/hyperresearch snapshot <tag>` explicitly generates a self-contained HTML copy
that works under `file://` without external requests. Live and offline pages use
the same renderer/sanitizer and restrictive CSP. No remote images are loaded.

`/hyperresearch dashboard all` opens a separate, explicitly approved inventory
capability covering all accessible central investigations. Existing run-scoped
tokens never gain broader access. Run selection switches subscriptions and rejects
late events; saved external state refreshes without claiming runner ownership.

**Filter runs** matches metadata. **Search reports** performs literal,
case-insensitive search over accessible `report.md` files, not checkpoints, source
bodies, attachments or credentials. Results show run IDs, excerpts and Markdown
line context. No models, embeddings, database or external requests are involved.
Search is cancellable and discloses partial results: defaults are 40 matches,
1 MB per report, 16 MB scanned and two seconds, with at most two concurrent searches.
Inventory enumeration is bounded to 1,000 entries, 32 MB and one second per scan.

Report citations (`[[source-id]]`, including aliases and fragments) link to the
recorded source URL. Citation numbers match the Sources table. Known vault-note
Markdown links resolve to source URLs; missing citations and unresolved or unsafe
links are visibly marked rather than sent to nonexistent dashboard routes. Links
can still fail if the external site removes a page or restricts access.

Equations in `\\(...\\)`, `\\[...\\]`, `$...$`, and `$$...$$` render through
KaTeX to native MathML before Markdown processing. This works offline in current
Chrome, Firefox, and Safari without scripts, web fonts, or a CDN. Code blocks
remain literal; invalid or oversized equations retain their original TeX with a
warning. The saved Markdown report is unchanged and needs a math/wiki-link-aware
viewer when opened outside the dashboard.

The token URL is a local capability: anyone with it while the server is running
can read that run. Snapshots contain research queries, URLs and report content;
review them before sharing.

## Portable delivery

The web report offers **Export Markdown** and **Export HTML**. Downloads are
browser-managed; the web server never writes to an arbitrary host path. Exported
HTML embeds the shared application and selected report, works offline, and can
also download its embedded Markdown without a server.

Known wiki citations and source-note links become standard Markdown links through
the saved source map. LaTeX and code remain intact. Unknown, unsafe and local
references are marked rather than assigned guessed URLs. Local source material,
attachments and remote images are not bundled. Draft/stale status and light-mode
audit limitations remain visible; review report content for sensitivity before sharing.

In Pi, select **Save report…**, or use a literal path (spaces allowed; no shell quoting):

```text
/hyperresearch save <tag> /chosen/folder/report.md
/hyperresearch export <tag>       # Open browser-managed Markdown download
```

The folder must exist. Saves refuse symlinks, managed run state and protected paths.
Existing files need overwrite confirmation; noninteractive commands require
`save --overwrite <tag> <path.md>`. Writes publish atomically and refuse targets
changed since approval. Resume never updates the exported copy. New revision IDs
produce distinct suggested filenames; choosing the same destination still requires
explicit overwrite approval.

## State and recovery

```text
~/.pi/hyperresearch/             # Override: HYPERRESEARCH_DATA_ROOT (absolute)
  runs/<tag>/
    pi-state.json                # Authoritative scheduler, identity and report
    report.md                    # Materialized Markdown, not a user-edited export
    prompt-decomposition.json
    polish-log.json
    readability-decisions.json
    dashboard.html               # Created only by explicit snapshot export
  workspaces/<workspace-id>/      # Private, replaceable Python adapter state
    .hyperresearch/              # Temporary backend config/SQLite
    research/                    # Evidence/assets and backend materialized views

<project>/.pi/hyperresearch.json  # New-run preferences, never central results
```

`pi-state.json` owns scheduling, cost, worker records, and the report body. The
other Pi-generated files are materialized from it. **Do not manually edit the
materialized report and expect resume to preserve it.** Backend CLI spend counters
are not the Pi cost ledger; use the Pi dashboard/state.

Pause interrupts workers immediately; resume starts a fresh worker at the first
incomplete stage. Already saved source notes remain available. This is
**stage-level recovery**, not continuation of an interrupted model conversation.
A crashed Pi session never auto-resumes paid work.

New investigations have separate workspaces; revisions reuse their parent's
workspace explicitly. Saved location and empty context/approval references make
cross-project recovery independent of cwd. Legacy checkpoints remain readable;
missing/corrupt checkpoints are reported by the filesystem inventory. Merely
opening or listing runs performs no research. Unrelated runs are not injected into
chat automatically. New state directories/files use private permissions.

Only one runner may mutate a data root through this port at a time. A heartbeat lock
rejects other Pi runners and becomes reclaimable after roughly 30 seconds without
a heartbeat. Avoid running the upstream CLI's mutating commands concurrently;
it does not participate in that lock. One interrupted source fetch may leave
backend artifacts requiring inspection.

### Migrate checkout-local runs

Stop active Pi research and upstream CLI writers first. Migration never runs on
reload or startup and never deletes the original checkout's data.

```text
/hyperresearch migrate                 # Preview current checkout -> central root
/hyperresearch migrate apply           # Lock, copy, hash-validate, publish
/hyperresearch migrate rollback <id>   # Refuses copies changed since migration
```

For development/automation:

```sh
npm run migrate -- --source /absolute/checkout
npm run migrate -- --source /absolute/checkout --apply
npm run migrate -- --rollback <migration-id> --apply
```

Use `--data-root /absolute/path` or `HYPERRESEARCH_DATA_ROOT` for an override.
Migration preserves run IDs, source/assets, archived drafts and revision lineage;
a shared legacy workspace is copied once, not once per run. Symlinks, collisions,
oversized inputs, and nonempty SQLite WAL files are refused. Checkpoints become
visible only after all copies publish. An interrupted operation retains a journal
under `migrations/`; after stale locks expire, explicit rollback removes only
unchanged destinations so a fresh preview/apply can retry. The copy deadline is
five minutes; limits are 100,000 files and 5 GB per source tree, 1 GB per file.
Migration receipts contain hashes and paths, not credentials. Originals and copies
are independent after migration; do not resume both expecting synchronization.

## Enforcement and limitations

Workers get only scoped research tools and a validated result-submission tool.
They do not inherit project/global extensions, AGENTS.md, shell access, arbitrary
file reads, or write/edit tools. This is capability restriction, not an OS sandbox.

- The runner enforces stage order and waits for all workers to settle on failure.
- Source reads are paginated and tracked for complete coverage, not inferred from
  fetch counts. Draft workers must read every source they cite themselves.
- Citations use `[[note-id]]`, and must reference known, completely read notes.
- After drafting, each patch pass permits at most 8 unique, non-overlapping hunks,
  each side ≤800 characters, with a cumulative changed-span cap of 15% per pass.
  Polish cannot introduce new source citations.
- The upstream final gate checks report structure, word range, citation density,
  quote integrity, retracted citations, and required light-tier artifacts. Rate-
  limited retraction sweeps block completion; missing DOI records remain explicitly
  unknown, not cleared.
- No independence audit or semantic citation audit runs in light mode. Source
  quantity, successful fetching, and a passing gate are not measures of truth.
- Backend HTTP egress inherits upstream's public-address/redirect checks and
  documented residual DNS-rebinding risk. Use network isolation for hostile input.

## Development and tests

```bash
npm run typecheck
npm test
npm run test:backend
npm run test:browser
```

`test:backend` uses `uv run --locked` and temporary vaults. `test:browser` requires a
Playwright Chromium installation (`npx playwright install chromium` if absent),
starts a temporary localhost server, and verifies SSE updates, offline rendering,
source filtering, mobile layout, and HTML-injection defenses. Screenshots land in
`artifacts/`. Playwright is currently a **test dependency**, not the research fetcher.

Tests use deterministic source/model fixtures, including a real Pi SDK worker
against a local mock model endpoint. They do not establish live research quality
or upstream benchmark parity. No paid research runs are part of the test suite.

Architecture: `runner.ts` (workflow), `worker.ts` (Pi SDK), `search.ts` (direct
Brave/DuckDuckGo search), `backend.ts` + `backend/bridge.py` (replaceable backend),
`store.ts` (checkpoints), `dashboard.ts` (shared HTML), `server.ts` (read-only
HTTP/SSE).

Upstream: [jordan-gibbs/hyperresearch](https://github.com/jordan-gibbs/hyperresearch),
pinned at `75b1ecfb2891184fad2cc1a2ddf9abe476f5b54c`. MIT; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

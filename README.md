# Turing

[![CI](https://github.com/javiermolinar/pi-turing/actions/workflows/ci.yml/badge.svg)](https://github.com/javiermolinar/pi-turing/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/javiermolinar/pi-turing?color=356451)](https://github.com/javiermolinar/pi-turing/releases)
[![npm](https://img.shields.io/npm/v/pi-turing?color=356451)](https://www.npmjs.com/package/pi-turing)
[![Pi package](https://img.shields.io/badge/Pi-package-356451)](https://pi.dev)
[![Node.js 22.13+](https://img.shields.io/badge/Node.js-22.13%2B-356451?logo=nodedotjs&logoColor=white)](#install-in-pi)
[![MIT license](https://img.shields.io/badge/license-MIT-596359)](LICENSE)
[![Experimental](https://img.shields.io/badge/status-experimental-9a6700)](#what-is-it)

![Pi Turing — Crack the enigma with deeper research inside Pi.](https://raw.githubusercontent.com/javiermolinar/pi-turing/master/assets/turing-hero.jpg)

> "We can only see a short distance ahead, but we can see plenty there that needs to be done."
>
> — Alan Turing

Turing (`pi-turing`) is a research workspace for [Pi](https://pi.dev), inspired by [Hyperresearch](https://github.com/jordan-gibbs/hyperresearch) by Jordan Gibbs.

## What is it?

A research toolkit that searches the web and scholarly literature, reads sources, and turns your question into a report with citations. It uses the model you select in Pi.


- **Native TypeScript.** Runs directly in Pi on Node.js.
- **Choose your sources.** Web search through DuckDuckGo, Brave, Tavily, Serply, or Kagi, plus scholarly discovery through OpenAlex, Crossref, and opt-in specialist providers.
- **Keep working.** Start research in the background without locking your Pi prompt.
- **Follow the work.** See progress, sources, and estimated cost in a live dashboard.
- **Change direction.** Steer a running investigation, pause and resume, or revise a finished report.
- **Take the report with you.** Export Markdown or self-contained HTML you can read offline.

```text
Decompose → Research → Draft → Review → Repair → Polish → Readability → Assess → Check
```

Experimental. Reports can contain factual errors; citations, model assessments and automated checks are not a guarantee of accuracy.

### Review and final assessment

New investigations include a substantive post-draft review, at most one bounded repair pass, and a read-only assessment of the final report. Reviewers use the original question, applied steering, approved context and collected sources—not just the research plan. They cannot run additional searches. Repair is skipped without model work when the review identifies no actionable issues.

The main metrics row includes a clickable **Assessment** summary: Needs attention, Partially assessed, or No issues found, with addressed-requirement and checked-claim counts. Pending, Not assessed and Stale are explicit states. This is derived from the saved final assessment, not a numerical accuracy score; clicking opens the detailed findings.

The dashboard and exports show separate judgments:

- **Answer coverage:** each requirement receives 0 (missing), 1 (partial), or 2 (addressed, including a justified explanation of evidence limits). Overall coverage is Complete, Partial or Incomplete; central omissions cannot be averaged away.
- **Constraint fit, reasoning and evidence support:** Pass, Needs attention or Not assessed, with explanations and report passages. Source support covers up to 12 selected claims, using sources fully read by that reviewer. It is not a full citation audit.

Final findings remain visible; they do not start another repair loop or masquerade as factual-verification gates. Assessments are tied to the report and source versions they examined. All workers share the existing model-cost ceiling; incomplete assessment work cannot be marked complete. Optional `models.review`, `models.repair` and `models.assess` overrides use the same provider/model format as other roles.

Existing saved investigations keep their original stages and spending scope. Their missing assessments display as **Not assessed**, not as passes. An explicitly approved new revision uses the new workflow.

## Install in Pi

Requires **Node.js 22.13+** and **[Pi](https://pi.dev) with a configured model**.

Install from npm:

```bash
pi install npm:pi-turing
```

Or use the installer (requires `pi` on your PATH):

```bash
npx pi-turing
```

The installer delegates to `pi install npm:pi-turing`, so Pi manages the package and its dependencies.

GitHub installation is also supported:

```bash
pi install https://github.com/javiermolinar/pi-turing.git
```

Pi installs the package and its dependencies.

### Update

Pause any active research, then run:

```bash
pi update npm:pi-turing
```

For a GitHub installation, use `pi update https://github.com/javiermolinar/pi-turing.git` instead.

Saved investigations remain intact.

To switch from GitHub to npm, pause research, run `pi list`, and remove the Git source with `pi remove <source>` before installing from npm. Do not keep both installations enabled.

### Remove

```bash
pi remove npm:pi-turing
# Or: npx pi-turing --remove
```

Saved investigations are not deleted.

<details>
<summary>Upgrading from pi-hyperresearch</summary>

No data migration is needed. `/hyperresearch` remains an alias for `/turing`; the tool is now `turing_run`. Use `.pi/turing.json` for new configuration; `.pi/hyperresearch.json` still works when the new file is absent. Storage remains at `~/.pi/hyperresearch`. `TURING_DATA_ROOT` and `TURING_CONTACT_EMAIL` take precedence over their legacy `HYPERRESEARCH_*` equivalents. If you installed from the old repository, pause research and use `pi list` to find that package, then `pi remove <old-source>` before installing from npm or the new URL above. This avoids loading both packages; removing the package does not delete saved investigations.

</details>

### Search providers

**DuckDuckGo is the default: free, with no API key. It can be rate-limited or blocked by bot challenges.** To use another provider:

| Provider | `searchProvider` | API key variable |
| --- | --- | --- |
| DuckDuckGo (default) | `duckduckgo` | None |
| [Brave](https://brave.com/search/api/) | `brave` | `BRAVE_SEARCH_API_KEY` |
| [Tavily](https://www.tavily.com/) | `tavily` | `TAVILY_API_KEY` |
| [Serply](https://serply.io/) — Google results | `serply` | `SERPLY_API_KEY` |
| [Kagi](https://kagi.com/api) | `kagi` | `KAGI_API_KEY` |

For example, select Kagi in your project's `.pi/turing.json`:

```json
{ "searchProvider": "kagi" }
```

Set its key in your shell and launch Pi:

```bash
export KAGI_API_KEY="your-key"
pi
```

Saved runs retain their original provider. Search failures never trigger an automatic switch to another service.

Scholarly search defaults to OpenAlex and Crossref. If you customize `scholarlyProviders`, keep `openalex`: light research requires it for the final retraction refresh. Incompatible settings are rejected before research starts.

## Use it

### Ask a question

```text
/turing Compare SQLite and PostgreSQL for a small local research vault.
```

Approve the cost confirmation and let it run. Research can take **30+ minutes**. The default model-cost ceiling is **approximately $15**, not a price estimate or a hard billing cap; in-flight calls can exceed it, and search fees are separate.

- **Follow and steer:** open `/turing` to watch progress, inspect sources, and guide the investigation from the box beside the report.
- **Go deeper:** ask a follow-up in the dashboard to start a new paid investigation linked to the original. The original report stays unchanged.
- **Come back later:** run `/turing` in Pi to browse saved investigations and export reports as Markdown or offline HTML.

## Publishing to npm

Publishing is manual; the GitHub release workflow does not publish to npm.

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm pack --dry-run
npm login
npm publish --access public
```

Check the package contents before publishing. For subsequent releases, bump the version in both `package.json` and `package-lock.json` with `npm version patch` (or `minor`/`major`). Publish prereleases with `npm publish --access public --tag next` to leave `latest` unchanged.

---

[MIT License](LICENSE) · [Upstream attribution](THIRD_PARTY_NOTICES.md)

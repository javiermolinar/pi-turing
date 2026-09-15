# pi-hyperresearch

[![CI](https://github.com/javiermolinar/pi-hyperresearch/actions/workflows/ci.yml/badge.svg)](https://github.com/javiermolinar/pi-hyperresearch/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/javiermolinar/pi-hyperresearch?color=356451)](https://github.com/javiermolinar/pi-hyperresearch/releases)
[![Pi package](https://img.shields.io/badge/Pi-package-356451)](https://pi.dev)
[![Node.js 22.13+](https://img.shields.io/badge/Node.js-22.13%2B-356451?logo=nodedotjs&logoColor=white)](#install-in-pi)
[![MIT license](https://img.shields.io/badge/license-MIT-596359)](LICENSE)
[![Experimental](https://img.shields.io/badge/status-experimental-9a6700)](#what-is-it)

![Pi Hyperresearch — Deep research inside Pi.](assets/pi-hyperresearch-hero.jpg)

A research workspace for [Pi](https://pi.dev), inspired by [Hyperresearch](https://github.com/jordan-gibbs/hyperresearch) by Jordan Gibbs.

## What is it?

A research toolkit that searches the web and scholarly literature, reads sources, and turns your question into a report with citations. It uses the model you select in Pi.

This is a research tool, not a knowledge brain. Pair it with tools like [gbrain](https://github.com/garrytan/gbrain) to organize and reuse what you learn. Exported reports provide the handoff; there is no built-in integration.

- **Native TypeScript.** Runs directly in Pi on Node.js—no Python, uv, or separate backend setup.
- **Choose your sources.** Web search through DuckDuckGo, Brave, Tavily, Serply, or Kagi, plus scholarly discovery through OpenAlex, Crossref, and opt-in specialist providers.
- **Keep working.** Start research in the background without locking your Pi prompt.
- **Follow the work.** See progress, sources, and estimated cost in a live dashboard.
- **Change direction.** Steer a running investigation, pause and resume, or revise a finished report.
- **Take the report with you.** Export Markdown or self-contained HTML you can read offline.

![Research workflow: Decompose → Research → Draft → Polish → Readability → Check.](assets/research-workflow.jpg)

Experimental. Reports can contain factual errors; citations and automated checks are not a guarantee of accuracy.

## Install in Pi

Requires **Node.js 22.13+** and **[Pi](https://pi.dev) with a configured model**.

Install directly from GitHub:

```bash
pi install https://github.com/javiermolinar/pi-hyperresearch.git
```

Pi installs the package and its dependencies. Start Pi, or run `/reload` in an existing session when research is idle.

### Update

Pause any active research, then run:

```bash
pi update https://github.com/javiermolinar/pi-hyperresearch.git
```

Run `/reload` in Pi to load the update. Saved investigations remain intact.

### Search providers

**DuckDuckGo is the default: free, with no API key. It can be rate-limited or blocked by bot challenges.** To use another provider:

| Provider | `searchProvider` | API key variable |
| --- | --- | --- |
| DuckDuckGo (default) | `duckduckgo` | None |
| [Brave](https://brave.com/search/api/) | `brave` | `BRAVE_SEARCH_API_KEY` |
| [Tavily](https://www.tavily.com/) | `tavily` | `TAVILY_API_KEY` |
| [Serply](https://serply.io/) — Google results | `serply` | `SERPLY_API_KEY` |
| [Kagi](https://kagi.com/api) | `kagi` | `KAGI_API_KEY` |

For example, select Kagi in your project's `.pi/hyperresearch.json`:

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
/hyperresearch Compare SQLite and PostgreSQL for a small local research vault.
```

Approve the cost confirmation and let it run. Research can take **30+ minutes**. The default model-cost ceiling is **approximately $15**, not a price estimate or a hard billing cap; in-flight calls can exceed it, and search fees are separate.

- **Follow and steer:** open `/hyperresearch` to watch progress, inspect sources, and guide the investigation from the box beside the report.
- **Go deeper:** ask a follow-up in the dashboard to start a new paid investigation linked to the original. The original report stays unchanged.
- **Come back later:** run `/hyperresearch` in Pi to browse saved investigations and export reports as Markdown or offline HTML.

## Compared with upstream

We target [Hyperresearch](https://github.com/jordan-gibbs/hyperresearch)’s **light research workflow**, not full feature parity.

- **Shared workflow:** planning, source research, one draft, polish, readability, and structural/quote checks.
- **Adapted for Pi:** a native TypeScript runtime, background workers, a live dashboard, steering, and linked follow-ups with explicit spending and private-context permissions.
- **Not included:** broader research tiers, knowledge-base management, browser automation, and OCR.

From upstream’s 16-step pipeline, Pi adapts steps **1, 2, 10, 15, and 16**. The main gaps are:

- **Steps 3–9:** contradiction analysis, targeted depth research, reconciliation of source disagreements, corpus critique, and evidence digests.
- **Steps 10–11:** multiple drafts and synthesis; Pi currently produces one draft.
- **Steps 12–14:** dedicated critic reviews, targeted gap-filling research, and critic-driven revision.

---

[MIT License](LICENSE) · [Upstream attribution](THIRD_PARTY_NOTICES.md)

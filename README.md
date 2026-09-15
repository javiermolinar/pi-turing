# pi-hyperresearch

![Pi Hyperresearch — Deep research inside Pi.](assets/pi-hyperresearch-hero.jpg)

Inspired by [Hyperresearch](https://github.com/jordan-gibbs/hyperresearch) by **Jordan Gibbs**, adapted for [Pi](https://pi.dev). This project brings its research workflow to Pi

## What is it?

A research toolkit that searches the web and scholarly literature, reads sources, and turns your question into a report with citations. It uses the model you select in Pi.

- **Keep working.** Start research in the background without locking your Pi prompt.
- **Follow the work.** See progress, sources, and estimated cost in a live dashboard.
- **Change direction.** Steer a running investigation, pause and resume, or revise a finished report.
- **Take the report with you.** Export Markdown or self-contained HTML you can read offline.

![Research workflow: Decompose → Research → Draft → Polish → Readability → Check.](assets/research-workflow.jpg)

Experimental. Reports can contain factual errors; citations and automated checks are not a guarantee of accuracy.

## Install in Pi

Requires **Node.js 22.13+** and **[Pi](https://pi.dev) with a configured model**.

From the root of a local checkout:

```bash
npm install --ignore-scripts
pi install .
pi
```

**Updating?** Pause research, update the checkout, rerun `npm install --ignore-scripts`, and restart Pi.

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

### Watch and steer

```text
/hyperresearch
```

The dashboard opens the active investigation, or the inventory list when nothing is running. **Investigations** always shows the full accessible inventory. The first opening asks permission to expose reports across projects and enable session-scoped controls. Later openings reuse that approval until the server closes. No research starts just by opening the dashboard.

The **Sources** panel retains failed fetch attempts and marks them **Recovered** when the URL is available in saved public sources. Only unresolved attempts retain a warning. Recovery does not establish a complete read or factual accuracy.

Use the box beside the report:

- **Steer research:** queue guidance for the next stage boundary on work owned by this Pi session. Current workers continue and existing spend is retained.
- **Save guidance:** on a paused run previously owned by this session, save feedback without resuming it. Other saved runs must first be resumed in Pi.
- **Revise or follow up:** the button shows the fresh model-cost ceiling, for example **Start follow-up · $15 model ceiling**. Clicking authorizes that spending and starts a linked investigation without another cost prompt in Pi. Search fees are separate, and in-flight calls may exceed the ceiling. Unlimited configurations explicitly say **No model ceiling**. The original stays unchanged; the dashboard opens the child with a link back to its parent.

Queued/applied feedback stays inspectable below the box. “Applied” means included in instructions, not verified fulfillment. Draft feedback survives live updates and navigation within the page, but is not saved across browser reloads. Accepted requests survive navigation or a lost response; leaving the page does not cancel an approval pending in Pi. Retrying unchanged feedback reuses the request ID while the page and server remain open.

Private-context reuse still requires separate permission in interactive Pi; the spending click never renews disclosure permissions. If permission is declined, no child starts and the feedback stays in the box. Browser spending authorization is recorded on the child and bound to the parent checkpoint, model/settings, and displayed ceiling. Changed terms require a fresh click—there is no automatic budget increase.

Ordinary chat does **not** steer the research workers. Starting research or using compatibility commands in Pi retains its existing cost approval flow.

### Come back to it

Run `/hyperresearch` to browse saved investigations and open reports. The dashboard offers **Export Markdown** and **Export HTML**.

The dashboard links each revision to its parent and lists follow-up revisions on the parent, including their revision requests. Direct `/hyperresearch export` downloads and standalone snapshots remain run-scoped; opening a dashboard does not broaden existing restricted URLs or bypass report export permissions.

### Close the workspace

Use **Close research UI** in the dashboard or `/hyperresearch close` in Pi. With active work, choose **Hide UI, keep running** or **Pause and close**. Closing removes the Pi banner and stops injecting selected-run context into subsequent chat turns. Progress updates do not bring the banner back. Saved investigations are never deleted.

An idle close stops the dashboard servers. Hidden active work keeps its server until it settles; `/hyperresearch` explicitly reopens the UI. Closing a browser tab alone does not hide the Pi banner or pause research. Reloading or exiting Pi pauses active work and closes its servers.

| Command | Purpose |
| --- | --- |
| `/hyperresearch` | Open the dashboard. |
| `/hyperresearch <question>` | Start research with Pi approval. |
| `/hyperresearch close` | Hide the UI, or pause and close. |
| `/hyperresearch help` | Show brief help. |

Existing commands remain available through `/hyperresearch help advanced`, including `pause`, `resume`, `context`, `save`, and `dashboard <tag>`. The former terminal picker is available as `browse`. In non-interactive mode, an explicit dashboard command authorizes access without a dialog; active-work closing requires `close hide` or `close pause`.

If a metadata-service outage blocks completion, resume retries verification without rerunning paid editors. Structural blockers require explicit steering to replan or a new run; repeated resume does not repair them.

Revisions start a new paid research run. Review reports before relying on them or sharing them.

---

[MIT License](LICENSE) · [Upstream attribution](THIRD_PARTY_NOTICES.md)

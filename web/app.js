'use strict';
const byId = id => document.getElementById(id);
const live = document.body.dataset.live === 'true';
const statusEl = byId('connection');
const sourceFilter = byId('source-filter');
const base = new URL('.', location.href);
let selected = document.body.dataset.run || '';
let generation = 0;
let events;
let loading;
let searching;
let searchGeneration = 0;
let runs = [];
let lastNavigation = location.pathname + location.search;
function applyFilter() {
  const query = sourceFilter.value.toLowerCase();
  document.querySelectorAll('#sources tbody tr').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(query); });
}
sourceFilter.addEventListener('input', applyFilter);
byId('refresh').addEventListener('click', () => location.reload());
function updateActivityAge() {
  document.querySelectorAll('[data-activity-at]').forEach(el => {
    const at = Date.parse(el.dataset.activityAt); if (!Number.isFinite(at)) return;
    const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
    el.textContent = 'Last activity ' + (seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + seconds % 60 + 's') + ' ago';
  });
}
function switchAway() {
  generation++; events?.close(); events = undefined; loading?.abort();
  document.body.dataset.connected = 'false';
}
function renderSnapshot(data) {
  // Only host-rendered, sanitized HTML comes from the capability's endpoint.
  byId('main').innerHTML = data.html;
  if (data.location) {
    const notice = document.createElement('section'); notice.className = 'notice'; notice.id = 'report-match';
    const label = document.createElement('strong'); label.textContent = 'Report Markdown · line ' + data.location.line + ' (report may have changed since search)';
    const text = document.createElement('pre'); text.textContent = data.location.text;
    notice.append(label, text); byId('main').prepend(notice);
  }
  applyFilter(); updateActivityAge();
}
function connect(tag, epoch, line) {
  const url = new URL('events', base); url.searchParams.set('run', tag); if (line) url.searchParams.set('line', String(line));
  const stream = new EventSource(url); events = stream;
  const current = () => generation === epoch && selected === tag && events === stream;
  stream.onopen = () => { if (current()) { document.body.dataset.connected = 'true'; statusEl.textContent = 'Live connection · runner ownership shown below'; } };
  stream.onerror = () => { if (current()) { document.body.dataset.connected = 'false'; statusEl.textContent = 'Disconnected · showing last snapshot; reconnecting…'; } };
  stream.addEventListener('snapshot', event => {
    if (!current()) return;
    try {
      const data = JSON.parse(event.data); if (data.tag !== tag) return;
      renderSnapshot(data); statusEl.textContent = 'Live · updated ' + new Date(data.at).toLocaleTimeString();
    } catch { statusEl.textContent = 'Invalid update · showing last snapshot'; }
  });
  stream.addEventListener('unavailable', () => { if (current()) { document.body.dataset.connected = 'false'; statusEl.textContent = 'Run unavailable · showing stale snapshot'; } });
}
async function selectRun(tag, line, push = true) {
  switchAway(); selected = tag; const epoch = generation;
  byId('inventory').hidden = true; byId('main').hidden = false; sourceFilter.hidden = false;
  // Never leave the previous run visible while a new selection loads/fails.
  byId('main').textContent = 'Loading selected investigation…'; statusEl.textContent = 'Loading…';
  loading = new AbortController();
  try {
    const url = new URL('run', base); url.searchParams.set('id', tag); if (line) url.searchParams.set('line', String(line));
    const response = await fetch(url, { signal: loading.signal });
    if (!response.ok) throw new Error('Selected run is unavailable');
    const data = await response.json();
    if (generation !== epoch || selected !== tag || data.tag !== tag) return;
    renderSnapshot(data);
    if (push) { const address = new URL(base); address.searchParams.set('run', tag); if (line) address.searchParams.set('line', String(line)); history.pushState(null, '', address); lastNavigation = location.pathname + location.search; }
    if (line) byId('report-match')?.scrollIntoView();
    connect(tag, epoch, line);
  } catch (error) {
    if (generation !== epoch || error.name === 'AbortError') return;
    byId('main').textContent = error.message; statusEl.textContent = 'Unavailable';
  }
}
function renderRuns() {
  const query = byId('run-filter').value.toLowerCase(); const list = byId('run-list'); list.replaceChildren();
  for (const run of runs.filter(run => [run.title, run.query, run.project, run.tag].join(' ').toLowerCase().includes(query))) {
    const row = document.createElement('div'); row.className = 'run-row';
    const link = document.createElement('a'); const url = new URL(base); url.searchParams.set('run', run.tag); link.href = url.href;
    link.textContent = run.title || run.query;
    link.addEventListener('click', event => { event.preventDefault(); selectRun(run.tag); });
    const detail = document.createElement('small'); detail.textContent = [run.status, run.createdAt.slice(0, 10), run.project || 'Legacy project', run.tag].join(' · ');
    row.append(link, detail); list.append(row);
  }
  if (!list.childNodes.length) list.textContent = runs.length ? 'No matching runs.' : 'No accessible saved runs.';
}
async function showInventory(push = true) {
  switchAway(); selected = ''; const epoch = generation;
  byId('main').hidden = true; byId('inventory').hidden = false; sourceFilter.hidden = true;
  if (push) { history.pushState(null, '', base); lastNavigation = location.pathname + location.search; }
  statusEl.textContent = 'Saved investigations · read-only';
  loading = new AbortController();
  try {
    const response = await fetch(new URL('runs', base), { signal: loading.signal }); if (!response.ok) throw new Error('Inventory unavailable');
    const data = await response.json(); if (generation !== epoch) return;
    runs = data.runs; byId('scope').textContent = data.scope + (data.partial ? ' · Partial inventory: scan limit reached.' : '') + (data.issues ? ` · ${data.issues} unavailable checkpoints.` : '');
    renderRuns();
  } catch (error) { if (generation === epoch && error.name !== 'AbortError') byId('run-list').textContent = error.message; }
}
async function search() {
  searching?.abort(); const epoch = ++searchGeneration; searching = new AbortController();
  byId('search-results').replaceChildren(); byId('cancel-search').hidden = false; byId('search-status').textContent = 'Searching accessible reports locally…';
  try {
    const url = new URL('search', base); url.searchParams.set('q', byId('report-search').value);
    const response = await fetch(url, { signal: searching.signal }); if (!response.ok) throw new Error(await response.text());
    const data = await response.json(); if (epoch !== searchGeneration) return;
    byId('search-status').textContent = `${data.matches.length} matches · ${data.scanned} reports scanned${data.partial ? ' · Partial: ' + data.reason : ''}. Literal retrieval, not a generated answer.`;
    for (const match of data.matches) {
      const row = document.createElement('div'); row.className = 'search-match';
      const link = document.createElement('a'); const url = new URL(base); url.searchParams.set('run', match.tag); url.searchParams.set('line', String(match.line)); link.href = url.href;
      link.textContent = `${match.tag} · line ${match.line}`;
      link.addEventListener('click', event => { event.preventDefault(); selectRun(match.tag, match.line); });
      const excerpt = document.createElement('pre'); excerpt.textContent = match.excerpt; row.append(link, excerpt); byId('search-results').append(row);
    }
  } catch (error) { if (epoch === searchGeneration) byId('search-status').textContent = error.name === 'AbortError' ? 'Search cancelled.' : error.message; }
  finally { if (epoch === searchGeneration) byId('cancel-search').hidden = true; }
}
if (live) {
  byId('inventory-button').addEventListener('click', () => showInventory());
  byId('run-filter').addEventListener('input', renderRuns);
  byId('search-button').addEventListener('click', search);
  byId('report-search').addEventListener('keydown', event => { if (event.key === 'Enter') search(); });
  byId('cancel-search').addEventListener('click', () => searching?.abort());
  let firstLoad = true;
  const navigate = () => { const url = new URL(location.href); const tag = url.searchParams.get('run') || (firstLoad ? document.body.dataset.run : ''); firstLoad = false; if (tag) selectRun(tag, Number(url.searchParams.get('line')) || undefined, false); else showInventory(false); };
  window.addEventListener('popstate', () => { const path = location.pathname + location.search; if (path === lastNavigation) return; lastNavigation = path; navigate(); }); navigate();
  const clock = setInterval(updateActivityAge, 1000);
  window.addEventListener('pagehide', () => { clearInterval(clock); switchAway(); searching?.abort(); });
} else { byId('inventory').hidden = true; }

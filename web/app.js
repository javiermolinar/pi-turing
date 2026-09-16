'use strict';
const byId = id => document.getElementById(id);
const live = document.body.dataset.live === 'true';
const statusEl = byId('connection');
const sourceFilter = byId('source-filter');
const base = new URL('.', location.href);
const controlToken = document.body.dataset.controlToken;
const feedbackDrafts = new Map(); // Page-local only: never persist private instructions in browser storage.
let uiClosed = false;
let clock;
let composingFeedback = false;
let deferredSnapshot;
const feedbackDraft = tag => {
  if (!feedbackDrafts.has(tag)) feedbackDrafts.set(tag, { text: '', pending: false, message: '' });
  return feedbackDrafts.get(tag);
};
let selected = document.body.dataset.run || '';
let generation = 0;
let events;
let loading;
let searching;
let searchGeneration = 0;
let runs = [];
let lastNavigation = location.pathname + location.search;
// UI state stays in this page, keyed by run and stable host-rendered section IDs.
const detailsByRun = new Map();
const sidebarScrollByRun = new Map();
const compactLayout = window.matchMedia('(max-width: 1200px)');
let renderedRun;
function defaultSidebars() {
  byId('main').querySelectorAll('.sidebar-panel').forEach(panel => { panel.open = !compactLayout.matches; });
}
compactLayout.addEventListener('change', defaultSidebars);
function rememberDetails() {
  if (!renderedRun) return;
  if (byId('feedback-text')) feedbackDraft(renderedRun).text = byId('feedback-text').value;
  let states = detailsByRun.get(renderedRun);
  if (!states) { states = new Map(); detailsByRun.set(renderedRun, states); }
  byId('main').querySelectorAll('details[data-details-key]').forEach(detail => {
    states.set(detail.dataset.detailsKey, detail.open);
  });
  sidebarScrollByRun.set(renderedRun, [...byId('main').querySelectorAll('.sidebar')].map(sidebar => sidebar.scrollTop));
}
function applyFilter() {
  const query = sourceFilter.value.toLowerCase();
  document.querySelectorAll('#sources tbody tr').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(query); });
}
sourceFilter.addEventListener('input', () => {
  const sources = byId('source-details');
  if (sources && sourceFilter.value) sources.open = true;
  applyFilter();
});
byId('main').addEventListener('click', event => {
  const link = event.target.closest('a[data-open-details]');
  if (link) {
    const panel = byId(link.dataset.openDetails);
    // A metric can target a nested panel inside a collapsed sidebar or source list.
    for (let ancestor = panel; ancestor && ancestor !== byId('main'); ancestor = ancestor.parentElement) {
      if (ancestor.matches('details')) ancestor.open = true;
    }
  }
});
byId('refresh').addEventListener('click', () => location.reload());
function updateActivityAge() {
  document.querySelectorAll('[data-activity-at]').forEach(el => {
    const at = Date.parse(el.dataset.activityAt); if (!Number.isFinite(at)) return;
    const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
    el.textContent = 'Last activity ' + (seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + seconds % 60 + 's') + ' ago';
  });
}
function switchAway() {
  rememberDetails(); renderedRun = undefined;
  generation++; events?.close(); events = undefined; loading?.abort();
  document.body.dataset.connected = 'false';
}
function renderSnapshot(data) {
  if (uiClosed) return;
  if (composingFeedback && renderedRun === data.tag) { deferredSnapshot = data; return; }
  byId('export-markdown').disabled = !data.hasReport; byId('export-html').disabled = !data.hasReport;
  rememberDetails();
  const previousCounters = new Map();
  if (renderedRun === data.tag) byId('main').querySelectorAll('[data-counter]').forEach(counter => {
    previousCounters.set(counter.dataset.counter, Number(counter.dataset.value));
  });
  const focused = document.activeElement;
  const focusedKey = focused?.matches('summary') ? focused.parentElement?.dataset.detailsKey : undefined;
  const caret = focused?.id === 'feedback-text' && renderedRun === data.tag ? { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection, scroll: focused.scrollTop } : undefined;
  const submitFocused = focused?.matches('#feedback-form button') && renderedRun === data.tag;
  // Only host-rendered, sanitized HTML comes from the capability's endpoint.
  byId('main').innerHTML = data.html;
  defaultSidebars();
  renderedRun = data.tag;
  // Highlight actual reported increments; never invent streaming tokens between updates.
  if (byId('main').querySelector('[data-run-live="true"]')) {
    byId('main').querySelectorAll('[data-counter]').forEach(counter => {
      const previous = previousCounters.get(counter.dataset.counter);
      if (previous !== undefined && Number(counter.dataset.value) > previous) counter.classList.add('counter-changed');
    });
  }
  const states = detailsByRun.get(renderedRun);
  byId('main').querySelectorAll('details[data-details-key]').forEach(detail => {
    if (states?.has(detail.dataset.detailsKey)) detail.open = states.get(detail.dataset.detailsKey);
    if (detail.dataset.detailsKey === focusedKey) detail.querySelector('summary')?.focus({ preventScroll: true });
  });
  const scrollPositions = sidebarScrollByRun.get(renderedRun);
  byId('main').querySelectorAll('.sidebar').forEach((sidebar, index) => { sidebar.scrollTop = scrollPositions?.[index] ?? 0; });
  if (data.location) {
    const notice = document.createElement('section'); notice.className = 'notice'; notice.id = 'report-match';
    const label = document.createElement('strong'); label.textContent = 'Report Markdown · line ' + data.location.line + ' (report may have changed since search)';
    const text = document.createElement('pre'); text.textContent = data.location.text;
    notice.append(label, text); byId('main').prepend(notice);
  }
  paintFeedback();
  if (caret && byId('feedback-text')) {
    const field = byId('feedback-text'); field.focus({ preventScroll: true });
    field.setSelectionRange(caret.start, caret.end, caret.direction); field.scrollTop = caret.scroll;
  } else if (submitFocused) byId('feedback-form')?.querySelector('button')?.focus({ preventScroll: true });
  applyFilter(); updateActivityAge();
}
function connectionLabel(at) {
  const running = !!byId('main').querySelector('[data-run-live="true"]');
  return (running ? 'Live research' : 'Connected · saved activity') + (at ? ' · snapshot ' + new Date(at).toLocaleTimeString() : '');
}
function connect(tag, epoch, line) {
  const url = new URL('events', base); url.searchParams.set('run', tag); if (line) url.searchParams.set('line', String(line));
  const stream = new EventSource(url); events = stream;
  const current = () => generation === epoch && selected === tag && events === stream;
  stream.onopen = () => { if (current()) { document.body.dataset.connected = 'true'; statusEl.textContent = connectionLabel(); } };
  stream.onerror = () => { if (current()) { document.body.dataset.connected = 'false'; statusEl.textContent = 'Disconnected · showing last snapshot; reconnecting…'; } };
  stream.addEventListener('snapshot', event => {
    if (!current()) return;
    try {
      const data = JSON.parse(event.data); if (data.tag !== tag) return;
      renderSnapshot(data); statusEl.textContent = connectionLabel(data.at);
    } catch { statusEl.textContent = 'Invalid update · showing last snapshot'; }
  });
  stream.addEventListener('unavailable', () => { if (current()) { document.body.dataset.connected = 'false'; statusEl.textContent = 'Run unavailable · showing stale snapshot'; } });
}
async function selectRun(tag, line, push = true) {
  switchAway(); selected = tag; const epoch = generation;
  byId('inventory').hidden = true; byId('main').hidden = false; sourceFilter.hidden = false; byId('export-markdown').hidden = false; byId('export-html').hidden = false;
  byId('export-markdown').disabled = true; byId('export-html').disabled = true;
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
  byId('main').hidden = true; byId('inventory').hidden = false; sourceFilter.hidden = true; byId('export-markdown').hidden = true; byId('export-html').hidden = true;
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
async function download(kind) {
  const tag = selected;
  try {
    let blob;
    if (live) {
      const url = new URL(kind === 'md' ? 'markdown' : 'html', base); url.searchParams.set('id', tag);
      const response = await fetch(url); if (!response.ok) throw new Error('Export unavailable'); blob = await response.blob();
    } else {
      const bytes = Uint8Array.from(atob(byId('markdown-data').content.textContent), character => character.charCodeAt(0));
      blob = new Blob([bytes], { type: 'text/markdown;charset=utf-8' });
    }
    const href = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = href; anchor.download = (tag || 'report') + '.' + kind; anchor.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch (error) { statusEl.textContent = error.message; }
}
function paintFeedback() {
  const form = byId('feedback-form');
  if (!form || !renderedRun) return;
  const draft = feedbackDraft(renderedRun);
  const field = byId('feedback-text'); if (field.value !== draft.text) field.value = draft.text; field.readOnly = draft.pending;
  form.querySelector('button').disabled = !form.dataset.feedbackMode || (form.dataset.feedbackMode === 'revise' && !form.dataset.spendingApproval) || draft.pending || !draft.text.trim() || !controlToken;
  const status = byId('feedback-status'); status.textContent = draft.message;
  if (draft.child) {
    const link = document.createElement('a'); link.textContent = 'Open linked revision';
    const url = new URL(base); url.searchParams.set('run', draft.child); link.href = url.href;
    link.dataset.relatedRun = draft.child; status.append(document.createTextNode(' '), link);
  }
}
async function postAction(action) {
  const response = await fetch(new URL('actions', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Turing-Control': controlToken }, body: JSON.stringify(action),
  });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Action refused. Check Pi.'); error.definitive = true; throw error; }
  return data;
}
async function submitFeedback(event) {
  if (event.target.id !== 'feedback-form') return;
  event.preventDefault();
  const tag = renderedRun; const epoch = generation; const form = event.target;
  const kind = form.dataset.feedbackMode; const draft = feedbackDraft(tag);
  const text = byId('feedback-text').value.trim();
  if (!controlToken || !kind || !text || text.length > 4000 || draft.pending || uiClosed) return;
  const previous = draft.attempt;
  let spendingApproval;
  if (kind === 'revise') {
    try { spendingApproval = JSON.parse(form.dataset.spendingApproval); }
    catch { draft.message = 'Refresh the dashboard to review the follow-up spending terms.'; paintFeedback(); return; }
  }
  // An uncertain retry must retain the original terms and ID, even if a newer
  // snapshot now offers a different ceiling. Never authorize that change silently.
  const action = previous && previous.tag === tag && previous.kind === kind && previous.text === text ? previous
    : { id: crypto.randomUUID(), kind, tag, text, ...(kind === 'revise' ? { spendingApproval } : {}) };
  draft.attempt = action; draft.pending = true; draft.child = undefined;
  draft.message = kind === 'revise' ? (form.dataset.contextApproval === 'true'
    ? 'Waiting for private-context permission in Pi. Spending is already authorized; leaving this page does not cancel the request.'
    : 'Starting follow-up with your approved spending terms…') : 'Queuing guidance…';
  paintFeedback();
  try {
    const result = await postAction(action);
    draft.attempt = undefined; draft.message = result.message;
    if (result.kind === 'queued' || result.kind === 'revision') draft.text = '';
    if (result.kind === 'queued') {
      detailsByRun.get(tag)?.set('steering-history', true);
      if (renderedRun === tag) {
        const history = document.querySelector('[data-details-key="steering-history"]');
        if (history) history.open = true;
      }
    }
    if (result.kind === 'revision') draft.child = result.tag;
    draft.pending = false;
    if (selected === tag && generation === epoch && !uiClosed) {
      paintFeedback();
      if (draft.child) await selectRun(draft.child);
    }
  } catch (error) {
    if (error.definitive) draft.attempt = undefined;
    draft.message = error.definitive ? error.message : 'Connection lost; the request may have completed. Retry unchanged feedback to check the same request.';
  } finally { draft.pending = false; if (selected === tag && !uiClosed) paintFeedback(); }
}
let closeState;
let closeAttempt;
async function openCloseDialog() {
  const dialog = byId('close-dialog');
  byId('close-status').textContent = '';
  try {
    const response = await fetch(new URL('controls', base), { headers: { 'X-Turing-Control': controlToken } });
    if (!response.ok) throw new Error('Controls unavailable. Use /turing close in Pi.');
    closeState = await response.json(); closeAttempt = undefined;
    byId('close-description').textContent = closeState.preparing ? 'Another action is starting or awaiting permission. Wait for it to finish before closing.'
      : closeState.activeTag ? `Pi still owns active research (${closeState.activeTag}). Hide the UI without stopping work, or pause it safely before closing.`
      : 'Remove the Pi banner and close the dashboard server. Saved investigations are preserved.';
    if ([...feedbackDrafts.values()].some(draft => draft.text.trim())) byId('close-description').textContent += ' Unsubmitted feedback on this page will be discarded.';
    const hide = dialog.querySelector('[data-close-mode="hide"]'); hide.disabled = closeState.preparing;
    hide.textContent = closeState.activeTag ? 'Hide UI, keep running' : 'Close UI';
    const pause = dialog.querySelector('[data-close-mode="pause"]'); pause.hidden = !closeState.activeTag; pause.disabled = closeState.preparing;
    dialog.showModal();
  } catch (error) { statusEl.textContent = error.message; }
}
async function closeResearch(mode) {
  const dialog = byId('close-dialog');
  dialog.querySelectorAll('button').forEach(button => { button.disabled = true; });
  byId('close-status').textContent = mode === 'pause' ? 'Waiting for workers to pause safely…' : 'Closing research UI…';
  if (!closeAttempt || closeAttempt.mode !== mode) closeAttempt = { id: crypto.randomUUID(), kind: 'close', mode, ...(closeState.activeTag ? { activeTag: closeState.activeTag } : {}) };
  try {
    const result = await postAction(closeAttempt);
    switchAway(); searching?.abort(); uiClosed = true; clearInterval(clock); feedbackDrafts.clear();
    dialog.close(); byId('inventory').hidden = true; byId('main').hidden = false;
    byId('main').textContent = result.message + ' Reopen with /turing in Pi. You can close this browser tab.';
    document.querySelector('.controls').hidden = true; statusEl.textContent = 'Research UI closed';
  } catch (error) {
    if (error.definitive) closeAttempt = undefined;
    byId('close-status').textContent = error.definitive ? error.message : 'Connection lost. The UI may already be closed; check Pi before reopening it.';
  } finally { dialog.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
}
byId('export-markdown').addEventListener('click', () => download('md'));
byId('export-html').addEventListener('click', () => download('html'));
if (live) {
  if (controlToken) {
    byId('main').addEventListener('submit', submitFeedback);
    byId('main').addEventListener('input', event => {
      if (event.target.id !== 'feedback-text' || !renderedRun) return;
      const draft = feedbackDraft(renderedRun); draft.text = event.target.value;
      if (!draft.pending && !draft.attempt) { draft.message = ''; draft.child = undefined; }
      paintFeedback();
    });
    byId('main').addEventListener('compositionstart', event => { if (event.target.id === 'feedback-text') composingFeedback = true; });
    byId('main').addEventListener('compositionend', () => {
      composingFeedback = false;
      setTimeout(() => { const data = deferredSnapshot; deferredSnapshot = undefined; if (data && data.tag === selected) renderSnapshot(data); }, 0);
    });
    byId('close-research').addEventListener('click', openCloseDialog);
    byId('close-cancel').addEventListener('click', () => byId('close-dialog').close());
    byId('close-dialog').addEventListener('click', event => { const mode = event.target.closest('[data-close-mode]')?.dataset.closeMode; if (mode) closeResearch(mode); });
  }
  byId('main').addEventListener('click', event => {
    const link = event.target.closest('a[data-related-run]');
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    selectRun(link.dataset.relatedRun);
  });
  byId('inventory-button').addEventListener('click', () => showInventory());
  byId('run-filter').addEventListener('input', renderRuns);
  byId('search-button').addEventListener('click', search);
  byId('report-search').addEventListener('keydown', event => { if (event.key === 'Enter') search(); });
  byId('cancel-search').addEventListener('click', () => searching?.abort());
  let firstLoad = true;
  const navigate = () => { if (uiClosed) return; const url = new URL(location.href); const tag = url.searchParams.get('run') || (firstLoad ? document.body.dataset.run : ''); firstLoad = false; if (tag) selectRun(tag, Number(url.searchParams.get('line')) || undefined, false); else showInventory(false); };
  window.addEventListener('popstate', () => { const path = location.pathname + location.search; if (path === lastNavigation) return; lastNavigation = path; navigate(); }); navigate();
  clock = setInterval(updateActivityAge, 1000);
  window.addEventListener('pagehide', () => { clearInterval(clock); switchAway(); searching?.abort(); });
} else { byId('inventory').hidden = true; defaultSidebars(); }

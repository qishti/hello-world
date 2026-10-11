import { h, esc, todayKey, parseKey, dateKey, MONTHS_LONG, relDate, debounce, addDays, dailyTitle } from './util.js';
import { icon } from './icons.js';
import * as store from './store.js';
import { S, load, subscribe, typeOf, getObject, objectsOfType, search, createObject, ensureDaily, collectTasks, touch, runtime, findByTitle, ensureObject } from './store.js';
import * as V from './views.js';
import * as I from './integrations.js';
import { showMenu, closeMenu, toast, modal } from './ui.js';
import { currentOutline } from './outline.js';
import * as hooks from './hooks.js';


const $ = (s) => document.querySelector(s);
let sidebarEl; let panelEl; let calCursor = null; let panelObj = null;

// ---------- theme ----------
function applyTheme() {
  const t = S.settings.theme;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => S && applyTheme());
window.addEventListener('folio:theme', applyTheme);

// ---------- router ----------
function parseHash() {
  const [path, q] = (location.hash.slice(1) || '/daily').split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, q: new URLSearchParams(q || '') };
}
function route() {
  closeMenu();
  const { parts, q } = parseHash();
  const [view, arg] = parts;
  const scroller = $('#main'); V.stopReader();
  switch (view) {
    case 'daily': V.renderDaily(arg); document.title = 'Daily · Folio'; break;
    case 'o': V.renderObject(arg, q.get('b')); document.title = (getObject(arg)?.title || 'Folio') + ' · Folio'; break;
    case 'tasks': V.renderTasks(); document.title = 'Tasks · Folio'; break;
    case 'calendar': V.renderCalendar(arg); document.title = 'Calendar · Folio'; break;
    case 'graph': V.renderGraph(arg); document.title = 'Graph · Folio'; break;
    case 'type': V.renderType(arg); document.title = (S.types[arg]?.plural || 'Folio') + ' · Folio'; break;
    case 'highlights': V.renderHighlights(); document.title = 'Highlights · Folio'; break;
    case 'settings': V.renderSettings(); document.title = 'Settings · Folio'; break;
    default: location.hash = '#/daily'; return;
  }
  if (!q.get('b')) scroller.scrollTop = 0;
  panelObj = view === 'o' ? getObject(arg) : view === 'daily' ? ensureDaily(arg || todayKey()) : null;
  document.getElementById('hl-toggle')?.classList.toggle('gone', !(view === 'o' || view === 'daily'));
  if (!(view === 'o' || view === 'daily')) V.toggleHighlightDrawer(false);
  paintSidebar(); paintPanel();
  document.body.classList.remove('sb-open');
}

// ---------- chrome ----------
function buildShell() {
  document.body.innerHTML = '';
  sidebarEl = h('aside', { class: 'sidebar', id: 'sidebar' });
  panelEl = h('aside', { class: 'panel', id: 'panel' });
  const top = h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn', id: 'sb-toggle', title: 'Toggle sidebar', html: icon('panel', 18), onclick: toggleSidebar }),
    h('button', { class: 'icon-btn', title: 'Back', html: icon('arrowL', 17), onclick: () => history.back() }),
    h('button', { class: 'icon-btn', title: 'Forward', html: icon('arrowR', 17), onclick: () => history.forward() }),
    h('div', { class: 'top-spacer' }),
    h('div', { class: 'top-actions', id: 'top-actions' }),
    h('button', { class: 'icon-btn', id: 'hl-toggle', title: 'Highlights drawer', html: icon('highlighter', 17), onclick: () => V.toggleHighlightDrawer() }),
    h('button', { class: 'icon-btn', title: 'Search (⌘K)', html: icon('search', 17), onclick: () => openPalette() }),
    h('button', { class: 'icon-btn', id: 'pn-toggle', title: 'Side panel', html: icon('panelR', 18), onclick: togglePanel }));
  const main = h('main', { class: 'main', id: 'main' }, top, h('div', { id: 'main-body' }));
  document.body.append(h('div', { class: 'app' }, sidebarEl, main, panelEl), h('div', { class: 'scrim', onclick: () => document.body.classList.remove('sb-open') }));
  V.bindChrome((nodes) => { const a = $('#top-actions'); a.textContent = ''; a.append(...nodes); });
  document.body.classList.toggle('sb-closed', !S.settings.sidebar);
  document.body.classList.toggle('pn-closed', S.settings.panel === false);
}
function togglePanel() { S.settings.panel = S.settings.panel === false; document.body.classList.toggle('pn-closed', S.settings.panel === false); touch(); paintPanel(); }
export function paintPanel() {
  if (!panelEl) return;
  document.body.classList.toggle('has-panel', !!panelObj);
  panelEl.textContent = '';
  if (panelObj && S.settings.panel !== false) panelEl.append(V.panelContent(panelObj));
}
function toggleSidebar() {
  if (innerWidth < 900) document.body.classList.toggle('sb-open');
  else { S.settings.sidebar = !S.settings.sidebar; document.body.classList.toggle('sb-closed', !S.settings.sidebar); touch(); }
}

// ---------- sidebar ----------
function navItem(ic, label, href, extra) {
  const cur = location.hash.startsWith(href) || (href === '#/daily' && location.hash.startsWith('#/daily'));
  return h('a', { class: `nav${cur ? ' on' : ''}`, href }, h('span', { html: icon(ic, 17) }), h('span', { class: 'nav-label' }, label), extra);
}
function miniCal() {
  const base = calCursor ? parseKey(calCursor + '-01') : new Date(); base.setDate(1);
  const y = base.getFullYear(); const m = base.getMonth();
  const start = new Date(y, m, 1 - ((new Date(y, m, 1).getDay() + 6) % 7));
  const { parts } = parseHash(); const sel = parts[0] === 'daily' ? (parts[1] || todayKey()) : null;
  const today = todayKey();
  const el = h('div', { class: 'mini' },
    h('div', { class: 'mini-head' }, h('span', null, MONTHS_LONG[m].slice(0, 3), ' ', h('b', null, y)),
      h('span', { class: 'mini-nav' }, h('button', { html: icon('chevL', 14), onclick: () => { calCursor = dateKey(new Date(y, m - 1, 1)).slice(0, 7); paintSidebar(); } }), h('button', { html: icon('chevR', 14), onclick: () => { calCursor = dateKey(new Date(y, m + 1, 1)).slice(0, 7); paintSidebar(); } }))),
    h('div', { class: 'mini-grid' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => h('i', { class: 'dow' }, d)),
      Array.from({ length: 42 }, (_, i) => {
        const d = new Date(start); d.setDate(d.getDate() + i); const k = dateKey(d);
        const o = S.objects['d-' + k]; const has = o && o.blocks.some((b) => b.text || b.children.length); const rev = !!o?.props?.reviewed;
        const ev = I.hasCalendars() && I.eventsOn(k).length;
        return h('a', { href: '#/daily/' + k, class: `d${d.getMonth() !== m ? ' out' : ''}${k === today ? ' today' : ''}${k === sel ? ' sel' : ''}${rev ? ' rev' : ''}` }, d.getDate(), has || ev || rev ? h('u', { class: rev ? 'rv' : ev && !has ? 'evd' : '' }) : null);
      })));
  return el;
}
export function paintSidebar() {
  if (!sidebarEl) return;
  const sc = sidebarEl.querySelector('.sb-scroll')?.scrollTop || 0;
  sidebarEl.textContent = '';
  const hlCount = I.allHighlights().length;
  const linked = I.linkedTodoistIds();
  const dueToday = collectTasks().filter(({ block: b }) => b.task.status !== 'done' && b.task.due && b.task.due <= todayKey()).length + I.todoistOpen().filter((t) => !linked.has(t.id) && t.due && t.due <= todayKey()).length;
  sidebarEl.append(
    h('div', { class: 'sb-head' }, h('div', { class: 'brand' }, h('span', { class: 'logo' }, h('i'), h('i'), h('i')), h('span', null, 'Folio')),
      h('button', { class: 'icon-btn', title: 'New object', html: icon('plus', 18), onclick: (e) => newMenu(e.currentTarget) })),
    h('button', { class: 'sb-search', onclick: () => openPalette(), html: `${icon('search', 15)}<span>Search or create</span><kbd>${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} K</kbd>` }),
    h('div', { class: 'sb-scroll' },
      h('nav', { class: 'navs' }, navItem('calendar', 'Today', '#/daily'), navItem('check', 'Tasks', '#/tasks', dueToday ? h('b', { class: 'badge' }, dueToday) : null), navItem('calendar', 'Calendar', '#/calendar'), navItem('highlighter', 'Highlights', '#/highlights', hlCount ? h('em', { class: 'count' }, hlCount) : null), navItem('graph', 'Graph', '#/graph')),
      miniCal(),
      S.favorites.length ? h('div', { class: 'sb-sec' }, h('div', { class: 'sb-label' }, 'Favorites'), S.favorites.map(getObject).filter(Boolean).map((o) => h('a', { class: `nav small${location.hash.includes(o.id) ? ' on' : ''}`, href: '#/o/' + o.id }, h('span', { class: 'type-ic sm', style: { '--c': typeOf(o).color }, html: icon(typeOf(o).icon, 12) }), h('span', { class: 'nav-label' }, o.title)))) : null,
      h('div', { class: 'sb-sec' }, h('div', { class: 'sb-label sb-label-row' }, h('span', null, 'Types'), h('button', { class: 'icon-btn small', title: 'New type', html: icon('plus', 13), onclick: () => V.typeEditor(null) })),
        Object.values(S.types).filter((t) => t.id !== 'daily').map((t) => { const n = objectsOfType(t.id).length; return h('a', { class: `nav small${location.hash === '#/type/' + t.id ? ' on' : ''}`, href: '#/type/' + t.id }, h('span', { class: 'type-ic sm', style: { '--c': t.color }, html: icon(t.icon, 12) }), h('span', { class: 'nav-label' }, t.plural), n ? h('em', { class: 'count' }, n) : null); }))),
    h('div', { class: 'sb-foot' },
      h('a', { class: `nav small${location.hash === '#/settings' ? ' on' : ''}`, href: '#/settings' }, h('span', { html: icon('sliders', 16) }), h('span', { class: 'nav-label' }, 'Settings')),
      h('button', { class: 'icon-btn', title: 'Toggle theme', html: icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 16), onclick: () => { S.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); touch(); paintSidebar(); } })));
  const s = sidebarEl.querySelector('.sb-scroll'); if (s) s.scrollTop = sc;
}
function newMenu(anchor) {
  showMenu({ anchor, keepFocus: false, items: [...Object.values(S.types).filter((t) => t.id !== 'daily').map((t) => ({ label: t.name, icon: t.icon, color: t.color, value: t.id })), { sep: true }, { label: 'Import files…', icon: 'download', value: '__import' }], onPick: (it) => (it.value === '__import' ? V.importInto(null) : V.newObject(it.value)) });
}

// ---------- command palette ----------
function openPalette() {
  const input = h('input', { class: 'pal-input', placeholder: 'Search objects, or type a new title…', autofocus: true });
  const list = h('div', { class: 'pal-list' });
  const m = modal(h('div', null, h('div', { class: 'pal-top', html: icon('search', 18) }, input), list), { wide: true });
  m.box.classList.add('palette');
  let items = []; let sel = 0;
  const cmds = [
    { label: 'Go to today', icon: 'calendar', run: () => V.go('#/daily') }, { label: 'Open tasks', icon: 'check', run: () => V.go('#/tasks') }, { label: 'Open calendar', icon: 'calendar', run: () => V.go('#/calendar') },
    { label: 'Open highlights', icon: 'highlighter', run: () => V.go('#/highlights') }, { label: 'Open graph', icon: 'graph', run: () => V.go('#/graph') }, { label: 'Open settings', icon: 'sliders', run: () => V.go('#/settings') },
    { label: 'New meeting note', icon: 'users', run: () => V.newObject('meeting') }, { label: 'Import files…', icon: 'download', run: () => V.importInto(null) }, { label: 'Sync everything', icon: 'refresh', run: () => syncAll(true) },
    { label: 'Toggle dark mode', icon: 'moon', run: () => { S.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(); touch(); paintSidebar(); } },
  ];
  const paint = () => {
    const q = input.value.trim(); items = [];
    const r = search(q, 7);
    r.objects.forEach((o) => items.push({ label: o.title, sub: typeOf(o).name, icon: typeOf(o).icon, color: typeOf(o).color, run: () => V.go('#/o/' + o.id) }));
    if (q) {
      cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())).forEach((c) => items.push({ ...c, sub: 'Command' }));
      r.blocks.slice(0, 6).forEach(({ obj, block }) => items.push({ label: block.text.replace(/\[\[|\]\]/g, '').slice(0, 90), sub: obj.title, icon: 'list', run: () => V.go(`#/o/${obj.id}?b=${block.id}`) }));
      if (!r.objects.some((o) => o.title.toLowerCase() === q.toLowerCase())) {
        ['page', 'person', 'meeting', 'source', 'project', 'idea'].filter((t) => S.types[t]).forEach((t) => items.push({ label: `Create “${q}”`, sub: S.types[t].name, icon: 'plus', color: S.types[t].color, run: () => { const o = createObject({ type: t, title: q, blocks: t === 'meeting' ? store.meetingBlocks() : undefined, props: t === 'meeting' ? { date: todayKey() } : {} }); V.go('#/o/' + o.id); } }));
      }
    } else cmds.slice(0, 5).forEach((c) => items.push({ ...c, sub: 'Command' }));
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.textContent = '';
    items.forEach((it, i) => list.append(h('div', { class: `pal-item${i === sel ? ' sel' : ''}`, onmouseenter: () => { sel = i; [...list.children].forEach((c, j) => c.classList.toggle('sel', j === i)); }, onclick: () => { m.close(); it.run(); } },
      h('span', { class: 'menu-ic', style: it.color ? { '--c': it.color } : {}, html: icon(it.icon, 16) }), h('span', { class: 'pal-label' }, it.label), h('span', { class: 'pal-sub' }, it.sub))));
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => { sel = 0; paint(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[sel]; if (it) { m.close(); it.run(); } }
  });
  paint(); setTimeout(() => input.focus(), 10);
}

// ---------- sync ----------
async function syncAll(verbose) {
  const res = [];
  try { if (Object.keys(S.cache.cal).length || S.settings.icsUrls.length) { const r = await I.syncCalendars(); res.push(`${r.n} events`); if (r.errors.length && verbose) toast(r.errors[0], { kind: 'warn', ms: 6000 }); } } catch (e) { /* ignore */ }
  try { if (I.todoistConnected()) { const r = await I.syncTodoist(); res.push(`${r.n} tasks`); } } catch (e) { if (verbose) toast(e.message, { kind: 'warn', ms: 6000 }); }
  try { if (I.readwiseConnected() && verbose) { const r = await I.syncReadwise(); res.push(`${r.highlights} highlights`); } } catch (e) { if (verbose) toast(e.message, { kind: 'warn', ms: 6000 }); }
  if (verbose) toast(res.length ? 'Synced · ' + res.join(', ') : 'Nothing to sync yet. Connect services in Settings.');
  route();
}

// ---------- global events ----------
function bindGlobal() {
  document.addEventListener('click', (e) => {
    const wl = e.target.closest('a.wl');
    if (wl) {
      e.preventDefault();
      const title = wl.dataset.title; let o = wl.dataset.id ? getObject(wl.dataset.id) : findByTitle(title);
      if (!o) o = createObject({ type: 'page', title });
      V.go(o.type === 'daily' ? '#/daily/' + o.date : '#/o/' + o.id); return;
    }
    const tag = e.target.closest('a.tag');
    if (tag) { e.preventDefault(); const o = ensureObject(tag.dataset.tag, 'tag'); V.go('#/o/' + o.id); }
  });
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k' && !e.shiftKey && !(e.target.matches?.('.blk-edit'))) { e.preventDefault(); openPalette(); }
    else if (mod && e.key === '/' ) { e.preventDefault(); openPalette(); }
    else if (mod && e.key === '\\') { e.preventDefault(); toggleSidebar(); }
  });
  window.addEventListener('hashchange', route);
  // Drag files anywhere to import them; if a note is open, links (or images) are added to it.
  let depth = 0; let overlay = null;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const openNote = () => { const { parts } = parseHash(); return parts[0] === 'o' ? getObject(parts[1]) : parts[0] === 'daily' ? ensureDaily(parts[1] || todayKey()) : null; };
  const hideOverlay = () => { depth = 0; overlay?.remove(); overlay = null; };
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return; depth++;
    if (overlay || location.hash === '#/type/pdf') return;
    const n = openNote();
    overlay = h('div', { class: 'drop-overlay' }, h('div', { class: 'drop-card' }, h('div', { html: icon('download', 30) }), h('b', null, 'Drop to import'), h('span', null, 'PDFs, Word, Markdown, text and images'), n ? h('em', null, `Links and images will be added to “${n.title}”`) : null));
    document.body.append(overlay);
  });
  window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --depth <= 0) hideOverlay(); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e) || e.defaultPrevented) { hideOverlay(); return; }
    e.preventDefault(); hideOverlay();
    const files = [...e.dataTransfer.files]; if (!files.length) return;
    await V.handleImport(files, openNote());
  });
  const refresh = debounce(() => { const f = document.activeElement; if (f && f.matches?.('.blk-edit, .title-input, .prop-input, input, select')) { paintSidebar(); return; } route(); }, 30);
  window.addEventListener('folio:refresh', () => route());
  subscribe(() => { paintSidebar(); paintPanel(); });
  setInterval(() => { if (document.visibilityState === 'visible' && !document.activeElement?.matches?.('textarea, input')) { if (parseHash().parts[0] === 'daily') route(); } }, 60000 * 5);
}

// ---------- boot ----------
(async function boot() {
  await load();
  applyTheme();
  buildShell();
  await I.detectProxy();
  bindGlobal();
  route();
  I.startReminders((obj, block, text) => {
    toast(`⏰ ${text}`, { ms: 0, actions: [
      { label: 'Open', fn: () => V.go(`#/o/${obj.id}?b=${block.id}`) },
      { label: 'Snooze 10m', fn: () => { block.task.remind = new Date(Date.now() + 10 * 60000).toISOString(); block.task.notified = false; touch(obj); } },
      { label: 'Done', fn: () => { store.toggleTask(block, obj, (x) => hooks.todoistToggle(x)); route(); } }] });
  });
  // Readwise background sync, like Heptabase: on open, then every 10 minutes while visible
  const rw = async () => { try { const n = await I.autoReadwise(); if (n) { toast(`Readwise: ${n} new or updated highlight${n > 1 ? 's' : ''}`, { actions: [{ label: 'View', fn: () => V.go('#/highlights') }] }); paintSidebar(); } } catch { /* offline or rate limited */ } };
  setTimeout(rw, 3000); setInterval(() => { if (document.visibilityState === 'visible') rw(); }, 10 * 60e3);
  // Email-in: file any queued mail on open, then every 90 seconds while visible
  const em = async () => { if (!runtime.proxy) return; try { const st = await I.emailStatus(); if (!st.configured) return; const r = await I.pullEmail(); if (r.n) { toast(`${r.n} new email${r.n > 1 ? 's' : ''} added to your daily note`, { actions: [{ label: 'View', fn: () => V.go('#/o/' + ensureObject('email', 'tag').id) }] }); route(); } } catch { /* server offline */ } };
  setTimeout(em, 2500); setInterval(() => { if (document.visibilityState === 'visible') em(); }, 90000);
  // quiet background sync for connected services
  setTimeout(() => { if (I.todoistConnected() || S.settings.icsUrls.length) syncAll(false); }, 1500);
  if ('serviceWorker' in navigator) { /* offline support intentionally omitted */ }
  window.folio = { store, V, I, };
})();

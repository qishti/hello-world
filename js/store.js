import { uid, dailyTitle, titleToKey, todayKey, debounce, dateKey, addDays, parseKey } from './util.js';

export const BUILTIN_TYPES = {
  daily: { id: 'daily', name: 'Daily note', plural: 'Daily notes', icon: 'calendar', color: '#8b5cf6', builtin: true, props: [] },
  page: { id: 'page', name: 'Page', plural: 'Pages', icon: 'file', color: '#64748b', builtin: true, props: [] },
  person: {
    id: 'person', name: 'Person', plural: 'People', icon: 'user', color: '#f59e0b', builtin: true,
    props: [{ key: 'email', label: 'Email', kind: 'text' }, { key: 'phone', label: 'Phone', kind: 'text' }, { key: 'company', label: 'Company', kind: 'text' }, { key: 'role', label: 'Role', kind: 'text' }],
  },
  meeting: {
    id: 'meeting', name: 'Meeting', plural: 'Meetings', icon: 'users', color: '#ec4899', builtin: true,
    props: [{ key: 'date', label: 'Date', kind: 'date' }, { key: 'time', label: 'Time', kind: 'text' }, { key: 'location', label: 'Location', kind: 'text' }, { key: 'link', label: 'Link', kind: 'url' }],
  },
  source: {
    id: 'source', name: 'Source', plural: 'Sources', icon: 'book', color: '#10b981', builtin: true,
    props: [{ key: 'author', label: 'Author', kind: 'text' }, { key: 'category', label: 'Category', kind: 'select', options: ['Book', 'Article', 'Tweet', 'Podcast', 'Video', 'Other'] }, { key: 'url', label: 'URL', kind: 'url' }],
  },
  project: {
    id: 'project', name: 'Project', plural: 'Projects', icon: 'folder', color: '#0ea5e9', builtin: true,
    props: [{ key: 'status', label: 'Status', kind: 'select', options: ['Planned', 'Active', 'Paused', 'Done'] }, { key: 'due', label: 'Due', kind: 'date' }],
  },
  idea: { id: 'idea', name: 'Idea', plural: 'Ideas', icon: 'bulb', color: '#eab308', builtin: true, props: [] },
  tag: { id: 'tag', name: 'Tag', plural: 'Tags', icon: 'hash', color: '#94a3b8', builtin: true, props: [] },
};

export let S = null;
export const runtime = { proxy: false, saving: false };

// ---------- persistence ----------
const DB = 'folio-outliner';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  } catch { try { return JSON.parse(localStorage.getItem(DB + k)); } catch { return null; } }
}
async function idbSet(k, v) {
  try {
    const db = await idb();
    await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch { try { localStorage.setItem(DB + k, JSON.stringify(v)); } catch { /* quota */ } }
}

const isEmptyDaily = (o) => o.type === 'daily' && !hasContent(o.blocks);
const hasContent = (blocks) => blocks.some((b) => b.text.trim() || b.task || b.children.length);

function serialize() {
  const objects = {};
  for (const [id, o] of Object.entries(S.objects)) if (!isEmptyDaily(o)) objects[id] = o;
  return { ...S, objects };
}
const doSave = debounce(async () => { runtime.saving = true; await idbSet('state', serialize()); runtime.saving = false; }, 500);
export const saveNow = () => doSave.flush();
window.addEventListener('beforeunload', () => doSave.flush());

// ---------- change notification ----------
let index = null;
const subs = new Set();
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = debounce(() => subs.forEach((f) => f()), 120);
/** Call after mutating data. struct=true when titles/blocks were added, removed or moved. */
export function touch(obj, struct = false) {
  if (obj) { obj.updated = Date.now(); if (obj.type !== 'daily' || obj.blocks.length > 1 || obj.blocks[0]?.text) snapshotLater(obj); }
  if (struct) index = null;
  doSave();
  emit();
}

// Snapshots are taken at most every few minutes, after edits settle.
const pending = new Map();
function snapshotLater(obj) { clearTimeout(pending.get(obj.id)); pending.set(obj.id, setTimeout(() => { pending.delete(obj.id); if (S.objects[obj.id]) { snapshot(obj); } }, 4000)); }

// ---------- blocks ----------
export const newBlock = (text = '', extra = {}) => ({ id: uid(), text, type: 'text', collapsed: false, children: [], ...extra });
export function walk(blocks, fn, parent = null, depth = 0) {
  for (const b of blocks) { fn(b, parent, depth); if (b.children.length) walk(b.children, fn, b, depth + 1); }
}
function buildIndex() {
  const byTitle = new Map(); const blocks = new Map();
  for (const o of Object.values(S.objects)) {
    byTitle.set(o.title.trim().toLowerCase(), o);
    const rec = (arr, parent) => arr.forEach((b, i) => { blocks.set(b.id, { obj: o, block: b, arr, i, parent }); if (b.children.length) rec(b.children, b); });
    rec(o.blocks, null);
  }
  for (const o of Object.values(S.objects)) for (const a of o.aliases || []) { const k = a.trim().toLowerCase(); if (k && !byTitle.has(k)) byTitle.set(k, o); }
  return { byTitle, blocks };
}
const ix = () => (index ||= buildIndex());
/** Locate a block. Position data (arr/i) is recomputed so it stays correct after moves. */
export function locate(id) {
  const rec = ix().blocks.get(id);
  if (!rec) return null;
  let i = rec.arr.indexOf(rec.block);
  if (i < 0) { index = null; const r2 = ix().blocks.get(id); if (!r2) return null; i = r2.arr.indexOf(r2.block); return { ...r2, i }; }
  return { ...rec, i };
}

// ---------- objects ----------
export const getObject = (id) => S.objects[id] || null;
export const typeOf = (o) => S.types[o.type] || S.types.page;

export function ensureDaily(key) {
  const id = `d-${key}`;
  if (!S.objects[id]) {
    S.objects[id] = { id, type: 'daily', title: dailyTitle(key), date: key, props: {}, blocks: [newBlock('')], created: Date.now(), updated: Date.now() };
    index = null;
  }
  return S.objects[id];
}
export function findByTitle(title) {
  const t = String(title).trim().toLowerCase();
  const hit = ix().byTitle.get(t);
  if (hit) return hit;
  const k = titleToKey(title);
  return k ? ensureDaily(k) : null;
}
export function createObject({ type = 'page', title = 'Untitled', blocks, props = {}, extra = {} } = {}) {
  const id = uid();
  const o = { id, type, title, props, blocks: blocks || [newBlock('')], created: Date.now(), updated: Date.now(), ...extra };
  S.objects[id] = o;
  touch(o, true);
  return o;
}
export function ensureObject(title, type = 'page') {
  return findByTitle(title) || createObject({ type, title: title.trim() });
}
export function deleteObject(id) {
  delete S.objects[id];
  S.favorites = S.favorites.filter((f) => f !== id);
  touch(null, true);
}
export function renameObject(obj, title) {
  title = title.trim() || 'Untitled';
  if (title === obj.title) return;
  const old = obj.title;
  const re = new RegExp(`\\[\\[${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`, 'gi');
  obj.title = title;
  if (obj.type === 'tag') {
    const tre = new RegExp(`(^|\\s)#${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'gi');
    for (const o of Object.values(S.objects)) walk(o.blocks, (b) => { b.text = b.text.replace(tre, `$1#${title}`).replace(re, `[[${title}]]`); });
  } else {
    for (const o of Object.values(S.objects)) walk(o.blocks, (b) => { if (b.text.includes('[[')) b.text = b.text.replace(re, `[[${title}]]`); });
  }
  touch(obj, true);
}
export const objectsOfType = (t) => Object.values(S.objects).filter((o) => o.type === t && !isEmptyDaily(o));
export const allObjects = () => Object.values(S.objects).filter((o) => !isEmptyDaily(o));

// ---------- links ----------
const LINK_RE = /\[\[([^\[\]\n]+)\]\]|(?:^|[\s(])#([\w][\w-]*)/g;
export function linksIn(text) {
  const out = []; LINK_RE.lastIndex = 0; let m;
  while ((m = LINK_RE.exec(text))) out.push((m[1] || m[2]).trim().toLowerCase());
  return out;
}
export function backlinks(obj) {
  const keys = [obj.title, ...(obj.aliases || [])].map((x) => x.trim().toLowerCase()).filter(Boolean);
  const groups = [];
  for (const o of Object.values(S.objects)) {
    if (o.id === obj.id) continue;
    const hits = [];
    walk(o.blocks, (b) => { if (b.text && linksIn(b.text).some((l) => keys.includes(l))) hits.push(b); });
    if (hits.length) groups.push({ obj: o, blocks: hits });
  }
  return groups.sort((a, b) => b.obj.updated - a.obj.updated);
}
export function unlinkedMentions(obj) {
  const t = obj.title.trim().toLowerCase();
  if (t.length < 3 || obj.type === 'daily') return [];
  const groups = [];
  for (const o of Object.values(S.objects)) {
    if (o.id === obj.id) continue;
    const hits = [];
    walk(o.blocks, (b) => {
      const low = b.text.toLowerCase();
      if (low.includes(t) && !linksIn(b.text).includes(t)) hits.push(b);
    });
    if (hits.length) groups.push({ obj: o, blocks: hits });
  }
  return groups;
}
export function linkMention(block, title) {
  const re = new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  block.text = block.text.replace(re, (m) => `[[${m === title ? title : title}]]`);
}
export function outgoing(obj) {
  const set = new Set();
  walk(obj.blocks, (b) => linksIn(b.text).forEach((l) => set.add(l)));
  return set;
}

// ---------- tasks ----------
export function collectTasks() {
  const out = [];
  for (const o of Object.values(S.objects)) walk(o.blocks, (b) => { if (b.task && (b.text.trim() || b.task.todoistId)) out.push({ obj: o, block: b }); });
  return out;
}
export const taskDue = (b) => b.task?.due || (b.task?.remind ? dateKey(new Date(b.task.remind)) : null);

// ---------- search ----------
export function search(q, limit = 8) {
  q = q.trim().toLowerCase();
  if (!q) return { objects: allObjects().sort((a, b) => b.updated - a.updated).slice(0, limit), blocks: [] };
  const objects = [];
  for (const o of allObjects()) {
    const t = o.title.toLowerCase();
    const i = t.indexOf(q);
    if (i >= 0) objects.push({ o, s: (i === 0 ? 0 : 1) + t.length / 1000 - (o.type === 'daily' ? 0 : 0.0005) });
    else if (fuzzy(t, q)) objects.push({ o, s: 3 });
  }
  objects.sort((a, b) => a.s - b.s);
  const blocks = [];
  if (q.length > 1) {
    outer: for (const o of allObjects()) {
      const stack = [];
      walk(o.blocks, (b) => { if (b.text.toLowerCase().includes(q)) stack.push(b); });
      for (const b of stack) { blocks.push({ obj: o, block: b }); if (blocks.length >= 12) break outer; }
    }
  }
  return { objects: objects.slice(0, limit).map((x) => x.o), blocks };
}
function fuzzy(t, q) { let i = 0; for (const c of t) if (c === q[i] && ++i === q.length) return true; return false; }

// ---------- favorites ----------
export function toggleFavorite(id) {
  const i = S.favorites.indexOf(id);
  if (i >= 0) S.favorites.splice(i, 1); else S.favorites.push(id);
  touch();
}

// ---------- meeting template ----------
export function meetingBlocks(attendeeLinks = '') {
  return [
    ...(attendeeLinks ? [newBlock(`**Attendees** ${attendeeLinks}`)] : []),
    newBlock('Agenda', { type: 'h3', children: [newBlock('')] }),
    newBlock('Notes', { type: 'h3', children: [newBlock('')] }),
    newBlock('Action items', { type: 'h3', children: [newBlock('', { task: { status: 'todo' } })] }),
  ];
}

// ---------- init ----------
const fresh = () => ({
  version: 1,
  objects: {}, types: structuredClone(BUILTIN_TYPES), favorites: [],
  settings: { theme: 'auto', icsUrls: [], todoistToken: '', readwiseToken: '', proxy: '', sidebar: true },
  cache: { cal: {}, todoist: null, readwiseSyncedAt: null },
});

export async function load() {
  S = (await idbGet('state')) || null;
  const first = !S;
  if (first) S = fresh();
  S.types = { ...structuredClone(BUILTIN_TYPES), ...S.types };
  S.settings = { ...fresh().settings, ...S.settings };
  S.cache = { ...fresh().cache, ...S.cache };
  S.favorites ||= [];
  if (first) seed();
  index = null;
  return S;
}

function seed() {
  const t = (text, extra) => newBlock(text, extra);
  const welcome = createObject({
    type: 'page', title: 'Welcome to Folio',
    blocks: [
      t('Folio is an outliner with the calm of an object-based notebook. Every note is a typed **object** made of nested bullets.'),
      t('Write', { type: 'h2', children: [
        t('Press **Enter** for a new bullet, **Tab** to indent, **Shift+Tab** to outdent, **Alt+↑/↓** to move.'),
        t('Type **/** for blocks: headings, tasks, quotes, code, due dates, reminders.'),
        t('Drag the grip on the left of any bullet to reorder.'),
      ] }),
      t('Link', { type: 'h2', children: [
        t('Type **[[** to link to any object, or create one on the spot. Try [[Ideas worth keeping]].'),
        t('Use #tags to group things. Every object lists its **linked references** at the bottom.'),
        t('Daily notes live under **Today** in the sidebar. To link a date, type [[ then “today” or “tomorrow”.'),
      ] }),
      t('Plan', { type: 'h2', children: [
        t('Turn any bullet into a task with **⌘/Ctrl+Enter**.', { task: { status: 'todo' } }),
        t('Give it a due date or a reminder from the **/** menu.', { task: { status: 'todo', due: todayKey() } }),
        t('Connect Todoist, Readwise and your calendar in **Settings**.', { task: { status: 'todo' } }),
      ] }),
      t('Press **⌘/Ctrl+K** anywhere to search or create.', { type: 'callout' }),
    ],
  });
  createObject({ type: 'idea', title: 'Ideas worth keeping', blocks: [t('A place for loose thoughts. Link back to [[Welcome to Folio]].')] });
  S.favorites.push(welcome.id);
  const d = ensureDaily(todayKey());
  d.blocks = [t('')];
}

export { todayKey, addDays };

// ---------- recurring tasks ----------
export const REPEATS = { daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };
export function nextDue(due, rule) {
  const d = parseKey(due);
  if (rule === 'daily') d.setDate(d.getDate() + 1);
  else if (rule === 'weekdays') { do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); }
  else if (rule === 'weekly') d.setDate(d.getDate() + 7);
  else if (rule === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (rule === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return dateKey(d);
}
/** Complete or reopen a task. Recurring tasks advance to the next date instead of closing. */
export function toggleTask(b, obj, hooksToggle) {
  const t = b.task;
  if (t.status !== 'done' && t.repeat) {
    const base = t.due || todayKey(); let nd = nextDue(base, t.repeat);
    while (nd <= todayKey() && base <= todayKey()) nd = nextDue(nd, t.repeat);
    if (t.remind) { const diff = parseKey(nd) - parseKey(base); t.remind = new Date(new Date(t.remind).getTime() + diff).toISOString(); t.notified = false; }
    t.due = nd; t.doneCount = (t.doneCount || 0) + 1; t.lastDone = Date.now();
    hooksToggle?.({ ...b, task: { ...t, status: 'done' } });
  } else {
    t.status = t.status === 'done' ? 'todo' : 'done';
    t.completedAt = t.status === 'done' ? Date.now() : null;
    hooksToggle?.(b);
  }
  touch(obj);
}

// ---------- version history ----------
const SNAP_GAP = 10 * 60e3; const SNAP_MAX = 25;
const sig = (o) => o.title + JSON.stringify(o.blocks);
export function snapshot(obj, force = false) {
  const h = (obj.history ||= []);
  const last = h[h.length - 1];
  const now = Date.now();
  if (!force && last && now - last.at < SNAP_GAP) return;
  const cur = sig(obj);
  if (last && last.sig === cur) return;
  if (!hasContent(obj.blocks) && !last) return;
  h.push({ at: now, sig: cur, title: obj.title, blocks: structuredClone(obj.blocks) });
  if (h.length > SNAP_MAX) h.shift();
}
export function restoreSnapshot(obj, i) {
  snapshot(obj, true);
  const v = obj.history[i]; if (!v) return;
  obj.title = v.title; obj.blocks = structuredClone(v.blocks);
  touch(obj, true);
}

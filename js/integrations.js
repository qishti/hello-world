import { S, runtime, touch, walk, createObject, findByTitle, newBlock, meetingBlocks, collectTasks, objectsOfType, ensureObject, getObject, ensureDaily } from './store.js';
import { parseICS, expand } from './ics.js';
import { dateKey, todayKey, fmtTime, parseKey } from './util.js';
import { toast } from './ui.js';
import * as hooks from './hooks.js';

// ---------- network (optional local proxy for CORS) ----------
export async function detectProxy() {
  const base = (S.settings.proxy || '').replace(/\/$/, '') || '.';
  try {
    const r = await fetch(`${base}/proxy/health`, { cache: 'no-store' });
    runtime.proxy = r.ok && (await r.json()).ok === true;
    runtime.proxyBase = base;
  } catch { runtime.proxy = false; }
}
async function net(url, opts = {}) {
  const target = runtime.proxy ? `${runtime.proxyBase}/proxy?url=${encodeURIComponent(url)}` : url;
  let r;
  try { r = await fetch(target, opts); } catch (e) {
    throw new Error(runtime.proxy ? `Network error: ${e.message}` : 'The browser blocked this request (CORS). Run `node server.js` and open Folio from it to enable the local proxy.');
  }
  return r;
}

// ---------- Calendar (ICS feeds) ----------
export async function syncCalendars() {
  const urls = S.settings.icsUrls.filter((u) => u.url);
  let n = 0; const errors = [];
  for (const src of urls) {
    try {
      const r = await net(src.url.replace(/^webcal:/i, 'https:'));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const events = parseICS(await r.text());
      S.cache.cal['url:' + src.url] = { name: src.name, color: src.color, at: Date.now(), events };
      n += events.length;
    } catch (e) { errors.push(`${src.name || 'Calendar'}: ${e.message}`); }
  }
  touch();
  return { n, errors };
}
export function importICSText(name, text) {
  const events = parseICS(text);
  S.cache.cal['file:' + name] = { name, color: '#6558f5', at: Date.now(), events };
  touch(); return events.length;
}
export function removeCalendar(key) { delete S.cache.cal[key]; touch(); }
export function eventsBetween(fromMs, toMs) {
  const out = [];
  for (const [key, c] of Object.entries(S.cache.cal || {})) {
    for (const e of expand(c.events, fromMs, toMs)) out.push({ ...e, cal: c.name, color: c.color, calKey: key });
  }
  return out.sort((a, b) => a.start - b.start);
}
export function eventsOn(key) {
  const d = parseKey(key); const from = d.getTime(); const to = from + 864e5;
  return eventsBetween(from, to).filter((e) => (e.allDay ? e.start >= from && e.start < to : e.start < to && e.end > from));
}
export const hasCalendars = () => Object.keys(S.cache.cal || {}).length > 0;
export const eventTime = (e) => (e.allDay ? 'All day' : `${fmtTime(new Date(e.start))} – ${fmtTime(new Date(e.end))}`);

const prettyName = (a) => {
  if (a.name) return a.name.replace(/[\[\]|]/g, '');
  const local = a.email.split('@')[0].replace(/[._-]+/g, ' ');
  return local.replace(/\b\w/g, (c) => c.toUpperCase());
};
export function meetingForEvent(ev) {
  return Object.values(S.objects).find((o) => o.type === 'meeting' && o.props?.eventId === ev.id);
}
/** Create (or return) a meeting note for a calendar event; attendees become linked Person objects. */
export function meetingFromEvent(ev) {
  const found = meetingForEvent(ev); if (found) return found;
  const names = [];
  for (const a of ev.attendees.slice(0, 12)) {
    if (!a.email && !a.name) continue;
    const name = prettyName(a);
    let p = findByTitle(name);
    if (!p) p = createObject({ type: 'person', title: name, props: a.email ? { email: a.email } : {} });
    names.push(`[[${p.title}]]`);
  }
  const date = new Date(ev.start);
  let title = ev.title; let n = 2;
  while (findByTitle(title) && findByTitle(title).props?.eventId !== ev.id) title = `${ev.title} (${dateKey(date)}${n > 2 ? ' ' + n : ''})`, n++;
  return createObject({
    type: 'meeting', title, blocks: meetingBlocks(names.join(' ')),
    props: { date: dateKey(date), time: eventTime(ev), location: ev.location || '', link: ev.link || '', eventId: ev.id },
  });
}

// ---------- Todoist ----------
const TD = 'https://api.todoist.com/api/v1';
async function td(path, { method = 'GET', body } = {}) {
  const tok = S.settings.todoistToken; if (!tok) throw new Error('Add your Todoist API token in Settings.');
  const r = await net(TD + path, { method, headers: { Authorization: `Bearer ${tok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`Todoist ${r.status}: ${(await r.text()).slice(0, 120)}`);
  if (r.status === 204) return null;
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
async function tdAll(path) {
  const out = []; let cursor = null;
  do {
    const r = await td(`${path}${path.includes('?') ? '&' : '?'}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (Array.isArray(r)) { out.push(...r); break; }
    out.push(...(r?.results || [])); cursor = r?.next_cursor || null;
  } while (cursor);
  return out;
}
export const todoistConnected = () => !!S.settings.todoistToken;

export async function syncTodoist() {
  const [projects, tasks] = await Promise.all([tdAll('/projects'), tdAll('/tasks')]);
  const pmap = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  const open = tasks.map((t) => ({
    id: String(t.id), content: t.content, due: t.due?.date ? t.due.date.slice(0, 10) : null, time: t.due?.date?.includes('T') ? t.due.date : null,
    project: pmap[t.project_id] || '', priority: t.priority || 1, labels: t.labels || [], url: t.url || `https://app.todoist.com/app/task/${t.id}`, parent: t.parent_id || null,
  }));
  const ids = new Set(open.map((t) => t.id));
  let completed = 0;
  for (const { obj, block } of collectTasks()) {
    const tid = block.task.todoistId; if (!tid) continue;
    const rem = open.find((t) => t.id === tid);
    if (!rem && block.task.status !== 'done') { block.task.status = 'done'; block.task.completedAt = Date.now(); completed++; touch(obj); }
    else if (rem && block.task.due !== rem.due && rem.due) { block.task.due = rem.due; touch(obj); }
  }
  S.cache.todoist = { at: Date.now(), tasks: open, projects: projects.map((p) => ({ id: String(p.id), name: p.name })) };
  touch();
  return { n: open.length, completed };
}
export const todoistOpen = () => (S.cache.todoist?.tasks || []);
export function linkedTodoistIds() {
  const s = new Set(); collectTasks().forEach(({ block }) => block.task.todoistId && s.add(block.task.todoistId)); return s;
}

export async function todoistSend(block) {
  if (!todoistConnected()) return toast('Add a Todoist token in Settings first', { kind: 'warn' });
  if (block.task?.todoistId) return toast('Already in Todoist');
  const body = { content: block.text.replace(/\[\[|\]\]/g, '').replace(/\*\*|==|~~/g, '') || 'Untitled task' };
  if (block.task.due) body.due_date = block.task.due;
  if (block.task.remind && !block.task.due) body.due_datetime = new Date(block.task.remind).toISOString().replace(/\.\d+Z$/, 'Z');
  try {
    const t = await td('/tasks', { method: 'POST', body });
    block.task.todoistId = String(t.id); touch(); toast('Sent to Todoist');
    window.dispatchEvent(new Event('folio:refresh'));
  } catch (e) { toast(e.message, { kind: 'warn', ms: 6000 }); }
}
async function todoistToggle(block) {
  const id = block.task?.todoistId; if (!id || !todoistConnected()) return;
  try { await td(`/tasks/${id}/${block.task.status === 'done' ? 'close' : 'reopen'}`, { method: 'POST' }); } catch (e) { toast(e.message, { kind: 'warn', ms: 6000 }); }
}
async function todoistUpdateDue(block) {
  const id = block.task?.todoistId; if (!id || !todoistConnected()) return;
  try { await td(`/tasks/${id}`, { method: 'POST', body: block.task.due ? { due_date: block.task.due } : { due_string: 'no date' } }); } catch (e) { toast(e.message, { kind: 'warn', ms: 6000 }); }
}
export async function todoistComplete(t) {
  try { await td(`/tasks/${t.id}/close`, { method: 'POST' }); S.cache.todoist.tasks = S.cache.todoist.tasks.filter((x) => x.id !== t.id); touch(); } catch (e) { toast(e.message, { kind: 'warn', ms: 6000 }); }
}
export async function todoistAddQuick(content, due) {
  const t = await td('/tasks', { method: 'POST', body: { content, ...(due ? { due_date: due } : {}) } });
  return t;
}
/** Import a Todoist task into the outline as a local task block (linked by id). */
export function importTodoistTask(t, dailyObj) {
  const b = newBlock(t.content, { task: { status: 'todo', due: t.due || undefined, todoistId: t.id } });
  dailyObj.blocks.push(b); touch(dailyObj, true); return b;
}

// ---------- Readwise ----------
export const readwiseConnected = () => !!S.settings.readwiseToken;
const CAT = { books: 'Book', articles: 'Article', tweets: 'Tweet', podcasts: 'Podcast', supplementals: 'Other' };
export async function syncReadwise(onProgress = () => {}) {
  const tok = S.settings.readwiseToken; if (!tok) throw new Error('Add your Readwise access token in Settings.');
  let cursor = null; let books = 0; let hl = 0;
  const after = S.cache.readwiseSyncedAt;
  const started = new Date().toISOString();
  do {
    const qs = new URLSearchParams(); if (after) qs.set('updatedAfter', after); if (cursor) qs.set('pageCursor', cursor);
    const r = await net(`https://readwise.io/api/v2/export/?${qs}`, { headers: { Authorization: `Token ${tok}` } });
    if (r.status === 429) { await new Promise((res) => setTimeout(res, (+r.headers.get('Retry-After') || 10) * 1000)); continue; }
    if (!r.ok) throw new Error(r.status === 401 ? 'Readwise rejected the token.' : `Readwise error ${r.status}`);
    const data = await r.json();
    for (const bk of data.results || []) { hl += upsertSource(bk); books++; }
    onProgress(books, hl);
    cursor = data.nextPageCursor || null;
  } while (cursor);
  S.cache.readwiseSyncedAt = started; touch(null, true);
  return { books, highlights: hl };
}
function upsertSource(bk) {
  const rwId = String(bk.user_book_id);
  let o = Object.values(S.objects).find((x) => x.type === 'source' && x.props?.rwId === rwId);
  const title = (bk.readable_title || bk.title || 'Untitled').trim();
  if (!o) {
    let t = title; if (findByTitle(t)) t = `${title} (${bk.author || 'Readwise'})`;
    o = createObject({ type: 'source', title: t, blocks: [], props: { rwId } });
  }
  Object.assign(o.props, { author: bk.author || '', category: CAT[bk.category] || 'Other', url: bk.source_url || bk.unique_url || '', cover: bk.cover_image_url || '', readwise: bk.readwise_url || '' });
  let added = 0; let changed = 0;
  const findHl = (id) => { let f = null; walk(o.blocks, (b) => { if (b.rw === id) f = b; }); return f; };
  const drop = (arr, blk) => { const i = arr.indexOf(blk); if (i >= 0) { arr.splice(i, 1); return true; } for (const x of arr) if (drop(x.children, blk)) return true; return false; };
  for (const hl of bk.highlights || []) {
    const id = String(hl.id); const f = findHl(id);
    const tags = (hl.tags || []).map((t) => (t.name || t).toString().replace(/\s+/g, '-')).filter(Boolean);
    // Highlights you have edited or annotated in Folio are never overwritten or removed.
    if (hl.is_deleted) {
      if (f && f.text === (f.rwText ?? f.text) && !f.children.some((c) => !c.rwNote && c.text.trim())) { drop(o.blocks, f); changed++; }
      continue;
    }
    if (f) {
      if (f.text === (f.rwText ?? f.text) && f.text !== hl.text) { f.text = hl.text; changed++; }
      f.rwText = hl.text;
      const nb = f.children.find((c) => c.rwNote);
      if (hl.note) { if (!nb) f.children.unshift(newBlock(hl.note, { rwNote: true, rwText: hl.note })); else { if (nb.text === (nb.rwText ?? nb.text)) nb.text = hl.note; nb.rwText = hl.note; } }
      else if (nb && nb.text === (nb.rwText ?? nb.text)) f.children.splice(f.children.indexOf(nb), 1);
      f.color = hl.color || f.color; f.hlTags = tags; f.loc = hl.location || f.loc;
      continue;
    }
    const kids = hl.note ? [newBlock(hl.note, { rwNote: true, rwText: hl.note })] : [];
    o.blocks.push(newBlock(hl.text, { type: 'quote', rw: id, rwText: hl.text, children: kids, loc: hl.location || null, at: hl.highlighted_at || null, color: hl.color || null, hlTags: tags }));
    added++;
  }
  o.blocks = o.blocks.filter((b, i, arr) => b.text || b.children.length || b.rw || arr.length === 1);
  if (!o.blocks.length) o.blocks.push(newBlock(''));
  touch(o, true);
  return added + changed;
}
/** Quiet incremental sync; returns the number of new or changed highlights. */
export async function autoReadwise() {
  if (!readwiseConnected() || S.settings.readwiseAuto === false) return 0;
  const r = await syncReadwise(); return r.highlights;
}
/** All highlights from Readwise sources and PDFs, as {block, obj, note, kind}. */
export function allHighlights() {
  const out = [];
  for (const o of Object.values(S.objects)) {
    if (o.type !== 'source' && o.type !== 'pdf') continue;
    walk(o.blocks, (b) => {
      if (b.rwNote || b.img || !b.text.trim()) return;
      if (b.rw || (b.pdf && b.pdf.color !== 'snap')) out.push({ block: b, obj: o, note: (b.children.find((c) => c.rwNote) || b.children[0])?.text || '', kind: b.rw ? 'readwise' : 'pdf' });
    });
  }
  return out;
}

export function randomHighlight() {
  const pool = [];
  for (const o of objectsOfType('source')) walk(o.blocks, (b) => { if (b.rw && b.text.length > 30 && b.text.length < 420) pool.push({ o, b }); });
  if (!pool.length) return null;
  const seed = Number(todayKey().replace(/-/g, '')); return pool[seed % pool.length];
}

// ---------- Reminders ----------
let notifyAsked = false;
export function askNotify() {
  if (notifyAsked || !('Notification' in window) || Notification.permission !== 'default') return;
  notifyAsked = true; Notification.requestPermission().catch(() => {});
}
export function startReminders(onFire) {
  const tick = () => {
    const now = Date.now();
    for (const { obj, block } of collectTasks()) {
      const t = block.task;
      if (!t.remind || t.notified || t.status === 'done') continue;
      if (new Date(t.remind).getTime() <= now) {
        t.notified = true; touch(obj);
        const text = block.text.replace(/\[\[|\]\]/g, '') || 'Reminder';
        try { if (Notification.permission === 'granted') new Notification('Reminder', { body: text, tag: block.id }); } catch { /* unsupported */ }
        onFire(obj, block, text);
      }
    }
  };
  tick(); return setInterval(tick, 15000);
}

hooks.bind({ todoistSend, todoistToggle, todoistUpdateDue, askNotify });

// ---------- Email in (IMAP via the local server) ----------
const EMAIL_TAG = 'email';
async function mailApi(path, { method = 'GET', body } = {}) {
  if (!runtime.proxy) throw new Error('Email-in needs the local server. Run `node server.js` and open Folio from it.');
  const r = await fetch(`${runtime.proxyBase}/mail/${path}`, { method, headers: { 'x-folio': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Mail server error ${r.status}`);
  return j;
}
export const emailStatus = () => mailApi('status');
export const emailSave = (c) => mailApi('config', { method: 'POST', body: c });
export const emailDisconnect = () => mailApi('config', { method: 'DELETE' });

/** Add one message to the daily note it arrived on, tagged #email. */
export function ingestEmail(m) {
  const seen = (S.cache.emailIds ||= []);
  if (seen.includes(m.id)) return false;
  const day = ensureDaily(dateKey(new Date(m.received || m.date)));
  const from = m.from?.name || m.from?.address || 'unknown sender';
  const clean = (t) => t.replace(/[\[\]]/g, '').replace(/\*\*/g, '');
  const subj = clean(m.subject);
  const asTask = /^(todo|task)\s*[:\-]\s*/i.test(subj);
  const title = subj.replace(/^(todo|task)\s*[:\-]\s*/i, '');
  const kids = [];
  const paras = (m.text || '').split(/\n{2,}/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  paras.slice(0, 14).forEach((p) => kids.push(newBlock(p.length > 700 ? p.slice(0, 700) + '…' : p)));
  if (paras.length > 14) kids.push(newBlock('…message continues in your mailbox'));
  if (m.links?.length) kids.push(newBlock(`**Links** ${m.links.slice(0, 5).join('  ')}`));
  if (m.attachments?.length) kids.push(newBlock(`**Attachments** ${m.attachments.join(', ')} (not imported)`));
  const head = newBlock(`#${EMAIL_TAG} **${title}** from ${clean(from)}`, {
    children: kids, collapsed: (m.text || '').length > 500, email: { id: m.id, from: m.from?.address || '', subject: m.subject, sent: m.date },
    ...(asTask ? { task: { status: 'todo', due: day.date } } : {}),
  });
  const last = day.blocks[day.blocks.length - 1];
  if (last && !last.text && !last.children.length && !last.task) day.blocks.splice(day.blocks.length - 1, 0, head); else day.blocks.push(head);
  ensureObject(EMAIL_TAG, 'tag');
  seen.push(m.id); if (seen.length > 3000) seen.splice(0, seen.length - 3000);
  touch(day, true);
  return true;
}

/** Fetch queued mail from the server, file it, then acknowledge so it is not delivered twice. */
export async function pullEmail({ poll = false } = {}) {
  const r = poll ? await mailApi('poll', { method: 'POST' }) : await mailApi('inbox');
  const msgs = r.messages || []; let n = 0;
  for (const m of msgs) if (ingestEmail(m)) n++;
  if (msgs.length) await mailApi('ack', { method: 'POST', body: { ids: msgs.map((m) => m.id) } });
  return { n, status: r.status };
}

import { h, esc, todayKey, addDays, parseKey, dateKey, dailyTitle, relDate, relDateTime, timeAgo, WEEKDAYS, MONTHS_LONG, download, copyText, fmtTime, pad } from './util.js';
import { icon, ICON_NAMES } from './icons.js';
import { S, runtime, getObject, typeOf, ensureDaily, createObject, deleteObject, renameObject, touch, backlinks, unlinkedMentions, linkMention, objectsOfType, allObjects, collectTasks, toggleFavorite, outgoing, walk, newBlock, toggleTask, saveNow, findByTitle, snapshot, restoreSnapshot, linksIn } from './store.js';
import { mountOutline } from './outline.js';
import { renderInline, chip } from './inline.js';
import { showMenu, toast, confirmBox, promptBox, modal, closeMenu } from './ui.js';
import * as I from './integrations.js';
import * as hooks from './hooks.js';
import { objectToMarkdown, downloadZip, downloadSingle } from './export.js';
import { Reader, pickPDF } from './reader.js';

let reader = null;
export const stopReader = () => { reader?.destroy(); reader = null; };

export const go = (hash) => { location.hash = hash; };
const main = () => document.getElementById('main-body');
let setActions = () => {};
export const bindChrome = (fn) => { setActions = fn; };
const rerender = () => window.dispatchEvent(new Event('folio:refresh'));

function typeBadge(t) { return h('span', { class: 'type-ic', style: { '--c': t.color }, html: icon(t.icon, 14) }); }

// ======================================================================
// Object page
// ======================================================================
export function renderObject(id, focusBlock) {
  const obj = getObject(id);
  const root = main(); root.textContent = '';
  if (!obj) { root.append(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('h2', null, 'Object not found'), h('p', null, 'It may have been deleted.'), h('button', { class: 'btn', onclick: () => go('#/daily') }, 'Go to today')))); return; }
  if (obj.type === 'daily') return renderDaily(obj.date);
  const t = typeOf(obj);
  const page = h('div', { class: 'page' });
  setActions(objActions(obj));

  const title = h('textarea', { class: 'title-input', rows: '1', placeholder: 'Untitled', spellcheck: 'false', value: obj.title });
  const fit = () => { title.style.height = '0'; title.style.height = title.scrollHeight + 'px'; };
  title.addEventListener('input', fit);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); page.querySelector('.blk-view, .blk-edit')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } });
  title.addEventListener('blur', () => { if (title.value.trim() !== obj.title) { renameObject(obj, title.value); document.title = obj.title + ' · Folio'; } });

  const kind = h('button', { class: 'kind-pill', style: { '--c': t.color }, html: `${icon(t.icon, 13)}<span>${esc(t.name)}</span>${icon('chevD', 12)}`, onclick: (e) => {
    showMenu({ anchor: e.currentTarget, keepFocus: false, items: Object.values(S.types).filter((x) => x.id !== 'daily').map((x) => ({ label: x.name, icon: x.icon, color: x.color, value: x.id, check: x.id === obj.type })),
      onPick: (it) => { obj.type = it.value; touch(obj, true); rerender(); } });
  } });

  const head = h('div', { class: 'obj-head' },
    obj.props?.cover ? h('img', { class: 'cover', src: obj.props.cover, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null,
    h('div', { class: 'obj-head-text' }, kind, title));
  page.append(head, propsEl(obj));
  const host = h('div', { class: 'outline-host' });
  let readerHost = null;
  if (obj.type === 'pdf' && obj.pdf) { readerHost = h('div', { class: 'reader-host' }); page.classList.add('reading'); page.append(readerHost, h('div', { class: 'section-label' }, 'Notes and highlights')); }
  page.append(host);
  const outline = mountOutline(host, obj);
  if (readerHost) {
    reader = new Reader(obj, readerHost, { flash: flashBlock, onAnnotate: (b, editId, plain) => {
      const only = obj.blocks.length === 1 && !obj.blocks[0].text && !obj.blocks[0].children.length;
      if (only) obj.blocks.splice(0, 1, b); else obj.blocks.push(b);
      touch(obj, true); outline.render(editId ? { id: editId, pos: 0 } : undefined);
      if (!editId) flashBlock(b.id);
    } });
  }
  page.append(refsSection(obj));
  root.append(page); fit();
  if (obj.title === 'Untitled' || obj._fresh) { title.focus(); title.select(); delete obj._fresh; }
  if (focusBlock) flashBlock(focusBlock);
}

export function flashBlock(bid) {
  setTimeout(() => { const el = document.querySelector(`[data-id="${bid}"]`); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800); } }, 40);
}

function objActions(obj) {
  const fav = S.favorites.includes(obj.id);
  return [
    h('button', { class: `icon-btn${fav ? ' on' : ''}`, title: fav ? 'Unfavorite' : 'Favorite', html: icon('star', 17), onclick: () => { toggleFavorite(obj.id); rerender(); } }),
    h('button', { class: 'icon-btn', title: 'More', html: icon('dots', 17), onclick: (e) => showMenu({ anchor: e.currentTarget, keepFocus: false, items: [
      { label: 'Present', icon: 'play', value: 'present' }, { label: 'Version history', icon: 'history', value: 'hist' }, { sep: true }, { label: 'Copy as Markdown', icon: 'copy', value: 'copy' }, { label: 'Download .md', icon: 'download', value: 'dl' }, { sep: true }, { label: 'Delete object', icon: 'trash', value: 'del', danger: true }],
    onPick: async (it) => {
      if (it.value === 'present') present(obj);
      if (it.value === 'hist') historyModal(obj);
      if (it.value === 'copy') { copyText(objectToMarkdown(obj)); toast('Copied as Markdown'); }
      if (it.value === 'dl') download(`${obj.title.replace(/[^\w -]/g, '')}.md`, objectToMarkdown(obj), 'text/markdown');
      if (it.value === 'del' && await confirmBox(`Delete “${obj.title}”? Links to it will stay as plain text.`)) { deleteObject(obj.id); go('#/daily'); }
    } }) }),
  ];
}

function propsEl(obj) {
  const defs = [{ key: 'aliases', label: 'Aliases', kind: 'aliases' }, ...(typeOf(obj).props || [])];
  const wrap = h('div', { class: 'props' });
  const shown = new Set(defs.filter((d) => (d.kind === 'aliases' ? obj.aliases?.length : obj.props[d.key])).map((d) => d.key));
  const paint = () => {
    wrap.textContent = '';
    defs.filter((d) => shown.has(d.key)).forEach((d) => {
      const val = d.kind === 'aliases' ? (obj.aliases || []).join(', ') : obj.props[d.key] || '';
      const set = (v) => { obj.props[d.key] = v; touch(obj); };
      let input;
      if (d.kind === 'aliases') input = h('input', { class: 'prop-input', type: 'text', value: val, placeholder: 'Other names that link here, comma separated', onchange: (e) => { obj.aliases = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); touch(obj, true); } });
      else if (d.kind === 'select') input = h('select', { class: 'prop-input', onchange: (e) => set(e.target.value) }, h('option', { value: '' }, '—'), d.options.map((o) => h('option', { value: o, selected: o === val }, o)));
      else if (d.kind === 'date') input = h('div', { class: 'prop-date' }, h('input', { type: 'date', class: 'prop-input', value: val, onchange: (e) => { set(e.target.value); paint(); } }), val ? h('a', { class: 'prop-open', title: 'Open daily note', onclick: () => go('#/daily/' + val), html: icon('arrowR', 13) }) : null);
      else input = h('div', { class: 'prop-date' }, h('input', { class: 'prop-input', type: 'text', value: val, placeholder: 'Empty', onchange: (e) => set(e.target.value.trim()) }), d.kind === 'url' && val ? h('a', { class: 'prop-open', href: val, target: '_blank', rel: 'noopener', html: icon('external', 13) }) : null);
      wrap.append(h('div', { class: 'prop' }, h('span', { class: 'prop-label' }, d.label), input));
    });
    const rest = defs.filter((d) => !shown.has(d.key));
    if (rest.length) wrap.append(h('button', { class: 'add-prop', html: `${icon('plus', 13)}<span>Property</span>`, onclick: (e) => showMenu({ anchor: e.currentTarget, keepFocus: false, items: rest.map((d) => ({ label: d.label, value: d.key })), onPick: (it) => { shown.add(it.value); paint(); wrap.querySelector('.prop:last-of-type .prop-input')?.focus(); } }) }));
    wrap.classList.toggle('none', !wrap.children.length);
  };
  paint(); return wrap;
}

// ---------- backlinks ----------
function refBlock(b, obj) {
  const row = h('div', { class: `ref-block${b.task ? ' is-task' : ''}${b.task?.status === 'done' ? ' done' : ''}` });
  if (b.task) row.append(h('button', { class: `check ${b.task.status}`, html: b.task.status === 'done' ? icon('check', 12) : '', onclick: (e) => { e.stopPropagation(); toggleBlockTask(b, obj); rerender(); } }));
  else row.append(h('span', { class: 'bullet' }, h('i')));
  row.append(h('div', { class: 'ref-text', html: renderInline(b.text) || '<span class="muted">Empty</span>' }));
  row.addEventListener('click', (e) => { if (e.target.closest('a, .check')) return; go(`#/o/${obj.id}?b=${b.id}`); });
  return row;
}
function refGroups(groups, label, extra) {
  const n = groups.reduce((s, g) => s + g.blocks.length, 0);
  const sec = h('section', { class: 'refs' });
  const bar = h('button', { class: 'refs-bar', html: `${icon('chevD', 14, 'caret')}<span>${label}</span><b>${n}</b>` });
  const body = h('div', { class: 'refs-body' });
  groups.forEach((g) => {
    const t = typeOf(g.obj);
    body.append(h('div', { class: 'ref-group' },
      h('a', { class: 'ref-title', onclick: () => go('#/o/' + g.obj.id), style: { '--c': t.color }, html: `${icon(t.icon, 14)}<span>${esc(g.obj.title)}</span>` }),
      g.blocks.map((b) => { const el = refBlock(b, g.obj); if (extra) el.append(extra(b, g.obj)); return el; })));
  });
  bar.addEventListener('click', () => sec.classList.toggle('closed'));
  sec.append(bar, body);
  return sec;
}
function refsSection(obj) {
  const frag = h('div', { class: 'refs-wrap' });
  const links = backlinks(obj);
  if (links.length) frag.append(refGroups(links, 'Linked references'));
  const un = unlinkedMentions(obj);
  if (un.length) {
    const sec = refGroups(un, 'Unlinked mentions', (b, o) => h('button', { class: 'btn small ghost link-btn', onclick: (e) => { e.stopPropagation(); linkMention(b, obj.title); touch(o, true); rerender(); } }, 'Link'));
    sec.classList.add('closed'); frag.append(sec);
  }
  return frag;
}

// ======================================================================
// Daily note
// ======================================================================
export function renderDaily(key) {
  key ||= todayKey();
  const obj = ensureDaily(key);
  const root = main(); root.textContent = '';
  const d = parseKey(key); const isToday = key === todayKey();
  setActions([h('button', { class: 'btn small', onclick: () => go('#/daily') }, 'Today')]);
  const page = h('div', { class: 'page daily' });
  page.append(h('div', { class: 'daily-head' },
    h('div', null,
      h('div', { class: 'daily-sub' }, isToday ? 'Today' : relDate(key) === WEEKDAYS[d.getDay()] ? '' : ''),
      h('h1', { class: 'daily-title' }, WEEKDAYS[d.getDay()]),
      h('div', { class: 'daily-date' }, `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`)),
    h('div', { class: 'daily-nav' },
      h('button', { class: 'icon-btn round', title: 'Previous day', html: icon('chevL', 18), onclick: () => go('#/daily/' + addDays(key, -1)) }),
      h('button', { class: 'icon-btn round', title: 'Next day', html: icon('chevR', 18), onclick: () => go('#/daily/' + addDays(key, 1)) }))));
  const cards = h('div', { class: 'cards' });
  const ag = agendaCard(key); if (ag) cards.append(ag);
  const tk = dayTasksCard(key); if (tk) cards.append(tk);
  if (cards.children.length) page.append(cards);
  const host = h('div', { class: 'outline-host' }); page.append(host);
  mountOutline(host, obj);
  if (isToday) { const hl = highlightCard(); if (hl) page.append(hl); }
  page.append(refsSection(obj));
  root.append(page);
}

function initials(a) { const n = a.name || a.email.split('@')[0]; return n.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join(''); }

function agendaCard(key) {
  const evs = I.eventsOn(key);
  const notes = objectsOfType('meeting').filter((m) => m.props.date === key && !evs.some((e) => e.id === m.props.eventId));
  if (!evs.length && !notes.length) {
    if (I.hasCalendars()) return null;
    return h('div', { class: 'card hint' }, h('span', { html: icon('calendar', 16) }), h('span', null, 'Connect a calendar to see your day here.'), h('a', { class: 'link', onclick: () => go('#/settings') }, 'Set up'));
  }
  const card = h('div', { class: 'card' }, h('div', { class: 'card-head', html: `${icon('calendar', 15)}<span>Agenda</span><b>${evs.length + notes.length}</b>` }));
  const now = Date.now();
  evs.forEach((e) => {
    const m = I.meetingForEvent(e);
    const live = !e.allDay && e.start <= now && e.end > now;
    card.append(h('div', { class: `ev${live ? ' live' : ''}${!e.allDay && e.end < now && key === todayKey() ? ' past' : ''}`, style: { '--c': e.color || 'var(--accent)' } },
      h('span', { class: 'ev-bar' }),
      h('div', { class: 'ev-time' }, e.allDay ? 'All day' : fmtTime(new Date(e.start))),
      h('div', { class: 'ev-main' }, h('div', { class: 'ev-title' }, e.title), e.allDay ? null : h('div', { class: 'ev-meta' }, `${I.eventTime(e)}${e.location ? ' · ' + e.location.split('\n')[0].slice(0, 40) : ''}`)),
      h('div', { class: 'ev-people' }, e.attendees.slice(0, 3).map((a) => h('span', { class: 'avatar', title: a.name || a.email }, initials(a))), e.attendees.length > 3 ? h('span', { class: 'avatar more' }, '+' + (e.attendees.length - 3)) : null),
      e.link ? h('a', { class: 'btn small ghost', href: e.link, target: '_blank', rel: 'noopener' }, 'Join') : null,
      h('button', { class: `btn small${m ? '' : ' primary-soft'}`, onclick: () => { const mo = m || I.meetingFromEvent(e); go('#/o/' + mo.id); } }, m ? 'Open note' : 'Meeting note')));
  });
  notes.forEach((m) => card.append(h('div', { class: 'ev' , style: { '--c': typeOf(m).color } }, h('span', { class: 'ev-bar' }), h('div', { class: 'ev-time' }, m.props.time?.split(' ')[0] || ''), h('div', { class: 'ev-main' }, h('div', { class: 'ev-title' }, m.title), h('div', { class: 'ev-meta' }, 'Meeting note')), h('button', { class: 'btn small', onclick: () => go('#/o/' + m.id) }, 'Open note'))));
  return card;
}

export function toggleBlockTask(b, obj) {
  toggleTask(b, obj, (x) => hooks.todoistToggle(x));
}

function dayTasksCard(key) {
  const today = todayKey();
  const local = collectTasks().filter(({ block: b }) => b.task.status !== 'done' && (b.task.due === key || (key === today && b.task.due && b.task.due < today) || (!b.task.due && b.task.remind && dateKey(new Date(b.task.remind)) === key)));
  const linked = I.linkedTodoistIds();
  const remote = I.todoistOpen().filter((t) => !linked.has(t.id) && t.due && (t.due === key || (key === today && t.due < today)));
  if (!local.length && !remote.length) return null;
  const card = h('div', { class: 'card' }, h('div', { class: 'card-head', html: `${icon('check', 15)}<span>Tasks</span><b>${local.length + remote.length}</b>` }));
  local.forEach((it) => card.append(taskRow({ kind: 'local', ...it }, rerender, true)));
  remote.forEach((t) => card.append(taskRow({ kind: 'todoist', t }, rerender, true)));
  return card;
}

function highlightCard() {
  const r = I.randomHighlight(); if (!r) return null;
  return h('div', { class: 'card quote-card' },
    h('div', { class: 'card-head', html: `${icon('sparkle', 15)}<span>From your reading</span>` }),
    h('blockquote', { html: renderInline(r.b.text) }),
    h('a', { class: 'ref-title', style: { '--c': S.types.source.color }, onclick: () => go(`#/o/${r.o.id}?b=${r.b.id}`), html: `${icon('book', 14)}<span>${esc(r.o.title)}</span>${r.o.props.author ? `<em>${esc(r.o.props.author)}</em>` : ''}` }));
}

// ======================================================================
// Tasks
// ======================================================================
export function taskRow(it, refresh, compact) {
  const row = h('div', { class: 'task-row' });
  if (it.kind === 'local') {
    const { block: b, obj } = it;
    const done = b.task.status === 'done';
    row.classList.toggle('done', done);
    row.append(h('button', { class: `check ${b.task.status}`, html: done ? icon('check', 12) : '', onclick: () => { toggleBlockTask(b, obj); refresh(); } }),
      h('div', { class: 'task-main' }, h('div', { class: 'task-text', html: renderInline(b.text) || '<span class="muted">Untitled task</span>', onclick: (e) => { if (!e.target.closest('a')) go(`#/o/${obj.id}?b=${b.id}`); } }),
        compact ? null : h('a', { class: 'task-src', onclick: () => go('#/o/' + obj.id), html: `${icon(typeOf(obj).icon, 12)}<span>${esc(obj.title)}</span>` })),
      taskMeta(b.task));
  } else {
    const t = it.t;
    row.append(h('button', { class: 'check todo', onclick: async () => { await I.todoistComplete(t); refresh(); } }),
      h('div', { class: 'task-main' }, h('div', { class: 'task-text' }, t.content), compact ? null : h('span', { class: 'task-src td', html: `${icon('external', 11)}<span>Todoist${t.project ? ' · ' + esc(t.project) : ''}</span>` })),
      h('div', { class: 'task-meta' }, t.priority > 1 ? h('span', { class: `prio p${5 - t.priority}`, title: `Priority ${5 - t.priority}` }, 'P' + (5 - t.priority)) : null,
        t.due ? h('span', { class: `chip due${t.due < todayKey() ? ' overdue' : ''}${t.due === todayKey() ? ' today' : ''}`, html: `${icon('calendar', 12)}<span>${esc(relDate(t.due))}</span>` }) : null),
      h('a', { class: 'icon-btn small', href: t.url, target: '_blank', rel: 'noopener', title: 'Open in Todoist', html: icon('external', 13) }));
  }
  return row;
}
function taskMeta(t) {
  const out = [];
  if (t.due) out.push(h('span', { class: `chip due${t.due < todayKey() && t.status !== 'done' ? ' overdue' : ''}${t.due === todayKey() ? ' today' : ''}`, html: `${icon('calendar', 12)}<span>${esc(relDate(t.due))}</span>` }));
  if (t.remind) out.push(h('span', { class: 'chip remind', html: `${icon('bell', 12)}<span>${esc(relDateTime(t.remind))}</span>` }));
  if (t.todoistId) out.push(h('span', { class: 'chip todoist', html: `${icon('external', 11)}<span>Todoist</span>` }));
  return h('div', { class: 'task-meta' }, out);
}

let taskTab = 'open';
export function renderTasks() {
  const root = main(); root.textContent = '';
  setActions([]);
  const page = h('div', { class: 'page' });
  const today = todayKey();
  page.append(h('div', { class: 'view-head' }, h('h1', null, 'Tasks'),
    I.todoistConnected() ? h('button', { class: 'btn small', onclick: async (e) => { e.currentTarget.disabled = true; try { const r = await I.syncTodoist(); toast(`Todoist synced · ${r.n} open`); } catch (err) { toast(err.message, { kind: 'warn', ms: 7000 }); } renderTasks(); } , html: `${icon('refresh', 14)}<span>Sync Todoist</span>` }) : h('button', { class: 'btn small', onclick: () => go('#/settings') }, 'Connect Todoist')));

  const input = h('input', { class: 'quick-add', placeholder: 'Add a task…  (try “call Sam tomorrow”)', onkeydown: (e) => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    let text = input.value.trim(); let due = today;
    const m = /\s+(today|tomorrow|tmrw)$/i.exec(text);
    if (m) { text = text.slice(0, m.index); due = /today/i.test(m[1]) ? today : addDays(today, 1); }
    const daily = ensureDaily(today);
    const last = daily.blocks[daily.blocks.length - 1];
    const b = newBlock(text, { task: { status: 'todo', due } });
    if (last && !last.text && !last.children.length && !last.task) daily.blocks.splice(daily.blocks.length - 1, 1, b); else daily.blocks.push(b);
    touch(daily, true); input.value = ''; renderTasks();
  } });
  page.append(h('div', { class: 'quick-wrap', html: icon('plus', 16) }, input));
  page.querySelector('.quick-wrap').append(input);

  const tabs = h('div', { class: 'tabs' }, [['open', 'Open'], ['done', 'Completed'], ['remind', 'Reminders']].map(([k, l]) => h('button', { class: `tab${taskTab === k ? ' on' : ''}`, onclick: () => { taskTab = k; renderTasks(); } }, l)));
  page.append(tabs);

  const all = collectTasks();
  const linked = I.linkedTodoistIds();
  if (taskTab === 'open') {
    const items = [...all.filter((x) => x.block.task.status !== 'done').map((x) => ({ kind: 'local', ...x, due: x.block.task.due || (x.block.task.remind ? dateKey(new Date(x.block.task.remind)) : null) })),
      ...I.todoistOpen().filter((t) => !linked.has(t.id)).map((t) => ({ kind: 'todoist', t, due: t.due }))];
    const groups = [['Overdue', (i) => i.due && i.due < today, 'overdue'], ['Today', (i) => i.due === today], ['Upcoming', (i) => i.due && i.due > today], ['No date', (i) => !i.due]];
    let shown = 0;
    groups.forEach(([label, fn, cls]) => {
      const g = items.filter(fn).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
      if (!g.length) return; shown += g.length;
      page.append(h('section', { class: `task-group ${cls || ''}` }, h('div', { class: 'group-head' }, h('span', null, label), h('b', null, g.length)), g.map((i) => taskRow(i, renderTasks))));
    });
    if (!shown) page.append(h('div', { class: 'empty small' }, h('div', { html: icon('check', 28) }), h('p', null, 'Nothing to do. Add a task above or press ⌘↵ on any bullet.')));
  } else if (taskTab === 'done') {
    const g = all.filter((x) => x.block.task.status === 'done').sort((a, b) => (b.block.task.completedAt || 0) - (a.block.task.completedAt || 0)).slice(0, 80);
    page.append(g.length ? h('section', { class: 'task-group' }, g.map((x) => taskRow({ kind: 'local', ...x }, renderTasks))) : h('div', { class: 'empty small' }, h('p', null, 'Completed tasks show up here.')));
  } else {
    const g = all.filter((x) => x.block.task.remind && x.block.task.status !== 'done').sort((a, b) => a.block.task.remind.localeCompare(b.block.task.remind));
    page.append(g.length ? h('section', { class: 'task-group' }, g.map((x) => taskRow({ kind: 'local', ...x }, renderTasks))) : h('div', { class: 'empty small' }, h('div', { html: icon('bell', 28) }), h('p', null, 'Use / → Reminder on any bullet to get notified.')));
  }
  root.append(page);
}

// ======================================================================
// Calendar (month)
// ======================================================================
let calMonth = null;
export function renderCalendar(arg) {
  const root = main(); root.textContent = '';
  setActions([h('button', { class: 'btn small', onclick: () => go('#/calendar') }, 'Today')]);
  const base = arg ? parseKey(arg + '-01') : new Date(); base.setDate(1);
  const y = base.getFullYear(); const m = base.getMonth();
  const first = new Date(y, m, 1); const startOff = (first.getDay() + 6) % 7; // Monday first
  const gridStart = new Date(y, m, 1 - startOff); const gridEnd = new Date(gridStart); gridEnd.setDate(gridEnd.getDate() + 42);
  const evs = I.eventsBetween(gridStart.getTime(), gridEnd.getTime());
  const key = (d) => dateKey(d);
  const prev = dateKey(new Date(y, m - 1, 1)).slice(0, 7); const next = dateKey(new Date(y, m + 1, 1)).slice(0, 7);
  const page = h('div', { class: 'page wide' });
  page.append(h('div', { class: 'view-head' }, h('h1', null, `${MONTHS_LONG[m]} `, h('span', { class: 'muted' }, y)),
    h('div', { class: 'daily-nav' }, h('button', { class: 'icon-btn round', html: icon('chevL', 18), onclick: () => go('#/calendar/' + prev) }), h('button', { class: 'icon-btn round', html: icon('chevR', 18), onclick: () => go('#/calendar/' + next) }))));
  const grid = h('div', { class: 'month' }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => h('div', { class: 'dow' }, d)));
  const today = todayKey();
  const tasksBy = {}; collectTasks().forEach(({ block: b }) => { const k = b.task.due; if (k && b.task.status !== 'done') tasksBy[k] = (tasksBy[k] || 0) + 1; });
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart); d.setDate(d.getDate() + i); const k = key(d);
    const dayEvs = evs.filter((e) => { const s = dateKey(new Date(e.start)); return s === k || (e.allDay && e.start <= d.getTime() && e.end > d.getTime()); });
    const has = S.objects['d-' + k] && (S.objects['d-' + k].blocks.some((b) => b.text || b.children.length));
    grid.append(h('div', { class: `day${d.getMonth() !== m ? ' out' : ''}${k === today ? ' today' : ''}`, onclick: (e) => { if (!e.target.closest('.pill')) go('#/daily/' + k); } },
      h('div', { class: 'day-num' }, h('span', null, d.getDate()), has ? h('i', { class: 'dot', title: 'Has notes' }) : null, tasksBy[k] ? h('em', { class: 'task-count', title: 'Tasks due' }, tasksBy[k]) : null),
      dayEvs.slice(0, 3).map((e) => h('div', { class: `pill${e.allDay ? ' allday' : ''}`, style: { '--c': e.color || 'var(--accent)' }, title: `${e.title}\n${I.eventTime(e)}`, onclick: () => go('#/o/' + (I.meetingForEvent(e) || I.meetingFromEvent(e)).id) }, e.allDay ? '' : h('b', null, fmtTime(new Date(e.start)).replace(' ', '')), ' ', e.title)),
      dayEvs.length > 3 ? h('div', { class: 'more' }, `+${dayEvs.length - 3} more`) : null));
  }
  page.append(grid);
  if (!I.hasCalendars()) page.append(h('div', { class: 'card hint' }, h('span', { html: icon('calendar', 16) }), h('span', null, 'Add your Google, Apple or Outlook calendar feed to see events here.'), h('a', { class: 'link', onclick: () => go('#/settings') }, 'Set up')));
  root.append(page);
}

// ======================================================================
// Type list
// ======================================================================
export function renderType(tid) {
  const t = S.types[tid]; const root = main(); root.textContent = '';
  if (!t) return go('#/daily');
  setActions([]);
  S.settings.views ||= {};
  const selectProp = (t.props || []).find((p) => p.kind === 'select');
  const modes = [['grid', 'Gallery', 'grid'], ['table', 'Table', 'table'], ['list', 'List', 'list'], ...(selectProp ? [['board', `Board`, 'board']] : [])];
  let mode = S.settings.views[tid] || 'grid'; if (!modes.some((m) => m[0] === mode)) mode = 'grid';
  let q = ''; let tag = ''; let sort = { k: tid === 'daily' ? 'date' : 'updated', dir: -1 };
  const page = h('div', { class: 'page wide' });
  const body = h('div', { class: 'type-body' });
  const preview = (o) => { let p = ''; walk(o.blocks, (b) => { if (p.length < 140 && b.text.trim()) p += (p ? ' · ' : '') + b.text.replace(/\[\[|\]\]|\*\*/g, ''); }); return p.slice(0, 140) || 'Empty'; };
  const tagsOf = (o) => { const set = new Set(); walk(o.blocks, (b) => linksIn(b.text).forEach((l) => set.add(l))); return set; };
  const open = (o) => go('#/o/' + o.id);
  const items = () => {
    let r = objectsOfType(tid).filter((o) => o.title.toLowerCase().includes(q));
    if (tag) r = r.filter((o) => tagsOf(o).has(tag));
    const val = (o) => (sort.k === 'title' ? o.title.toLowerCase() : sort.k === 'date' ? o.date || '' : sort.k === 'updated' ? o.updated : (o.props?.[sort.k] || '').toLowerCase());
    return r.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
  };
  const card = (o) => h('a', { class: 'obj-card', onclick: () => open(o), style: { '--c': t.color } },
    o.props?.cover ? h('img', { class: 'obj-cover', src: o.props.cover, loading: 'lazy', alt: '', onerror: (e) => e.target.remove() }) : null,
    h('div', { class: 'obj-card-top' }, typeBadge(t), h('span', { class: 'obj-card-time' }, timeAgo(o.updated))),
    h('div', { class: 'obj-card-title' }, o.title), h('div', { class: 'obj-card-prev' }, preview(o)), o.props?.author ? h('div', { class: 'obj-card-sub' }, o.props.author) : null);
  const paint = () => {
    body.textContent = ''; const list = items();
    if (!list.length) { body.append(h('div', { class: 'empty small' }, h('p', null, `No ${t.plural.toLowerCase()} yet.`))); return; }
    if (mode === 'grid') body.append(h('div', { class: 'grid' }, list.map(card)));
    else if (mode === 'list') body.append(h('div', { class: 'olist' }, list.map((o) => h('a', { class: 'orow', onclick: () => open(o), style: { '--c': t.color } }, typeBadge(t), h('span', { class: 'orow-title' }, o.title), h('span', { class: 'orow-prev' }, preview(o)), h('span', { class: 'orow-time' }, timeAgo(o.updated))))));
    else if (mode === 'table') {
      const cols = [{ k: 'title', l: 'Title' }, ...(t.props || []).filter((p) => !['url'].includes(p.kind)).slice(0, 4).map((p) => ({ k: p.key, l: p.label, kind: p.kind })), { k: 'updated', l: 'Updated' }];
      const th = (c) => h('th', { class: sort.k === c.k ? 'sorted' : '', onclick: () => { sort = { k: c.k, dir: sort.k === c.k ? -sort.dir : 1 }; paint(); } }, c.l, sort.k === c.k ? (sort.dir > 0 ? ' ↑' : ' ↓') : '');
      body.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, cols.map(th))),
        h('tbody', null, list.map((o) => h('tr', { onclick: () => open(o) }, cols.map((c) => h('td', { class: c.k === 'title' ? 'tt' : '' }, c.k === 'title' ? o.title : c.k === 'updated' ? timeAgo(o.updated) : c.kind === 'date' && o.props?.[c.k] ? relDate(o.props[c.k]) : o.props?.[c.k] || ''))))))));
    } else if (mode === 'board') {
      const opts = [...selectProp.options, ''];
      body.append(h('div', { class: 'board' }, opts.map((opt) => {
        const col = list.filter((o) => (o.props?.[selectProp.key] || '') === opt);
        const el = h('div', { class: 'col', 'data-opt': opt }, h('div', { class: 'col-head' }, h('span', null, opt || 'No ' + selectProp.label.toLowerCase()), h('b', null, col.length)), col.map((o) => { const c = card(o); c.draggable = true; c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', o.id); }); return c; }));
        el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); }); el.addEventListener('dragleave', () => el.classList.remove('over'));
        el.addEventListener('drop', (e) => { e.preventDefault(); const o = getObject(e.dataTransfer.getData('text/plain')); if (o) { o.props[selectProp.key] = opt; touch(o); paint(); } });
        return el;
      })));
    }
  };
  const search = h('input', { class: 'input search', placeholder: `Search ${t.plural.toLowerCase()}…`, oninput: (e) => { q = e.target.value.toLowerCase(); paint(); } });
  const allTags = objectsOfType('tag').map((x) => x.title);
  const tagSel = allTags.length ? h('select', { class: 'input', onchange: (e) => { tag = e.target.value.toLowerCase(); paint(); } }, h('option', { value: '' }, 'All tags'), allTags.map((x) => h('option', { value: x }, '#' + x))) : null;
  const seg = h('div', { class: 'seg icons' }, modes.map(([k, l, ic]) => h('button', { class: k === mode ? 'on' : '', title: l, html: icon(ic, 15), onclick: (e) => { mode = k; S.settings.views[tid] = k; touch(); seg.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); paint(); } })));
  page.append(h('div', { class: 'view-head' }, h('h1', { class: 'with-ic', style: { '--c': t.color } }, typeBadge(t), t.plural),
    tid === 'daily' ? null : h('button', { class: 'btn primary small', html: `${icon('plus', 14)}<span>${tid === 'pdf' ? 'Import PDF' : 'New ' + esc(t.name.toLowerCase())}</span>`, onclick: () => newObject(tid) })),
    h('div', { class: 'type-tools' }, search, tagSel, h('span', { class: 'top-spacer' }), seg), body);
  paint(); root.append(page);
}
export function newObject(tid = 'page') {
  if (tid === 'pdf') return pickPDF().then((o) => o && go('#/o/' + o.id));
  const o = createObject({ type: tid, title: 'Untitled', blocks: tid === 'meeting' ? import_meetingBlocks() : undefined, props: tid === 'meeting' ? { date: todayKey() } : {} });
  o._fresh = true; go('#/o/' + o.id);
}
import { meetingBlocks as import_meetingBlocks } from './store.js';

// ======================================================================
// Graph
// ======================================================================
export function renderGraph() {
  const root = main(); root.textContent = ''; setActions([]);
  const page = h('div', { class: 'page graph-page' });
  const canvas = h('canvas', { class: 'graph' });
  page.append(h('div', { class: 'view-head' }, h('h1', null, 'Graph'), h('span', { class: 'muted small' }, 'Drag to move · scroll to zoom · click to open')), canvas);
  root.append(page);
  const objs = allObjects().filter((o) => o.type !== 'daily' || o.blocks.some((b) => b.text));
  const byTitle = new Map(objs.map((o) => [o.title.toLowerCase(), o]));
  const edges = []; const deg = new Map();
  objs.forEach((o) => outgoing(o).forEach((l) => { const t = byTitle.get(l); if (t && t !== o) { edges.push([o, t]); deg.set(o.id, (deg.get(o.id) || 0) + 1); deg.set(t.id, (deg.get(t.id) || 0) + 1); } }));
  const nodes = objs.filter((o) => deg.get(o.id)).map((o, i) => ({ o, x: Math.cos(i) * 150 + Math.random(), y: Math.sin(i) * 150 + Math.random(), vx: 0, vy: 0, r: 5 + Math.min(10, Math.sqrt(deg.get(o.id)) * 2.4) }));
  const idx = new Map(nodes.map((n) => [n.o.id, n]));
  const links = edges.map(([a, b]) => [idx.get(a.id), idx.get(b.id)]).filter(([a, b]) => a && b);
  if (!nodes.length) { canvas.replaceWith(h('div', { class: 'empty small' }, h('p', null, 'Link objects with [[double brackets]] to grow your graph.'))); return; }
  const ctx = canvas.getContext('2d'); let W; let H; let scale = 1; let ox = 0; let oy = 0; let hover = null; let drag = null; let alive = true; let heat = 1;
  const dpr = window.devicePixelRatio || 1;
  const resize = () => { const r = canvas.getBoundingClientRect(); W = r.width; H = r.height; canvas.width = W * dpr; canvas.height = H * dpr; };
  resize(); ox = W / 2; oy = H / 2;
  const css = getComputedStyle(document.documentElement);
  const step = () => {
    if (!alive || !canvas.isConnected) return;
    if (heat > 0.02) {
      for (const a of nodes) for (const b of nodes) { if (a === b) continue; let dx = a.x - b.x; let dy = a.y - b.y; let d2 = dx * dx + dy * dy + 0.1; if (d2 > 90000) continue; const f = 2600 / d2; const d = Math.sqrt(d2); a.vx += (dx / d) * f; a.vy += (dy / d) * f; }
      for (const [a, b] of links) { const dx = b.x - a.x; const dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const f = (d - 90) * 0.012; a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f; }
      for (const n of nodes) { n.vx -= n.x * 0.003; n.vy -= n.y * 0.003; if (n !== drag) { n.x += n.vx * heat; n.y += n.vy * heat; } n.vx *= 0.82; n.vy *= 0.82; }
      heat *= 0.992;
    }
    draw(); requestAnimationFrame(step);
  };
  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.translate(ox, oy); ctx.scale(scale, scale);
    const line = css.getPropertyValue('--line-strong').trim() || '#ccc'; const text = css.getPropertyValue('--text').trim() || '#222';
    const hl = new Set(); if (hover) links.forEach(([a, b]) => { if (a === hover) hl.add(b); if (b === hover) hl.add(a); });
    ctx.lineWidth = 1 / scale;
    for (const [a, b] of links) { ctx.strokeStyle = hover && (a === hover || b === hover) ? typeOf(hover.o).color : line; ctx.globalAlpha = hover && a !== hover && b !== hover ? 0.25 : 0.9; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    for (const n of nodes) {
      ctx.globalAlpha = hover && n !== hover && !hl.has(n) ? 0.3 : 1;
      ctx.fillStyle = typeOf(n.o).color; ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fill();
      if (scale > 0.65 || n === hover || n.r > 9) { ctx.fillStyle = text; ctx.font = `${n === hover ? 600 : 500} ${12 / Math.max(scale, 0.8)}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(n.o.title.length > 28 ? n.o.title.slice(0, 27) + '…' : n.o.title, n.x, n.y + n.r + 14 / Math.max(scale, 0.8)); }
    }
    ctx.globalAlpha = 1;
  };
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale }; };
  const pick = (e) => { const p = pt(e); return nodes.find((n) => (n.x - p.x) ** 2 + (n.y - p.y) ** 2 <= (n.r + 4) ** 2) || null; };
  let moved = false; let pan = null;
  canvas.addEventListener('mousedown', (e) => { moved = false; const n = pick(e); if (n) { drag = n; heat = Math.max(heat, 0.4); } else pan = { x: e.clientX - ox, y: e.clientY - oy }; });
  window.addEventListener('mouseup', () => { drag = null; pan = null; });
  canvas.addEventListener('mousemove', (e) => { moved = true; if (drag) { const p = pt(e); drag.x = p.x; drag.y = p.y; heat = Math.max(heat, 0.3); } else if (pan) { ox = e.clientX - pan.x; oy = e.clientY - pan.y; } else { hover = pick(e); canvas.style.cursor = hover ? 'pointer' : 'grab'; } });
  canvas.addEventListener('click', (e) => { const n = pick(e); if (n && !moved) go('#/o/' + n.o.id); });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const k = Math.exp(-e.deltaY * 0.0012); const r = canvas.getBoundingClientRect(); const mx = e.clientX - r.left; const my = e.clientY - r.top; ox = mx - (mx - ox) * k; oy = my - (my - oy) * k; scale *= k; }, { passive: false });
  window.addEventListener('hashchange', () => { alive = false; }, { once: true });
  requestAnimationFrame(step);
}

// ======================================================================
// Settings
// ======================================================================
export function renderSettings() {
  const root = main(); root.textContent = ''; setActions([]);
  const page = h('div', { class: 'page' });
  page.append(h('div', { class: 'view-head' }, h('h1', null, 'Settings')));
  const sec = (title, sub, ...kids) => h('section', { class: 'set-sec' }, h('h2', null, title), sub ? h('p', { class: 'set-sub' }, sub) : null, h('div', { class: 'set-body' }, kids));
  const row = (label, ...c) => h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, label), h('div', { class: 'set-ctl' }, c));
  const save = () => { touch(); };

  // Appearance
  const themeSel = h('div', { class: 'seg' }, ['auto', 'light', 'dark'].map((t) => h('button', { class: S.settings.theme === t ? 'on' : '', onclick: () => { S.settings.theme = t; save(); window.dispatchEvent(new Event('folio:theme')); renderSettings(); } }, t[0].toUpperCase() + t.slice(1))));
  page.append(sec('Appearance', null, row('Theme', themeSel)));

  // Calendar
  const calList = h('div', { class: 'cal-list' });
  const paintCals = () => {
    calList.textContent = '';
    Object.entries(S.cache.cal || {}).forEach(([k, c]) => calList.append(h('div', { class: 'cal-item' }, h('span', { class: 'cal-dot', style: { background: c.color || 'var(--accent)' } }), h('div', { class: 'cal-name' }, c.name || k, h('small', null, `${c.events.length} events · synced ${timeAgo(c.at)}`)), h('button', { class: 'icon-btn small', html: icon('x', 14), title: 'Remove', onclick: () => { I.removeCalendar(k); S.settings.icsUrls = S.settings.icsUrls.filter((u) => 'url:' + u.url !== k); paintCals(); } }))));
    if (!calList.children.length) calList.append(h('div', { class: 'muted small' }, 'No calendars connected.'));
  };
  paintCals();
  const nameIn = h('input', { class: 'input', placeholder: 'Name (e.g. Work)' });
  const urlIn = h('input', { class: 'input grow', placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics' });
  const palette = ['#6558f5', '#ec4899', '#0ea5e9', '#10b981', '#f59e0b'];
  const calMsg = h('div', { class: 'set-msg' });
  const addCal = async () => {
    const url = urlIn.value.trim(); if (!url) return;
    S.settings.icsUrls.push({ url, name: nameIn.value.trim() || 'Calendar', color: palette[S.settings.icsUrls.length % palette.length] });
    urlIn.value = ''; nameIn.value = ''; save(); calMsg.textContent = 'Syncing…';
    const r = await I.syncCalendars(); calMsg.textContent = r.errors.length ? r.errors.join(' · ') : `Imported ${r.n} events.`; calMsg.className = 'set-msg' + (r.errors.length ? ' err' : ' ok'); paintCals();
  };
  const fileIn = h('input', { type: 'file', accept: '.ics,text/calendar', style: { display: 'none' }, onchange: async (e) => { const f = e.target.files[0]; if (!f) return; const n = I.importICSText(f.name, await f.text()); calMsg.textContent = `Imported ${n} events from ${f.name}.`; calMsg.className = 'set-msg ok'; paintCals(); } });
  page.append(sec('Calendar', 'Paste the secret iCal address from Google Calendar (Settings → your calendar → “Secret address in iCal format”), or any .ics feed. Recurring events are expanded automatically.',
    calList, h('div', { class: 'set-form' }, nameIn, urlIn, h('button', { class: 'btn primary', onclick: addCal }, 'Add')),
    h('div', { class: 'set-actions' }, h('button', { class: 'btn', onclick: async () => { calMsg.textContent = 'Syncing…'; const r = await I.syncCalendars(); calMsg.textContent = r.errors.length ? r.errors.join(' · ') : `Synced ${r.n} events.`; calMsg.className = 'set-msg' + (r.errors.length ? ' err' : ' ok'); paintCals(); }, html: `${icon('refresh', 14)}<span>Sync now</span>` }), h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Import .ics file…'), fileIn), calMsg));

  // Todoist
  const tdIn = h('input', { class: 'input grow', type: 'password', placeholder: 'Todoist API token', value: S.settings.todoistToken });
  const tdMsg = h('div', { class: 'set-msg' });
  page.append(sec('Todoist', 'Find your token in Todoist → Settings → Integrations → Developer. Tasks sync both ways: complete here or there.',
    h('div', { class: 'set-form' }, tdIn, h('button', { class: 'btn primary', onclick: async () => { S.settings.todoistToken = tdIn.value.trim(); save(); tdMsg.textContent = 'Connecting…'; tdMsg.className = 'set-msg'; try { const r = await I.syncTodoist(); tdMsg.textContent = `Connected · ${r.n} open tasks.`; tdMsg.className = 'set-msg ok'; } catch (e) { tdMsg.textContent = e.message; tdMsg.className = 'set-msg err'; } } }, 'Connect & sync')), tdMsg));

  // Readwise
  const rwIn = h('input', { class: 'input grow', type: 'password', placeholder: 'Readwise access token', value: S.settings.readwiseToken });
  const rwMsg = h('div', { class: 'set-msg' });
  page.append(sec('Readwise', 'Get your token at readwise.io/access_token. Books, articles and highlights import as Source objects; highlights are quote bullets you can link and annotate.',
    h('div', { class: 'set-form' }, rwIn, h('button', { class: 'btn primary', onclick: async (e) => { S.settings.readwiseToken = rwIn.value.trim(); save(); const b = e.currentTarget; b.disabled = true; rwMsg.className = 'set-msg'; try { const r = await I.syncReadwise((bk, hl) => { rwMsg.textContent = `Imported ${bk} sources…`; }); rwMsg.textContent = `Done · ${r.books} sources updated, ${r.highlights} new highlights.`; rwMsg.className = 'set-msg ok'; } catch (err) { rwMsg.textContent = err.message; rwMsg.className = 'set-msg err'; } b.disabled = false; } }, 'Connect & import')),
    h('div', { class: 'set-actions' }, h('button', { class: 'btn small ghost', onclick: () => { S.cache.readwiseSyncedAt = null; save(); rwMsg.textContent = 'Next import will fetch everything again.'; } }, 'Reset sync cursor')), rwMsg));

  // Proxy
  page.append(sec('Network', runtime.proxy ? 'Local proxy detected. Readwise and calendar feeds are routed through it, which avoids browser CORS limits.' : 'Todoist works directly from the browser. Readwise and most calendar feeds need the small local proxy: run “node server.js” and open Folio from it.',
    row('Proxy', h('span', { class: `status ${runtime.proxy ? 'on' : ''}` }, runtime.proxy ? 'Connected' : 'Not running'))));

  // Types
  const typeList = h('div', { class: 'type-list' });
  const paintTypes = () => {
    typeList.textContent = '';
    Object.values(S.types).filter((t) => t.id !== 'daily').forEach((t) => typeList.append(h('div', { class: 'type-item' }, typeBadge(t), h('span', null, t.name), h('small', null, `${objectsOfType(t.id).length}`), t.builtin ? null : h('button', { class: 'icon-btn small', html: icon('trash', 13), onclick: async () => { if (objectsOfType(t.id).length) return toast('Move or delete its objects first'); delete S.types[t.id]; save(); paintTypes(); rerender(); } }))));
  };
  paintTypes();
  const tName = h('input', { class: 'input', placeholder: 'New type, e.g. Recipe' });
  let tIcon = 'file'; let tColor = '#ef4444';
  const icons = h('div', { class: 'icon-pick' }, ICON_NAMES.map((n) => h('button', { class: n === tIcon ? 'on' : '', html: icon(n, 15), onclick: (e) => { tIcon = n; icons.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); } })));
  const colors = h('div', { class: 'color-pick' }, ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899'].map((c) => h('button', { style: { background: c }, class: c === tColor ? 'on' : '', onclick: (e) => { tColor = c; colors.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); } })));
  page.append(sec('Object types', 'Every note is an object with a type. Add your own.', typeList,
    h('div', { class: 'set-form col' }, tName, icons, colors, h('button', { class: 'btn primary', onclick: () => { const n = tName.value.trim(); if (!n) return; const id = n.toLowerCase().replace(/[^a-z0-9]+/g, '-'); if (S.types[id]) return toast('That type exists'); S.types[id] = { id, name: n, plural: n + 's', icon: tIcon, color: tColor, props: [] }; tName.value = ''; save(); paintTypes(); rerender(); } }, 'Add type'))));

  // Data
  const imp = h('input', { type: 'file', accept: '.json', style: { display: 'none' }, onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { const d = JSON.parse(await f.text()); if (!d.objects) throw new Error('Not a Folio export'); if (!(await confirmBox('Replace all current data with this file?', 'Replace'))) return; Object.assign(S, d); touch(null, true); location.hash = '#/daily'; location.reload(); } catch (err) { toast(err.message, { kind: 'warn' }); } } });
  page.append(sec('Your data', 'Everything lives in this browser (IndexedDB). The Markdown export holds all notes, tasks, calendar events and types as plain files with front matter. Tokens are never exported.',
    h('div', { class: 'set-actions' },
      h('button', { class: 'btn primary', html: `${icon('download', 14)}<span>Download all as Markdown (.zip)</span>`, onclick: async () => { const n = await downloadZip(); toast(`Exported ${n} files`); } }),
      h('button', { class: 'btn', onclick: () => { downloadSingle(); }, html: `${icon('download', 14)}<span>Single .md file</span>` }),
      h('button', { class: 'btn', html: `${icon('download', 14)}<span>Backup JSON</span>`, onclick: () => { saveNow(); download(`folio-${todayKey()}.json`, JSON.stringify({ ...S, settings: { ...S.settings, todoistToken: '', readwiseToken: '' } }, null, 1)); } }),
      h('button', { class: 'btn', onclick: () => imp.click() }, 'Import JSON…'), imp)));
  root.append(page);
}

// ======================================================================
// Version history, presentation, side panel
// ======================================================================
export function historyModal(obj) {
  snapshot(obj);
  const hist = obj.history || [];
  const prev = h('pre', { class: 'hist-prev' }, 'Select a version to preview.');
  const list = h('div', { class: 'hist-list' });
  let sel = -1;
  const paint = () => {
    list.textContent = '';
    [...hist].map((v, i) => ({ v, i })).reverse().forEach(({ v, i }) => list.append(h('button', { class: `hist-item${i === sel ? ' on' : ''}`, onclick: () => { sel = i; prev.textContent = `# ${v.title}\n\n${blocksMd(v.blocks)}`; restore.disabled = false; paint(); } }, h('b', null, new Date(v.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })), h('span', null, `${countBlocks(v.blocks)} blocks`))));
    if (!hist.length) list.append(h('div', { class: 'muted small', style: { padding: '12px' } }, 'No earlier versions yet. Versions are saved as you edit.'));
  };
  const restore = h('button', { class: 'btn primary', disabled: true, onclick: () => { restoreSnapshot(obj, sel); m.close(); rerender(); toast('Version restored. The previous state was saved too.'); } }, 'Restore this version');
  const m = modal(h('div', { class: 'hist' }, h('div', { class: 'hist-cols' }, list, prev), h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Close'), restore)), { title: `Version history · ${obj.title}`, wide: true });
  paint();
}
const countBlocks = (bs) => { let n = 0; walk(bs, () => n++); return n; };
import { blocksToMarkdown as blocksMd } from './export.js';

export function present(obj) {
  const slides = obj.blocks.filter((b) => b.text.trim() || b.children.length);
  if (!slides.length) return toast('Nothing to present yet');
  let i = 0;
  const stage = h('div', { class: 'slide' });
  const ov = h('div', { class: 'present' }, h('button', { class: 'icon-btn present-x', html: icon('x', 20), onclick: close }), stage, h('div', { class: 'present-count' }));
  const kids = (bs) => h('ul', null, bs.map((b) => h('li', { class: b.task ? 'tk' : '' }, h('span', { html: renderInline(b.text) }), b.children.length ? kids(b.children) : null)));
  const paint = () => {
    const b = slides[i]; stage.textContent = '';
    const head = /^h\d$/.test(b.type) || b.children.length;
    stage.append(h('div', { class: head ? 'slide-title' : 'slide-body', html: renderInline(b.text) }), b.children.length ? kids(b.children) : null);
    ov.querySelector('.present-count').textContent = `${i + 1} / ${slides.length}`;
  };
  const key = (e) => { if (e.key === 'Escape') close(); else if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); i = Math.min(slides.length - 1, i + 1); paint(); } else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); i = Math.max(0, i - 1); paint(); } };
  function close() { ov.remove(); document.removeEventListener('keydown', key, true); }
  ov.addEventListener('click', (e) => { if (e.target.closest('.present-x')) return; i = Math.min(slides.length - 1, i + 1); paint(); });
  document.addEventListener('keydown', key, true);
  document.body.append(ov); paint();
}

export function panelContent(obj) {
  const wrap = h('div', { class: 'panel-in' });
  if (!obj) return wrap;
  const t = typeOf(obj);
  // outline of headings
  const heads = []; walk(obj.blocks, (b, _p, d) => { if (/^h[123]$/.test(b.type) && b.text.trim()) heads.push({ b, d: +b.type[1] }); });
  wrap.append(h('div', { class: 'pn-sec' }, h('div', { class: 'pn-label' }, 'Outline'),
    heads.length ? heads.map(({ b, d }) => h('a', { class: 'pn-head', style: { paddingLeft: 8 + (d - 1) * 12 + 'px' }, onclick: () => document.querySelector(`[data-id="${b.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, b.text.replace(/\[\[|\]\]|\*\*/g, ''))) : h('div', { class: 'pn-empty' }, 'Add headings with / or #  to build an outline.')));
  const links = backlinks(obj);
  wrap.append(h('div', { class: 'pn-sec' }, h('div', { class: 'pn-label' }, 'Backlinks', h('b', null, links.reduce((s, g) => s + g.blocks.length, 0) || '')),
    links.length ? links.map((g) => h('a', { class: 'pn-link', style: { '--c': typeOf(g.obj).color }, onclick: () => go('#/o/' + g.obj.id), html: `${icon(typeOf(g.obj).icon, 13)}<span>${esc(g.obj.title)}</span><em>${g.blocks.length}</em>` })) : h('div', { class: 'pn-empty' }, 'Nothing links here yet.')));
  const out = [...outgoing(obj)].map((k) => findByTitle(k)).filter((o) => o && o.id !== obj.id);
  if (out.length) wrap.append(h('div', { class: 'pn-sec' }, h('div', { class: 'pn-label' }, 'Links to'), [...new Set(out)].slice(0, 12).map((o) => h('a', { class: 'pn-link', style: { '--c': typeOf(o).color }, onclick: () => go(o.type === 'daily' ? '#/daily/' + o.date : '#/o/' + o.id), html: `${icon(typeOf(o).icon, 13)}<span>${esc(o.title)}</span>` }))));
  let words = 0; let tasks = 0; let done = 0; walk(obj.blocks, (b) => { words += b.text.split(/\s+/).filter(Boolean).length; if (b.task) { tasks++; if (b.task.status === 'done') done++; } });
  wrap.append(h('div', { class: 'pn-sec' }, h('div', { class: 'pn-label' }, 'Info'),
    h('div', { class: 'pn-info' }, h('span', null, 'Type'), h('b', null, t.name)), h('div', { class: 'pn-info' }, h('span', null, 'Words'), h('b', null, words)),
    tasks ? h('div', { class: 'pn-info' }, h('span', null, 'Tasks'), h('b', null, `${done}/${tasks}`)) : null,
    h('div', { class: 'pn-info' }, h('span', null, 'Updated'), h('b', null, timeAgo(obj.updated))),
    h('div', { class: 'pn-actions' }, h('button', { class: 'btn small', onclick: () => present(obj), html: `${icon('play', 12)}<span>Present</span>` }), h('button', { class: 'btn small', onclick: () => historyModal(obj), html: `${icon('history', 12)}<span>History</span>` }))));
  return wrap;
}

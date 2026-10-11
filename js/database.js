// Database views for object types: table, gallery, list and board, with inline editing,
// filters, sorting, grouping, column control and saved views (Notion / Obsidian Bases style).
import { h, esc, relDate, timeAgo, dateKey, todayKey, uid } from './util.js';
import { icon } from './icons.js';
import { S, typeOf, typeProps, objectsOfType, refObjects, createObject, deleteObject, renameObject, touch, walk, newBlock, meetingBlocks, PROP_KINDS, getObject } from './store.js';
import { showMenu, closeMenu, toast, confirmBox, promptBox, popover } from './ui.js';
import * as V from './views.js';

const KIND_ICON = { title: 'type', text: 'type', richtext: 'list', number: 'hash', date: 'calendar', select: 'list', boolean: 'check', url: 'link', entity: 'file', created: 'clock', updated: 'clock' };
const OPS = {
  text: [['contains', 'contains'], ['is', 'is'], ['empty', 'is empty'], ['notempty', 'is not empty']],
  number: [['eq', '='], ['gt', '>'], ['lt', '<'], ['empty', 'is empty'], ['notempty', 'is not empty']],
  date: [['on', 'is'], ['before', 'is before'], ['after', 'is after'], ['today', 'is today'], ['empty', 'is empty'], ['notempty', 'is not empty']],
  select: [['is', 'is'], ['isnot', 'is not'], ['empty', 'is empty'], ['notempty', 'is not empty']],
  boolean: [['checked', 'is checked'], ['unchecked', 'is unchecked']],
  entity: [['has', 'contains'], ['empty', 'is empty'], ['notempty', 'is not empty']],
};
const opsFor = (kind) => OPS[kind === 'title' || kind === 'richtext' || kind === 'url' ? 'text' : kind === 'created' || kind === 'updated' ? 'date' : kind] || OPS.text;
const NOVALUE = new Set(['empty', 'notempty', 'checked', 'unchecked', 'today']);

// ---------- view state ----------
const newView = (name, mode = 'table', extra = {}) => ({ id: uid(), name, mode, filters: [], sort: { k: 'updated', dir: -1 }, group: '', hidden: ['created'], order: [], ...extra });
function dbState(tid) {
  S.settings.db ||= {};
  if (!S.settings.db[tid]) {
    const legacy = S.settings.views?.[tid];
    const first = newView('All', tid === 'pdf' ? 'gallery' : legacy === 'grid' ? 'gallery' : (legacy || 'table'));
    if (tid === 'daily') { first.sort = { k: 'title', dir: -1 }; first.hidden = ['created', 'updated']; }
    const views = [first];
    if (tid === 'daily') views.push(newView('To review', 'table', { sort: { k: 'title', dir: -1 }, hidden: ['created', 'updated'], filters: [{ key: 'reviewed', op: 'unchecked' }] }));
    S.settings.db[tid] = { active: first.id, views };
  }
  const d = S.settings.db[tid];
  if (!d.views.some((v) => v.id === d.active)) d.active = d.views[0].id;
  return d;
}

function columns(tid) {
  const props = typeProps({ type: tid });
  return [{ key: 'title', label: 'Title', kind: 'title' }, ...props, { key: 'created', label: 'Created', kind: 'created' }, { key: 'updated', label: 'Updated', kind: 'updated' }];
}
function visibleCols(tid, view) {
  const all = columns(tid); const rank = (c) => { const i = view.order.indexOf(c.key); return i < 0 ? 1000 + all.indexOf(c) : i; };
  const rest = all.filter((c) => c.key !== 'title' && !view.hidden.includes(c.key)).sort((a, b) => rank(a) - rank(b));
  return [all[0], ...rest];
}

// ---------- values, filters, sorting ----------
function val(o, c) {
  if (c.key === 'title') return o.title;
  if (c.kind === 'created') return o.created; if (c.kind === 'updated') return o.updated;
  if (c.kind === 'entity') return refObjects(o, c.key).map((x) => x.title).join(', ');
  return o.props?.[c.key] ?? '';
}
function matches(o, f, cols) {
  const c = cols.find((x) => x.key === f.key); if (!c) return true;
  let v = val(o, c); const q = String(f.value ?? '').toLowerCase();
  const empty = v === '' || v == null || v === false && c.kind !== 'boolean';
  switch (f.op) {
    case 'contains': return String(v).toLowerCase().includes(q);
    case 'has': return String(v).toLowerCase().includes(q);
    case 'is': return c.kind === 'date' ? String(v).split('->')[0].trim() === f.value : String(v).toLowerCase() === q;
    case 'isnot': return String(v).toLowerCase() !== q;
    case 'empty': return c.kind === 'boolean' ? !v : empty;
    case 'notempty': return !empty;
    case 'checked': return v === true; case 'unchecked': return v !== true;
    case 'eq': return Number(v) === Number(f.value); case 'gt': return Number(v) > Number(f.value); case 'lt': return Number(v) < Number(f.value) && v !== '';
    case 'on': { const d = c.kind === 'created' || c.kind === 'updated' ? dateKey(new Date(v)) : String(v).split('->')[0].trim(); return d === f.value; }
    case 'before': { const d = c.kind === 'created' || c.kind === 'updated' ? dateKey(new Date(v)) : String(v).split('->')[0].trim(); return !!d && !!f.value && d < f.value; }
    case 'after': { const d = c.kind === 'created' || c.kind === 'updated' ? dateKey(new Date(v)) : String(v).split('->')[0].trim(); return !!d && !!f.value && d > f.value; }
    case 'today': return String(v).split('->')[0].trim() === todayKey();
    default: return true;
  }
}
function sortRows(rows, view, cols) {
  const c = cols.find((x) => x.key === view.sort?.k) || cols[0];
  const key = (o) => { const v = val(o, c); return c.kind === 'number' ? (v === '' ? -Infinity : Number(v)) : typeof v === 'number' ? v : typeof v === 'boolean' ? +v : String(v).toLowerCase(); };
  return rows.sort((a, b) => { const x = key(a); const y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (view.sort?.dir || 1); });
}
function groupKey(o, c) {
  if (c.kind === 'boolean') return o.props?.[c.key] === true ? 'Checked' : 'Unchecked';
  if (c.kind === 'entity') return refObjects(o, c.key)[0]?.title || '';
  return String(val(o, c) || '');
}

// ---------- main ----------
export function renderType(tid) {
  const t = S.types[tid]; const root = V.mainEl(); root.textContent = '';
  if (!t) return V.go('#/daily');
  V.setActionsFn([]);
  const db = dbState(tid);
  const view = () => db.views.find((v) => v.id === db.active);
  const cols = () => columns(tid);
  const save = () => touch();
  let q = ''; const collapsed = new Set(); let focusId = null;
  const page = h('div', { class: 'page wide db-page' });
  const tabs = h('div', { class: 'db-tabs' }); const tools = h('div', { class: 'db-tools' }); const body = h('div', { class: 'db-body' });

  const rows = () => {
    const v = view(); const cs = cols();
    let r = objectsOfType(tid).filter((o) => !q || o.title.toLowerCase().includes(q) || cs.some((c) => c.kind !== 'title' && String(val(o, c)).toLowerCase().includes(q)));
    for (const f of v.filters) if (NOVALUE.has(f.op) || (f.value ?? '') !== '') r = r.filter((o) => matches(o, f, cs));
    return sortRows(r, v, cs);
  };

  const newRow = (prefill = {}) => {
    // New rows inherit equality filters so they do not vanish from the view.
    const props = {}; view().filters.filter((f) => f.op === 'is' && f.value && f.key !== 'title').forEach((f) => { props[f.key] = f.value; });
    Object.assign(props, prefill);
    const o = createObject({ type: tid, title: 'Untitled', props, blocks: tid === 'meeting' ? meetingBlocks() : undefined });
    focusId = o.id; paintAll();
  };

  // ----- tabs -----
  const paintTabs = () => {
    tabs.textContent = '';
    db.views.forEach((v) => {
      const on = v.id === db.active;
      tabs.append(h('button', { class: `db-tab${on ? ' on' : ''}`, onclick: (e) => { if (on) return viewMenu(e.currentTarget, v); db.active = v.id; save(); paintAll(); }, ondblclick: () => rename(v), html: `${icon({ table: 'table', gallery: 'grid', list: 'list', board: 'board' }[v.mode], 14)}<span>${esc(v.name)}</span>${on ? icon('chevD', 11) : ''}` }));
    });
    tabs.append(h('button', { class: 'db-tab add', title: 'Add a view', html: icon('plus', 14), onclick: (e) => showMenu({ anchor: e.currentTarget, keepFocus: false, items: [['table', 'Table', 'table'], ['gallery', 'Gallery', 'grid'], ['list', 'List', 'list'], ['board', 'Board', 'board']].map(([m, l, ic]) => ({ label: l, icon: ic, value: m })), onPick: (it) => { const v = newView(it.label, it.value, { hidden: view().hidden.slice(), order: view().order.slice() }); db.views.push(v); db.active = v.id; save(); paintAll(); } }) }));
  };
  const rename = async (v) => { const n = await promptBox('Rename view', v.name); if (n && n.trim()) { v.name = n.trim(); save(); paintTabs(); } };
  const viewMenu = (anchor, v) => showMenu({ anchor, keepFocus: false, items: [
    { label: 'Rename', icon: 'edit', value: 'rename' }, { label: 'Duplicate', icon: 'copy', value: 'dup' }, ...(db.views.length > 1 ? [{ sep: true }, { label: 'Delete view', icon: 'trash', value: 'del', danger: true }] : [])],
  onPick: async (it) => {
    if (it.value === 'rename') rename(v);
    else if (it.value === 'dup') { const c = structuredClone(v); c.id = uid(); c.name = v.name + ' copy'; db.views.splice(db.views.indexOf(v) + 1, 0, c); db.active = c.id; save(); paintAll(); }
    else if (it.value === 'del' && await confirmBox(`Delete the “${v.name}” view? Your objects are not affected.`)) { db.views.splice(db.views.indexOf(v), 1); db.active = db.views[0].id; save(); paintAll(); }
  } });

  // ----- toolbar -----
  const paintTools = () => {
    const v = view(); tools.textContent = '';
    const cs = cols();
    const sortCol = cs.find((c) => c.key === v.sort?.k);
    const groupable = cs.filter((c) => ['select', 'boolean', 'entity', 'text'].includes(c.kind));
    const btn = (label, ic, count, on, fn) => h('button', { class: `db-btn${on ? ' on' : ''}`, html: `${icon(ic, 14)}<span>${label}</span>${count ? `<b>${count}</b>` : ''}`, onclick: (e) => fn(e.currentTarget) });
    tools.append(
      h('input', { class: 'input search', placeholder: `Search ${t.plural.toLowerCase()}…`, value: q, oninput: (e) => { q = e.target.value.toLowerCase(); paintBody(); } }),
      btn('Filter', 'search', v.filters.filter((f) => NOVALUE.has(f.op) || (f.value ?? '') !== '').length, v.filters.some((f) => NOVALUE.has(f.op) || (f.value ?? '') !== ''), (a) => filterPanel(a)),
      btn(sortCol ? `${sortCol.label} ${v.sort.dir > 0 ? '↑' : '↓'}` : 'Sort', 'list', 0, false, (a) => showMenu({ anchor: a, keepFocus: false, items: cs.map((c) => ({ label: c.label, icon: KIND_ICON[c.kind], value: c.key, check: c.key === v.sort?.k })), onPick: (it) => { v.sort = { k: it.value, dir: v.sort?.k === it.value ? -(v.sort.dir) : 1 }; save(); paintTools(); paintBody(); } })),
      v.mode !== 'gallery' ? btn(v.group ? `Group: ${cs.find((c) => c.key === v.group)?.label || ''}` : 'Group', 'board', 0, !!v.group, (a) => showMenu({ anchor: a, keepFocus: false, items: [{ label: 'None', value: '', check: !v.group }, { sep: true }, ...groupable.map((c) => ({ label: c.label, icon: KIND_ICON[c.kind], value: c.key, check: c.key === v.group }))], onPick: (it) => { v.group = it.value; save(); paintTools(); paintBody(); } })) : null,
      v.mode === 'table' || v.mode === 'list' ? btn('Properties', 'sliders', 0, false, (a) => propsPanel(a)) : null,
      h('span', { class: 'top-spacer' }),
      h('div', { class: 'seg icons' }, [['table', 'Table', 'table'], ['gallery', 'Gallery', 'grid'], ['list', 'List', 'list'], ['board', 'Board', 'board']].map(([m, l, ic]) => h('button', { class: m === v.mode ? 'on' : '', title: l, html: icon(ic, 15), onclick: () => { v.mode = m; if (m === 'board' && !v.group) v.group = (cs.find((c) => c.kind === 'select') || {}).key || ''; save(); paintAll(); } }))));
  };

  const filterPanel = (anchor) => {
    const v = view(); const cs = cols(); const wrap = h('div', { class: 'fp' });
    const paint = () => {
      wrap.textContent = '';
      wrap.append(h('div', { class: 'menu-head' }, 'Filters'));
      if (!v.filters.length) wrap.append(h('div', { class: 'muted small', style: { padding: '2px 4px 8px' } }, 'No filters. Rows are shown when they match every filter.'));
      v.filters.forEach((f, i) => {
        const c = cs.find((x) => x.key === f.key) || cs[0]; const ops = opsFor(c.kind);
        const keySel = h('select', { class: 'input', onchange: (e) => { f.key = e.target.value; const nc = cs.find((x) => x.key === f.key); f.op = opsFor(nc.kind)[0][0]; f.value = ''; save(); paint(); paintTools(); paintBody(); } }, cs.map((x) => h('option', { value: x.key, selected: x.key === f.key }, x.label)));
        const opSel = h('select', { class: 'input', onchange: (e) => { f.op = e.target.value; save(); paint(); paintTools(); paintBody(); } }, ops.map(([k, l]) => h('option', { value: k, selected: k === f.op }, l)));
        let valEl = null;
        if (!NOVALUE.has(f.op)) {
          if (c.kind === 'select') valEl = h('select', { class: 'input', onchange: (e) => { f.value = e.target.value; save(); paintBody(); } }, h('option', { value: '' }, '—'), (c.options || []).map((o) => h('option', { value: o, selected: o === f.value }, o)));
          else valEl = h('input', { class: 'input', type: ['date', 'created', 'updated'].includes(c.kind) ? 'date' : c.kind === 'number' ? 'number' : 'text', value: f.value ?? '', placeholder: 'Value', oninput: (e) => { f.value = e.target.value; save(); paintBody(); } });
        }
        wrap.append(h('div', { class: 'fp-row' }, keySel, opSel, valEl, h('button', { class: 'icon-btn small', html: icon('x', 14), onclick: () => { v.filters.splice(i, 1); save(); paint(); paintTools(); paintBody(); } })));
      });
      wrap.append(h('div', { class: 'pop-actions', style: { justifyContent: 'space-between' } }, h('button', { class: 'btn small', html: `${icon('plus', 13)}<span>Add filter</span>`, onclick: () => { const c = cs[0]; v.filters.push({ key: c.key, op: opsFor(c.kind)[0][0], value: '' }); save(); paint(); paintTools(); paintBody(); } }), v.filters.length ? h('button', { class: 'btn small ghost', onclick: () => { v.filters = []; save(); paint(); paintTools(); paintBody(); } }, 'Clear all') : null));
    };
    paint(); popover(anchor, wrap, { width: 520 });
  };

  const propsPanel = (anchor) => {
    const v = view(); const wrap = h('div', { class: 'fp' });
    const paint = () => {
      wrap.textContent = ''; wrap.append(h('div', { class: 'menu-head' }, 'Properties'));
      const all = columns(tid).filter((c) => c.key !== 'title');
      const ordered = [...all].sort((a, b) => { const r = (c) => { const i = v.order.indexOf(c.key); return i < 0 ? 1000 + all.indexOf(c) : i; }; return r(a) - r(b); });
      ordered.forEach((c, i) => {
        const on = !v.hidden.includes(c.key);
        const move = (d) => { const keys = ordered.map((x) => x.key); const j = i + d; if (j < 0 || j >= keys.length) return; [keys[i], keys[j]] = [keys[j], keys[i]]; v.order = keys; save(); paint(); paintBody(); };
        wrap.append(h('div', { class: 'pp-row' }, h('button', { class: `pp-eye${on ? ' on' : ''}`, html: icon(on ? 'check' : 'x', 13), onclick: () => { v.hidden = on ? [...v.hidden, c.key] : v.hidden.filter((k) => k !== c.key); save(); paint(); paintBody(); } }),
          h('span', { class: 'pp-label', html: `${icon(KIND_ICON[c.kind] || 'type', 13)}<span>${esc(c.label)}</span>` }),
          h('button', { class: 'icon-btn small', html: icon('up', 13), onclick: () => move(-1) }), h('button', { class: 'icon-btn small', html: `<span style="display:inline-block;transform:rotate(180deg)">${icon('up', 13)}</span>`, onclick: () => move(1) })));
      });
      wrap.append(h('div', { class: 'pop-actions', style: { justifyContent: 'flex-start' } }, h('button', { class: 'btn small', html: `${icon('plus', 13)}<span>New property</span>`, onclick: () => { closeMenu(); V.typeEditor(tid, { newProp: true }); } })));
    };
    paint(); popover(anchor, wrap, { width: 300 });
  };

  // ----- column header menu -----
  const columnMenu = (anchor, c) => {
    const v = view(); const prop = (S.types[tid].props || []).find((p) => p.key === c.key);
    const items = [
      { label: 'Sort ascending', icon: 'up', value: 'asc' }, { label: 'Sort descending', icon: 'chevD', value: 'desc' },
      ...(c.key !== 'title' ? [{ label: 'Hide column', icon: 'x', value: 'hide' }] : []),
      ...(v.mode === 'table' && ['select', 'boolean', 'entity', 'text'].includes(c.kind) ? [{ label: 'Group by this', icon: 'board', value: 'group' }] : []),
      ...(prop ? [{ sep: true }, { label: 'Rename…', icon: 'edit', value: 'rename' }, { label: 'Property type…', icon: 'sliders', value: 'kind' }, ...(c.kind === 'select' ? [{ label: 'Edit options…', icon: 'list', value: 'options' }] : []), ...(c.kind === 'entity' ? [{ label: 'Link settings…', icon: 'link', value: 'edit' }] : []), { label: 'Delete property', icon: 'trash', value: 'del', danger: true }] : []),
    ];
    showMenu({ anchor, keepFocus: false, items, onPick: async (it) => {
      const done = () => { touch(null, true); paintAll(); };
      switch (it.value) {
        case 'asc': v.sort = { k: c.key, dir: 1 }; save(); paintTools(); paintBody(); break;
        case 'desc': v.sort = { k: c.key, dir: -1 }; save(); paintTools(); paintBody(); break;
        case 'hide': v.hidden.push(c.key); save(); paintAll(); break;
        case 'group': v.group = c.key; save(); paintAll(); break;
        case 'rename': { const n = await promptBox('Rename property', prop.label); if (n && n.trim()) { prop.label = n.trim(); done(); } break; }
        case 'kind': showMenu({ anchor, keepFocus: false, items: PROP_KINDS.map(([k, l]) => ({ label: l, value: k, check: k === prop.kind })), onPick: (k) => { prop.kind = k.value; if (k.value === 'select') prop.options ||= []; if (k.value === 'entity') { prop.types ||= []; prop.multi ??= false; } done(); if (k.value === 'entity') V.typeEditor(tid); } }); break;
        case 'options': { const n = await promptBox('Options, comma separated', (prop.options || []).join(', ')); if (n != null) { prop.options = n.split(',').map((x) => x.trim()).filter(Boolean); done(); } break; }
        case 'edit': V.typeEditor(tid); break;
        case 'del': if (await confirmBox(`Delete the “${prop.label}” property? Values stay stored but are hidden.`)) { S.types[tid].props = S.types[tid].props.filter((p) => p.key !== prop.key); done(); } break;
      }
    } });
  };

  // ----- cells -----
  const cell = (o, c) => {
    const set = (x) => { o.props[c.key] = x; touch(o); };
    switch (c.kind) {
      case 'title': return h('div', { class: 'tt-cell' },
        tid === 'daily' ? h('a', { class: 'tt-link', onclick: () => V.go('#/daily/' + o.date) }, o.title) : h('input', { class: 'cell-input tt', value: o.title, 'data-id': o.id, onchange: (e) => { renameObject(o, e.target.value); paintBody(); } }),
        h('button', { class: 'open-btn', title: 'Open', html: icon('external', 12), onclick: () => V.go(tid === 'daily' ? '#/daily/' + o.date : '#/o/' + o.id) }));
      case 'created': case 'updated': return h('span', { class: 'cell-ro' }, timeAgo(o[c.kind]));
      case 'boolean': return h('label', { class: 'switch sm' }, h('input', { type: 'checkbox', checked: o.props[c.key] === true, onchange: (e) => { set(e.target.checked); if (view().filters.some((f) => f.key === c.key) || view().group === c.key) paintBody(); } }), h('i'));
      case 'select': { const v = o.props[c.key] || ''; return h('button', { class: `label-pill${v ? '' : ' empty'}`, style: v ? { '--c': V.hashColor(v) } : {}, html: `<span>${esc(v || '—')}</span>`, onclick: (e) => showMenu({ anchor: e.currentTarget, keepFocus: false, items: [...(c.options || []).map((x) => ({ label: x, value: x, check: x === v })), { sep: true }, { label: 'New option…', icon: 'plus', value: '__new' }, { label: 'Clear', value: '' }], onPick: async (it) => { if (it.value === '__new') { const n = await promptBox('New option'); if (!n || !n.trim()) return; const p = S.types[tid].props.find((x) => x.key === c.key); if (p) { p.options = [...(p.options || []), n.trim()]; touch(null, true); } set(n.trim()); } else set(it.value); paintBody(); } }) }); }
      case 'entity': return V.entityEditor(o, c);
      case 'date': { const [s0, e0] = String(o.props[c.key] || '').split('->').map((x) => x.trim()); return h('input', { class: 'cell-input date', type: 'date', value: s0 || '', onchange: (e) => { set(e.target.value ? (e0 ? `${e.target.value} -> ${e0}` : e.target.value) : ''); } }); }
      case 'number': return h('input', { class: 'cell-input num', type: 'number', value: o.props[c.key] ?? '', onchange: (e) => set(e.target.value === '' ? '' : Number(e.target.value)) });
      default: return h('input', { class: 'cell-input', value: o.props[c.key] ?? '', placeholder: '', onchange: (e) => set(e.target.value.trim()) });
    }
  };

  // ----- renderers -----
  const rowMenu = (anchor, o) => showMenu({ anchor, keepFocus: false, items: [{ label: 'Open', icon: 'external', value: 'open' }, { label: 'Duplicate', icon: 'copy', value: 'dup' }, { sep: true }, { label: 'Delete', icon: 'trash', value: 'del', danger: true }], onPick: async (it) => {
    if (it.value === 'open') V.go(tid === 'daily' ? '#/daily/' + o.date : '#/o/' + o.id);
    else if (it.value === 'dup') { const c = createObject({ type: tid, title: o.title + ' copy', props: structuredClone(o.props), blocks: structuredClone(o.blocks).map((b) => { walk([b], (x) => { x.id = uid(); }); return b; }) }); focusId = c.id; paintBody(); }
    else if (it.value === 'del' && await confirmBox(`Delete “${o.title}”?`)) { deleteObject(o.id); paintAll(); }
  } });

  const tableView = (list, v) => {
    const vc = visibleCols(tid, v); const cs = cols();
    const groupCol = v.group ? cs.find((c) => c.key === v.group) : null;
    const thead = h('thead', null, h('tr', null,
      vc.map((c) => h('th', { class: v.sort?.k === c.key ? 'sorted' : '', onclick: (e) => columnMenu(e.currentTarget, c), html: `${icon(KIND_ICON[c.kind] || 'type', 13)}<span>${esc(c.label)}</span>${v.sort?.k === c.key ? `<i>${v.sort.dir > 0 ? '↑' : '↓'}</i>` : ''}` })),
      h('th', { class: 'add-col', title: 'Add a property', onclick: (e) => showMenu({ anchor: e.currentTarget, keepFocus: false, items: [{ label: 'New property…', icon: 'plus', value: '__new' }, ...(cs.filter((c) => v.hidden.includes(c.key)).length ? [{ sep: true }, { head: 'Hidden' }, ...cs.filter((c) => v.hidden.includes(c.key)).map((c) => ({ label: c.label, icon: KIND_ICON[c.kind], value: c.key }))] : [])], onPick: (it) => { if (it.value === '__new') V.typeEditor(tid, { newProp: true }); else { v.hidden = v.hidden.filter((k) => k !== it.value); save(); paintBody(); } } }), html: icon('plus', 14) })));
    const tbody = h('tbody');
    const addRow = (prefill) => h('tr', { class: 'new-row' }, h('td', { colspan: vc.length + 1 }, h('button', { class: 'db-new', html: `${icon('plus', 13)}<span>New</span>`, onclick: () => newRow(prefill) })));
    const rowEl = (o) => h('tr', { class: 'db-row' }, vc.map((c) => h('td', { class: `c-${c.kind}` }, cell(o, c))), h('td', { class: 'row-act' }, h('button', { class: 'icon-btn small', html: icon('dots', 14), onclick: (e) => rowMenu(e.currentTarget, o) })));
    if (groupCol) {
      const groups = new Map(); list.forEach((o) => { const k = groupKey(o, groupCol); (groups.get(k) || groups.set(k, []).get(k)).push(o); });
      if (groupCol.kind === 'select') (groupCol.options || []).forEach((o) => { if (!groups.has(o)) groups.set(o, []); });
      const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : groupCol.kind === 'select' ? (groupCol.options || []).indexOf(a) - (groupCol.options || []).indexOf(b) : a.localeCompare(b)));
      keys.forEach((k) => {
        const rowsIn = groups.get(k); const off = collapsed.has(k);
        tbody.append(h('tr', { class: 'group-row' }, h('td', { colspan: vc.length + 1, onclick: () => { off ? collapsed.delete(k) : collapsed.add(k); paintBody(); } }, h('span', { class: `gcaret${off ? ' off' : ''}`, html: icon('chevD', 13) }), h('b', null, k || `No ${groupCol.label.toLowerCase()}`), h('em', null, rowsIn.length))));
        if (!off) { rowsIn.forEach((o) => tbody.append(rowEl(o))); if (tid !== 'daily') tbody.append(addRow(groupCol.kind === 'select' && k ? { [groupCol.key]: k } : groupCol.kind === 'boolean' ? { [groupCol.key]: k === 'Checked' } : {})); }
      });
    } else { list.forEach((o) => tbody.append(rowEl(o))); if (tid !== 'daily') tbody.append(addRow({})); }
    return h('div', { class: 'db-wrap' }, h('table', { class: 'db' }, thead, tbody));
  };

  const preview = (o) => { if (o.pdf) { let n = 0; walk(o.blocks, (b) => { if (b.pdf && !b.img) n++; }); return `${o.pdf.pages} page${o.pdf.pages > 1 ? 's' : ''} · ${n} highlight${n === 1 ? '' : 's'}`; } let p = ''; walk(o.blocks, (b) => { if (p.length < 140 && b.text.trim()) p += (p ? ' · ' : '') + b.text.replace(/\[\[|\]\]|\*\*/g, ''); }); return p.slice(0, 140) || 'Empty'; };
  const open = (o) => V.go(tid === 'daily' ? '#/daily/' + o.date : '#/o/' + o.id);
  const card = (o) => h('a', { class: 'obj-card', onclick: () => open(o), style: { '--c': t.color } },
    (o.props?.cover || o.pdf?.thumb) ? h('img', { class: `obj-cover${o.pdf ? ' thumb' : ''}`, src: o.props?.cover || o.pdf.thumb, loading: 'lazy', alt: '', onerror: (e) => e.target.remove() }) : null,
    h('div', { class: 'obj-card-top' }, V.typeBadge(t), h('span', { class: 'obj-card-time' }, timeAgo(o.updated))),
    h('div', { class: 'obj-card-title' }, o.title), h('div', { class: 'obj-card-prev' }, preview(o)), o.props?.author ? h('div', { class: 'obj-card-sub' }, o.props.author) : null);

  const paintBody = () => {
    const v = view(); const list = rows(); body.textContent = '';
    if (v.mode === 'table') body.append(tableView(list, v));
    else if (!list.length) body.append(h('div', { class: 'empty small' }, h('p', null, 'Nothing matches.')));
    else if (v.mode === 'gallery') body.append(h('div', { class: 'grid' }, list.map(card)));
    else if (v.mode === 'list') body.append(h('div', { class: 'olist' }, list.map((o) => h('a', { class: 'orow', onclick: () => open(o), style: { '--c': t.color } }, V.typeBadge(t), h('span', { class: 'orow-title' }, o.title), h('span', { class: 'orow-prev' }, preview(o)), h('span', { class: 'orow-time' }, timeAgo(o.updated))))));
    else if (v.mode === 'board') {
      const gc = cols().find((c) => c.key === v.group && c.kind === 'select');
      if (!gc) { body.append(h('div', { class: 'empty small' }, h('p', null, 'Board needs a Label property to group by. Use Group in the toolbar.'))); }
      else {
        const opts = [...(gc.options || []), ''];
        body.append(h('div', { class: 'board' }, opts.map((opt) => {
          const col = list.filter((o) => (o.props?.[gc.key] || '') === opt);
          const el = h('div', { class: 'col' }, h('div', { class: 'col-head' }, h('span', null, opt || `No ${gc.label.toLowerCase()}`), h('b', null, col.length)),
            col.map((o) => { const c = card(o); c.draggable = true; c.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', o.id)); return c; }),
            tid === 'daily' ? null : h('button', { class: 'db-new', html: `${icon('plus', 13)}<span>New</span>`, onclick: () => newRow({ [gc.key]: opt }) }));
          el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); }); el.addEventListener('dragleave', () => el.classList.remove('over'));
          el.addEventListener('drop', (e) => { e.preventDefault(); const o = getObject(e.dataTransfer.getData('text/plain')); if (o) { o.props[gc.key] = opt; touch(o); paintBody(); } });
          return el;
        })));
      }
    }
    if (focusId) { const el = body.querySelector(`[data-id="${focusId}"]`); focusId = null; if (el) { el.focus(); el.select?.(); } }
  };
  const paintAll = () => { paintTabs(); paintTools(); paintBody(); };

  page.append(h('div', { class: 'view-head' }, h('h1', { class: 'with-ic', style: { '--c': t.color } }, V.typeBadge(t), t.plural),
    h('span', { class: 'view-actions' }, tid === 'daily' ? null : h('button', { class: 'btn small', html: `${icon('edit', 13)}<span>Edit type</span>`, onclick: () => V.typeEditor(tid) }),
      tid === 'daily' ? null : h('button', { class: 'btn primary small', html: `${icon('plus', 14)}<span>${tid === 'pdf' ? 'Import PDF' : 'New ' + esc(t.name.toLowerCase())}</span>`, onclick: () => (tid === 'pdf' ? V.newObject(tid) : newRow({})) }))),
    ...(tid === 'pdf' ? [V.dropZone()] : []), tabs, tools, body);
  paintAll(); root.append(page);
}

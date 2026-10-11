import { h, esc, todayKey, addDays, parseKey, dateKey, dailyTitle, relDate, relDateTime, timeAgo, WEEKDAYS, MONTHS_LONG, download, copyText, fmtTime, pad } from './util.js';
import { icon, ICON_NAMES } from './icons.js';
import { S, runtime, getObject, typeOf, ensureDaily, createObject, deleteObject, renameObject, touch, backlinks, unlinkedMentions, linkMention, objectsOfType, allObjects, collectTasks, toggleFavorite, outgoing, walk, newBlock, toggleTask, saveNow, findByTitle, snapshot, restoreSnapshot, linksIn, typeProps, refObjects, setRefs, propRefs, PROP_KINDS } from './store.js';
import { mountOutline } from './outline.js';
import { renderInline, chip } from './inline.js';
import { showMenu, toast, confirmBox, promptBox, modal, closeMenu } from './ui.js';
import * as I from './integrations.js';
import * as hooks from './hooks.js';
import { objectToMarkdown, downloadZip, downloadSingle } from './export.js';
import { Reader } from './reader.js';
import { pickFiles, importFiles, ACCEPT } from './importer.js';

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
  setViewObj(obj);
  const t = typeOf(obj);
  const page = h('div', { class: 'page' });
  setActions(objActions(obj));

  const title = h('textarea', { class: 'title-input', rows: '1', placeholder: 'Untitled', spellcheck: 'false', value: obj.title });
  const fit = () => { title.style.height = '0'; title.style.height = title.scrollHeight + 'px'; };
  title.addEventListener('input', fit);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); page.querySelector('.blk-view, .blk-edit')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } });
  title.addEventListener('blur', () => { if (title.value.trim() !== obj.title) { renameObject(obj, title.value); document.title = obj.title + ' · Folio'; } });

  const kind = h('button', { class: 'kind-pill', style: { '--c': t.color }, html: `${icon(t.icon, 13)}<span>${esc(t.name)}</span>${icon('chevD', 12)}`, onclick: (e) => {
    showMenu({ anchor: e.currentTarget, keepFocus: false, items: [...Object.values(S.types).filter((x) => x.id !== 'daily').map((x) => ({ label: x.name, icon: x.icon, color: x.color, value: x.id, check: x.id === obj.type })), { sep: true }, { label: 'Edit this type…', icon: 'edit', value: '__edit' }, { label: 'New type…', icon: 'plus', value: '__new' }],
      onPick: (it) => { if (it.value === '__edit') return typeEditor(obj.type); if (it.value === '__new') return typeEditor(null); obj.type = it.value; touch(obj, true); rerender(); } });
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

const hashColor = (str) => { let n = 0; for (const c of str) n = (n * 31 + c.charCodeAt(0)) >>> 0; return ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6'][n % 8]; };
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Pick an existing object (restricted to allowed types) or create one on the spot. */
function pickObject(anchor, d, exclude, onPick) {
  const allowed = d.types?.length ? d.types.filter((t) => S.types[t]) : Object.keys(S.types).filter((t) => t !== 'daily');
  const input = h('input', { class: 'menu-input', placeholder: `Find ${allowed.length === 1 ? S.types[allowed[0]].plural.toLowerCase() : 'objects'}…` });
  const items = () => {
    const q = input.value.trim();
    const res = allObjects().filter((o) => allowed.includes(o.type) && !exclude.has(o.id) && (!q || o.title.toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => (a.title.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1) - (b.title.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1) || b.updated - a.updated).slice(0, 8);
    const out = res.map((o) => ({ label: o.title, sub: typeOf(o).name, icon: typeOf(o).icon, color: typeOf(o).color, obj: o }));
    if (q && !res.some((o) => o.title.toLowerCase() === q.toLowerCase())) {
      if (out.length) out.push({ sep: true });
      allowed.forEach((tid) => out.push({ label: `New ${S.types[tid].name.toLowerCase()} “${q}”`, icon: 'plus', color: S.types[tid].color, create: tid, title: q }));
    }
    return out;
  };
  const ctl = showMenu({ anchor, keepFocus: false, header: input, items: items(), width: 300, onPick: (it) => {
    let o = it.obj;
    if (it.create) o = createObject({ type: it.create, title: it.title, blocks: it.create === 'meeting' ? import_meetingBlocks() : undefined });
    onPick(o);
  } });
  input.addEventListener('input', () => ctl.update(items()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); ctl.move(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); ctl.move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); ctl.pick(); } else if (e.key === 'Escape') closeMenu();
  });
  setTimeout(() => input.focus(), 10);
}

function entityEditor(obj, d) {
  const box = h('div', { class: 'ent' });
  const paint = () => {
    box.textContent = '';
    const cur = refObjects(obj, d.key);
    cur.forEach((t) => { const st = typeOf(t); box.append(h('span', { class: 'ent-chip', style: { '--c': st.color } },
      h('a', { html: `${icon(st.icon, 12)}<span>${esc(t.title)}</span>`, onclick: () => go(t.type === 'daily' ? '#/daily/' + t.date : '#/o/' + t.id) }),
      h('button', { title: 'Remove', html: icon('x', 11), onclick: () => { setRefs(obj, d.key, cur.filter((x) => x !== t)); paint(); } }))); });
    if (d.multi || !cur.length) box.append(h('button', { class: 'ent-add', html: `${icon('plus', 12)}<span>${cur.length ? '' : 'Add'}</span>`, onclick: (e) => pickObject(e.currentTarget, d, new Set(cur.map((x) => x.id)), (o) => { setRefs(obj, d.key, d.multi ? [...cur, o] : [o]); paint(); }) }));
  };
  paint(); return box;
}

function dateEditor(obj, d, set, repaint) {
  const raw = obj.props[d.key] || ''; const [s0, e0] = String(raw).split('->').map((x) => x.trim());
  const start = h('input', { type: 'date', class: 'prop-input', value: s0 || '' });
  const end = h('input', { type: 'date', class: 'prop-input', value: e0 || '' });
  const commit = () => { set(start.value ? (end.value ? `${start.value} -> ${end.value}` : start.value) : ''); };
  start.addEventListener('change', () => { commit(); repaint(); }); end.addEventListener('change', () => { commit(); repaint(); });
  const wrap = h('div', { class: 'prop-date' }, start);
  if (e0 || wrap.dataset.range) wrap.append(h('span', { class: 'muted' }, '→'), end);
  else if (s0) wrap.append(h('button', { class: 'add-prop', onclick: (e) => { e.currentTarget.replaceWith(h('span', { class: 'muted' }, '→'), end); end.focus(); }, html: `${icon('plus', 12)}<span>End</span>` }));
  if (s0) wrap.append(h('a', { class: 'prop-open', title: 'Open daily note', onclick: () => go('#/daily/' + s0), html: icon('arrowR', 13) }));
  return wrap;
}

function propsEl(obj) {
  const wrap = h('div', { class: 'props' });
  const defs = () => [{ key: 'aliases', label: 'Aliases', kind: 'aliases' }, ...typeProps(obj)];
  const isSet = (d) => (d.kind === 'aliases' ? obj.aliases?.length : d.kind === 'entity' ? refObjects(obj, d.key).length : d.kind === 'boolean' ? obj.props[d.key] !== undefined : d.kind === 'number' ? obj.props[d.key] !== undefined && obj.props[d.key] !== '' : obj.props[d.key]);
  const shown = new Set(defs().filter(isSet).map((d) => d.key));
  const paint = () => {
    wrap.textContent = '';
    const all = defs();
    all.filter((d) => shown.has(d.key)).forEach((d) => {
      const val = obj.props[d.key] ?? '';
      const set = (v) => { obj.props[d.key] = v; touch(obj); };
      let input;
      if (d.kind === 'aliases') input = h('input', { class: 'prop-input', type: 'text', value: (obj.aliases || []).join(', '), placeholder: 'Other names that link here, comma separated', onchange: (e) => { obj.aliases = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); touch(obj, true); } });
      else if (d.kind === 'entity') input = entityEditor(obj, d);
      else if (d.kind === 'select') {
        const c = val ? hashColor(val) : null;
        input = h('button', { class: `label-pill${val ? '' : ' empty'}`, style: c ? { '--c': c } : {}, html: `<span>${esc(val || 'Choose…')}</span>${icon('chevD', 11)}`, onclick: (e) => showMenu({ anchor: e.currentTarget, keepFocus: false, items: [...(d.options || []).map((o) => ({ label: o, value: o, check: o === val })), { sep: true }, { label: 'Clear', value: '' }], onPick: (it) => { set(it.value); paint(); } }) });
      } else if (d.kind === 'boolean') input = h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: obj.props[d.key] === true, onchange: (e) => set(e.target.checked) }), h('i'));
      else if (d.kind === 'date') input = dateEditor(obj, d, set, paint);
      else if (d.kind === 'number') input = h('input', { class: 'prop-input', type: 'number', value: val, placeholder: 'Empty', onchange: (e) => set(e.target.value === '' ? '' : Number(e.target.value)) });
      else if (d.kind === 'richtext') { input = h('textarea', { class: 'prop-input area', rows: '1', placeholder: 'Empty', value: val, oninput: (e) => { e.target.style.height = '0'; e.target.style.height = e.target.scrollHeight + 'px'; }, onchange: (e) => set(e.target.value) }); setTimeout(() => { input.style.height = '0'; input.style.height = input.scrollHeight + 'px'; }, 0); }
      else input = h('div', { class: 'prop-date' }, h('input', { class: 'prop-input', type: 'text', value: val, placeholder: 'Empty', onchange: (e) => set(e.target.value.trim()) }), d.kind === 'url' && val ? h('a', { class: 'prop-open', href: /^https?:/.test(val) ? val : 'https://' + val, target: '_blank', rel: 'noopener', html: icon('external', 13) }) : null);
      wrap.append(h('div', { class: 'prop', 'data-key': d.key }, h('span', { class: 'prop-label', title: d.label }, d.label), input));
    });
    const rest = all.filter((d) => !shown.has(d.key));
    wrap.append(h('button', { class: 'add-prop', html: `${icon('plus', 13)}<span>Property</span>`, onclick: (e) => showMenu({ anchor: e.currentTarget, keepFocus: false, items: [
      ...rest.map((d) => ({ label: d.label, sub: d.kind === 'entity' ? (d.types || []).map((t) => S.types[t]?.name).filter(Boolean).join(', ') || 'Object' : (PROP_KINDS.find((k) => k[0] === d.kind) || [])[1], value: d.key })),
      ...(rest.length ? [{ sep: true }] : []), { label: 'New property…', icon: 'plus', value: '__new' }, { label: `Edit ${typeOf(obj).name.toLowerCase()} type…`, icon: 'edit', value: '__edit' }],
    onPick: (it) => { if (it.value === '__new') typeEditor(obj.type, { newProp: true }); else if (it.value === '__edit') typeEditor(obj.type); else { shown.add(it.value); paint(); const c = wrap.querySelector(`.prop[data-key="${it.value}"]`)?.querySelector('.label-pill, .ent-add, input:not([type=checkbox]), textarea'); if (c && c.tagName === 'INPUT') c.focus(); else setTimeout(() => c?.click?.(), 30); } } }) }));
  };
  paint(); return wrap;
}

// ======================================================================
// Type editor: name, icon, color and properties (including object-type properties)
// ======================================================================
const TYPE_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#64748b'];
export function typeEditor(typeId, { newProp = false } = {}) {
  const orig = typeId ? S.types[typeId] : null;
  const d = orig ? structuredClone(orig) : { id: '', name: '', plural: '', icon: 'file', color: TYPE_COLORS[(Object.keys(S.types).length * 3) % TYPE_COLORS.length], props: [], builtin: false };
  d.props = (d.props || []).map((p) => ({ ...p }));
  if (newProp) d.props.push({ label: '', kind: 'text', _new: true });
  const name = h('input', { class: 'input', placeholder: 'Type name, e.g. Recipe', value: d.name });
  const plural = h('input', { class: 'input', placeholder: 'Plural', value: d.plural });
  let ico = d.icon; let col = d.color;
  const icons = h('div', { class: 'icon-pick' }), colors = h('div', { class: 'color-pick' });
  const paintPick = () => {
    icons.textContent = ''; ICON_NAMES.forEach((n) => icons.append(h('button', { class: n === ico ? 'on' : '', html: icon(n, 15), onclick: () => { ico = n; paintPick(); } })));
    colors.textContent = ''; TYPE_COLORS.forEach((c) => colors.append(h('button', { style: { background: c }, class: c === col ? 'on' : '', onclick: () => { col = c; paintPick(); } })));
  };
  const list = h('div', { class: 'pe-list' });
  const paintProps = () => {
    list.textContent = '';
    if (!d.props.length) list.append(h('div', { class: 'muted small', style: { padding: '8px 2px' } }, 'No properties yet.'));
    d.props.forEach((p, i) => {
      const label = h('input', { class: 'input', placeholder: 'Property name', value: p.label, oninput: (e) => { p.label = e.target.value; } });
      const kind = h('select', { class: 'input', onchange: (e) => { p.kind = e.target.value; if (p.kind === 'entity') { p.types ||= []; p.multi ??= false; } paintProps(); } }, PROP_KINDS.map(([k, l]) => h('option', { value: k, selected: k === p.kind }, l)));
      const cfg = h('div', { class: 'pe-cfg' });
      if (p.kind === 'select') cfg.append(h('input', { class: 'input', placeholder: 'Options, comma separated (Low, Medium, High)', value: (p.options || []).join(', '), oninput: (e) => { p.options = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); } }));
      if (p.kind === 'entity') {
        const tl = Object.values(S.types).filter((t) => t.id !== 'daily');
        const chips = h('div', { class: 'pe-types' }, h('span', { class: 'muted small' }, 'Links to:'), tl.map((t) => h('button', { class: `pe-type${(p.types || []).includes(t.id) ? ' on' : ''}`, style: { '--c': t.color }, html: `${icon(t.icon, 12)}<span>${esc(t.name)}</span>`, onclick: (e) => { p.types ||= []; const k = p.types.indexOf(t.id); if (k >= 0) p.types.splice(k, 1); else p.types.push(t.id); e.currentTarget.classList.toggle('on'); } })), h('span', { class: 'muted small' }, 'none selected = any type'));
        cfg.append(chips, h('label', { class: 'pe-check' }, h('input', { type: 'checkbox', checked: !!p.multi, onchange: (e) => { p.multi = e.target.checked; } }), h('span', null, 'Allow several')));
      }
      list.append(h('div', { class: 'pe-row' }, h('div', { class: 'pe-main' }, label, kind,
        h('button', { class: 'icon-btn small', title: 'Move up', html: icon('up', 14), disabled: i === 0, onclick: () => { d.props.splice(i - 1, 0, d.props.splice(i, 1)[0]); paintProps(); } }),
        h('button', { class: 'icon-btn small', title: 'Move down', html: `<span style="display:inline-block;transform:rotate(180deg)">${icon('up', 14)}</span>`, disabled: i === d.props.length - 1, onclick: () => { d.props.splice(i + 1, 0, d.props.splice(i, 1)[0]); paintProps(); } }),
        h('button', { class: 'icon-btn small', title: 'Remove property', html: icon('trash', 14), onclick: () => { d.props.splice(i, 1); paintProps(); } })), cfg.children.length ? cfg : null));
      if (p._new) setTimeout(() => { label.focus(); delete p._new; }, 30);
    });
  };
  const save = () => {
    const n = name.value.trim(); if (!n) { name.focus(); return toast('Give the type a name'); }
    d.name = n; d.plural = plural.value.trim() || n + 's'; d.icon = ico; d.color = col;
    if (!d.id) { let id = slug(n) || 'type'; while (S.types[id]) id += '-2'; d.id = id; }
    const used = new Set(['tags', 'aliases', 'title']);
    d.props = d.props.filter((p) => p.label.trim()).map((p) => {
      let key = p.key; if (!key) { key = slug(p.label).replace(/-/g, '_') || 'prop'; let k = key; let i = 2; while (used.has(k) || d.props.some((x) => x !== p && x.key === k)) k = key + '_' + i++; key = k; }
      used.add(key); const out = { key, label: p.label.trim(), kind: p.kind };
      if (p.kind === 'select') out.options = p.options || []; if (p.kind === 'entity') { out.types = p.types || []; out.multi = !!p.multi; }
      return out;
    });
    delete d._new; S.types[d.id] = d; touch(null, true); m.close(); rerender();
    if (!orig) go('#/type/' + d.id);
  };
  const del = orig && !orig.builtin ? h('button', { class: 'btn ghost danger-text', onclick: async () => { if (objectsOfType(orig.id).length) return toast('Move or delete its objects first'); if (await confirmBox(`Delete the “${orig.name}” type?`)) { delete S.types[orig.id]; touch(null, true); m.close(); go('#/daily'); } } }, 'Delete type') : null;
  const body = h('div', { class: 'pe' },
    h('div', { class: 'pe-grid' }, h('label', null, h('span', null, 'Name'), name), h('label', null, h('span', null, 'Plural'), plural)),
    h('div', { class: 'pe-sec' }, h('span', { class: 'pe-label' }, 'Icon'), icons), h('div', { class: 'pe-sec' }, h('span', { class: 'pe-label' }, 'Color'), colors),
    h('div', { class: 'pe-sec' }, h('span', { class: 'pe-label' }, 'Properties'), list,
      h('button', { class: 'btn small', html: `${icon('plus', 13)}<span>Add property</span>`, onclick: () => { d.props.push({ label: '', kind: 'text', _new: true }); paintProps(); } }),
      h('p', { class: 'muted small' }, 'Use “Object” to link to other types, for example Attendees → People. Linked objects show backlinks and appear in the graph.')),
    h('div', { class: 'modal-actions pe-actions' }, del, h('span', { class: 'top-spacer' }), h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Save')));
  const m = modal(body, { title: orig ? `Edit type · ${orig.name}` : 'New object type', wide: true });
  paintPick(); paintProps(); if (!orig) setTimeout(() => name.focus(), 30);
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
  const n = groups.reduce((s, g) => s + (g.blocks.length || (g.via?.length ? 1 : 0)), 0);
  const sec = h('section', { class: 'refs' });
  const bar = h('button', { class: 'refs-bar', html: `${icon('chevD', 14, 'caret')}<span>${label}</span><b>${n}</b>` });
  const body = h('div', { class: 'refs-body' });
  groups.forEach((g) => {
    const t = typeOf(g.obj);
    body.append(h('div', { class: 'ref-group' },
      h('a', { class: 'ref-title', onclick: () => go('#/o/' + g.obj.id), style: { '--c': t.color }, html: `${icon(t.icon, 14)}<span>${esc(g.obj.title)}</span>` }),
      g.via?.length ? h('div', { class: 'ref-via' }, `as ${g.via.join(', ')}`) : null,
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
  const obj = ensureDaily(key); setViewObj(obj);
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
function cellText(o, c) {
  const v = o.props?.[c.k];
  if (c.kind === 'entity') return refObjects(o, c.k).map((x) => x.title).join(', ');
  if (c.kind === 'boolean') return v === true ? '✓' : v === false ? '—' : '';
  if (c.kind === 'date' && v) return String(v).split('->').map((x) => relDate(x.trim())).join(' → ');
  return v ?? '';
}
function dropZone() {
  const z = h('div', { class: 'dropzone', tabindex: '0', role: 'button' },
    h('div', { class: 'dz-ic', html: icon('pdf', 26) }),
    h('div', { class: 'dz-main' }, h('b', null, 'Drop PDFs here'), h('span', null, 'or click to browse. You can drop several at once, plus Word, Markdown, text and images.')));
  z.addEventListener('click', () => importInto(null));
  z.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); importInto(null); } });
  z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('over'); });
  z.addEventListener('dragleave', (e) => { if (!z.contains(e.relatedTarget)) z.classList.remove('over'); });
  z.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); z.classList.remove('over'); document.querySelector('.drop-overlay')?.remove(); const f = [...(e.dataTransfer?.files || [])]; if (f.length) handleImport(f, null); });
  return z;
}
export function renderType(tid) {
  const t = S.types[tid]; const root = main(); root.textContent = '';
  if (!t) return go('#/daily');
  setActions([]);
  S.settings.views ||= {};
  const selects = (t.props || []).filter((p) => p.kind === 'select' && p.options?.length);
  const selectProp = selects.find((p) => p.key === S.settings.views?.[tid + ':group']) || selects[0];
  const modes = [['grid', 'Gallery', 'grid'], ['table', 'Table', 'table'], ['list', 'List', 'list'], ...(selectProp ? [['board', `Board`, 'board']] : [])];
  let mode = S.settings.views[tid] || 'grid'; if (!modes.some((m) => m[0] === mode)) mode = 'grid';
  let q = ''; let tag = ''; let sort = { k: tid === 'daily' ? 'date' : 'updated', dir: -1 };
  const page = h('div', { class: 'page wide' });
  const body = h('div', { class: 'type-body' });
  const preview = (o) => { if (o.pdf) { let n = 0; walk(o.blocks, (b) => { if (b.pdf && !b.img) n++; }); return `${o.pdf.pages} page${o.pdf.pages > 1 ? 's' : ''} · ${n} highlight${n === 1 ? '' : 's'}`; } let p = ''; walk(o.blocks, (b) => { if (p.length < 140 && b.text.trim()) p += (p ? ' · ' : '') + b.text.replace(/\[\[|\]\]|\*\*/g, ''); }); return p.slice(0, 140) || 'Empty'; };
  const tagsOf = (o) => { const set = new Set(); walk(o.blocks, (b) => linksIn(b.text).forEach((l) => set.add(l))); return set; };
  const open = (o) => go('#/o/' + o.id);
  const items = () => {
    let r = objectsOfType(tid).filter((o) => o.title.toLowerCase().includes(q));
    if (tag) r = r.filter((o) => tagsOf(o).has(tag));
    const val = (o) => (sort.k === 'title' ? o.title.toLowerCase() : sort.k === 'date' ? o.date || '' : sort.k === 'updated' ? o.updated : (o.props?.[sort.k] || '').toLowerCase());
    return r.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
  };
  const card = (o) => h('a', { class: 'obj-card', onclick: () => open(o), style: { '--c': t.color } },
    (o.props?.cover || o.pdf?.thumb) ? h('img', { class: `obj-cover${o.pdf ? ' thumb' : ''}`, src: o.props?.cover || o.pdf.thumb, loading: 'lazy', alt: '', onerror: (e) => e.target.remove() }) : null,
    h('div', { class: 'obj-card-top' }, typeBadge(t), h('span', { class: 'obj-card-time' }, timeAgo(o.updated))),
    h('div', { class: 'obj-card-title' }, o.title), h('div', { class: 'obj-card-prev' }, preview(o)), o.props?.author ? h('div', { class: 'obj-card-sub' }, o.props.author) : null);
  const paint = () => {
    body.textContent = ''; const list = items();
    if (!list.length) { body.append(h('div', { class: 'empty small' }, h('p', null, `No ${t.plural.toLowerCase()} yet.`))); return; }
    if (mode === 'grid') body.append(h('div', { class: 'grid' }, list.map(card)));
    else if (mode === 'list') body.append(h('div', { class: 'olist' }, list.map((o) => h('a', { class: 'orow', onclick: () => open(o), style: { '--c': t.color } }, typeBadge(t), h('span', { class: 'orow-title' }, o.title), h('span', { class: 'orow-prev' }, preview(o)), h('span', { class: 'orow-time' }, timeAgo(o.updated))))));
    else if (mode === 'table') {
      const cols = [{ k: 'title', l: 'Title' }, ...(t.props || []).filter((p) => p.kind !== 'richtext').slice(0, 5).map((p) => ({ k: p.key, l: p.label, kind: p.kind })), { k: 'updated', l: 'Updated' }];
      const th = (c) => h('th', { class: sort.k === c.k ? 'sorted' : '', onclick: () => { sort = { k: c.k, dir: sort.k === c.k ? -sort.dir : 1 }; paint(); } }, c.l, sort.k === c.k ? (sort.dir > 0 ? ' ↑' : ' ↓') : '');
      body.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, cols.map(th))),
        h('tbody', null, list.map((o) => h('tr', { onclick: () => open(o) }, cols.map((c) => h('td', { class: c.k === 'title' ? 'tt' : '' }, c.k === 'title' ? o.title : c.k === 'updated' ? timeAgo(o.updated) : cellText(o, c)))))))));
    } else if (mode === 'board') {
      const opts = [...selectProp.options, ''];
      if (selects.length > 1) body.append(h('div', { class: 'board-group' }, 'Group by', h('select', { class: 'input', onchange: (e) => { S.settings.views[tid + ':group'] = e.target.value; touch(); renderType(tid); } }, selects.map((p) => h('option', { value: p.key, selected: p.key === selectProp.key }, p.label)))));
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
    h('span', { class: 'view-actions' }, tid === 'daily' ? null : h('button', { class: 'btn small', html: `${icon('edit', 13)}<span>Edit type</span>`, onclick: () => typeEditor(tid) }), tid === 'daily' ? null : h('button', { class: 'btn primary small', html: `${icon('plus', 14)}<span>${tid === 'pdf' ? 'Import PDF' : 'New ' + esc(t.name.toLowerCase())}</span>`, onclick: () => newObject(tid) }))),
    ...(tid === 'pdf' ? [dropZone()] : []),
    h('div', { class: 'type-tools' }, search, tagSel, h('span', { class: 'top-spacer' }), seg), body);
  paint(); root.append(page);
}
/** Pick files, import them, and open the result (a single file) or the PDFs list (several). */
export async function importInto(into, accept = ACCEPT) {
  const files = await pickFiles({ accept }); if (!files.length) return;
  await handleImport(files, into);
}
export async function handleImport(files, into) {
  const res = await importFiles(files, { into });
  const objs = res.filter((r) => !r.inline).map((r) => r.obj);
  if (!objs.length) { rerender(); return; }
  const to = objs.length === 1 && !into ? '#/o/' + objs[0].id : res.every((r) => r.kind === 'pdf') && !into ? '#/type/pdf' : null;
  if (to && location.hash !== to) go(to); else rerender();
}
export function newObject(tid = 'page') {
  if (tid === 'pdf') return importInto(null, '.pdf,application/pdf');
  const o = createObject({ type: tid, title: 'Untitled', blocks: tid === 'meeting' ? import_meetingBlocks() : undefined, props: tid === 'meeting' ? { date: todayKey() } : {} });
  o._fresh = true; go('#/o/' + o.id);
}
import { meetingBlocks as import_meetingBlocks } from './store.js';

// ======================================================================
// Graph
// ======================================================================
export function renderGraph(focusId) {
  const root = main(); root.textContent = ''; setActions([]);
  S.settings.graph ||= { hidden: [], daily: false, orphans: false, props: true, depth: 2 };
  const G = S.settings.graph;
  const focus = focusId ? getObject(focusId) : null;
  const page = h('div', { class: 'page graph-page' });
  const canvas = h('canvas', { class: 'graph' });
  const bar = h('div', { class: 'g-bar' }); const legend = h('div', { class: 'g-legend' });
  page.append(h('div', { class: 'view-head' }, h('h1', null, focus ? `Graph · ${focus.title}` : 'Graph'), h('span', { class: 'muted small' }, 'Drag to move · scroll to zoom · click to open')), bar, legend, canvas);
  root.append(page);
  const save = () => touch();

  // --- build the data set from text links and object-type properties ---
  const all = allObjects();
  const lookup = new Map(); all.forEach((o) => { lookup.set(o.title.trim().toLowerCase(), o); });
  all.forEach((o) => (o.aliases || []).forEach((a) => { if (!lookup.has(a.trim().toLowerCase())) lookup.set(a.trim().toLowerCase(), o); }));
  const edges = new Map();
  const addEdge = (a, b, kind) => { if (!a || !b || a === b) return; const k = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id; const e = edges.get(k); if (e) { if (kind === 'prop') e.kind = 'prop'; } else edges.set(k, { a, b, kind }); };
  all.forEach((o) => {
    walk(o.blocks, (blk) => linksIn(blk.text).forEach((l) => addEdge(o, lookup.get(l), 'text')));
    if (G.props) propRefs(o).forEach((r) => addEdge(o, r.target, 'prop'));
  });
  const eList = [...edges.values()];
  const adj = new Map(); eList.forEach((e) => { (adj.get(e.a.id) || adj.set(e.a.id, []).get(e.a.id)).push(e.b.id); (adj.get(e.b.id) || adj.set(e.b.id, []).get(e.b.id)).push(e.a.id); });
  const typeCounts = {}; all.forEach((o) => { typeCounts[o.type] = (typeCounts[o.type] || 0) + 1; });

  let nodes = []; let links = []; let heat = 1; let hover = null; let drag = null; let query = '';
  const rebuild = () => {
    let keep;
    if (focus) { keep = new Set([focus.id]); let frontier = [focus.id]; for (let d = 0; d < G.depth; d++) { const nx = []; frontier.forEach((id) => (adj.get(id) || []).forEach((n) => { if (!keep.has(n)) { keep.add(n); nx.push(n); } })); frontier = nx; } }
    const visible = (o) => (o.id === focus?.id) || (!G.hidden.includes(o.type) && (G.daily || o.type !== 'daily'));
    const pool = all.filter((o) => (!keep || keep.has(o.id)) && visible(o));
    const ids = new Set(pool.map((o) => o.id));
    const ls = eList.filter((e) => ids.has(e.a.id) && ids.has(e.b.id));
    const deg = new Map(); ls.forEach((e) => { deg.set(e.a.id, (deg.get(e.a.id) || 0) + 1); deg.set(e.b.id, (deg.get(e.b.id) || 0) + 1); });
    const old = new Map(nodes.map((n) => [n.o.id, n]));
    nodes = pool.filter((o) => G.orphans || deg.get(o.id) || o.id === focus?.id).map((o, i) => { const n = old.get(o.id); const r = 5 + Math.min(11, Math.sqrt(deg.get(o.id) || 0) * 2.6) + (o.id === focus?.id ? 4 : 0); return n ? Object.assign(n, { r, deg: deg.get(o.id) || 0 }) : { o, x: Math.cos(i * 2.4) * (60 + i * 6), y: Math.sin(i * 2.4) * (60 + i * 6), vx: 0, vy: 0, r, deg: deg.get(o.id) || 0 }; });
    const idx = new Map(nodes.map((n) => [n.o.id, n]));
    links = ls.map((e) => ({ a: idx.get(e.a.id), b: idx.get(e.b.id), kind: e.kind })).filter((l) => l.a && l.b);
    heat = 1; paintBar();
  };

  const paintBar = () => {
    bar.textContent = '';
    const tog = (label, key, extra) => h('label', { class: 'g-toggle' }, h('input', { type: 'checkbox', checked: !!G[key], onchange: (e) => { G[key] = e.target.checked; save(); if (key === 'props') return renderGraph(focusId); rebuild(); } }), h('span', null, label));
    bar.append(...[h('input', { class: 'input search', placeholder: 'Find in graph…', value: query, oninput: (e) => { query = e.target.value.toLowerCase(); } }),
      tog('Daily notes', 'daily'), tog('Unlinked', 'orphans'), tog('Property links', 'props'),
      focus ? h('span', { class: 'g-depth' }, 'Depth', h('select', { class: 'input', onchange: (e) => { G.depth = +e.target.value; save(); rebuild(); } }, [1, 2, 3].map((n) => h('option', { value: n, selected: n === G.depth }, n))), h('a', { class: 'btn small', onclick: () => go('#/graph') }, 'Show all'), h('a', { class: 'btn small', onclick: () => go('#/o/' + focus.id) }, 'Open note')) : null].filter(Boolean));
    legend.textContent = '';
    Object.values(S.types).filter((t) => typeCounts[t.id]).forEach((t) => {
      const off = G.hidden.includes(t.id);
      legend.append(h('button', { class: `g-chip${off ? ' off' : ''}`, style: { '--c': t.color }, title: off ? 'Show' : 'Hide', onclick: () => { G.hidden = off ? G.hidden.filter((x) => x !== t.id) : [...G.hidden, t.id]; save(); rebuild(); }, html: `<i></i><span>${esc(t.plural)}</span><em>${typeCounts[t.id]}</em>` }));
    });
    legend.append(h('span', { class: 'g-key' }, h('i', { class: 'k-text' }), 'Text link', h('i', { class: 'k-prop' }), 'Property'));
  };

  const ctx = canvas.getContext('2d'); let W; let H; let scale = 1; let ox = 0; let oy = 0; let alive = true;
  const dpr = window.devicePixelRatio || 1;
  const resize = () => { const r = canvas.getBoundingClientRect(); W = r.width; H = r.height; canvas.width = W * dpr; canvas.height = H * dpr; };
  rebuild(); resize(); ox = W / 2; oy = H / 2;
  if (!nodes.length) { canvas.replaceWith(h('div', { class: 'empty small' }, h('p', null, focus ? 'Nothing linked to this object yet.' : 'Link objects with [[double brackets]] or object-type properties to grow your graph.'))); return; }
  const css = getComputedStyle(document.documentElement);
  const step = () => {
    if (!alive || !canvas.isConnected) return;
    if (heat > 0.02) {
      for (const a of nodes) for (const b of nodes) { if (a === b) continue; const dx = a.x - b.x; const dy = a.y - b.y; const d2 = dx * dx + dy * dy + 0.1; if (d2 > 90000) continue; const f = 2600 / d2; const d = Math.sqrt(d2); a.vx += (dx / d) * f; a.vy += (dy / d) * f; }
      for (const l of links) { const dx = l.b.x - l.a.x; const dy = l.b.y - l.a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const f = (d - 90) * 0.012; l.a.vx += (dx / d) * f; l.a.vy += (dy / d) * f; l.b.vx -= (dx / d) * f; l.b.vy -= (dy / d) * f; }
      for (const n of nodes) { n.vx -= n.x * 0.003; n.vy -= n.y * 0.003; if (n !== drag) { n.x += n.vx * heat; n.y += n.vy * heat; } n.vx *= 0.82; n.vy *= 0.82; }
      heat *= 0.992;
    }
    draw(); requestAnimationFrame(step);
  };
  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.translate(ox, oy); ctx.scale(scale, scale);
    const line = css.getPropertyValue('--line-strong').trim() || '#ccc'; const text = css.getPropertyValue('--text').trim() || '#222'; const accent = css.getPropertyValue('--accent').trim() || '#6558f5';
    const near = new Set(); if (hover) links.forEach((l) => { if (l.a === hover) near.add(l.b); if (l.b === hover) near.add(l.a); });
    const match = (n) => query && n.o.title.toLowerCase().includes(query);
    ctx.lineWidth = 1 / scale;
    for (const l of links) {
      const on = hover && (l.a === hover || l.b === hover);
      ctx.strokeStyle = on ? typeOf(hover.o).color : l.kind === 'prop' ? accent : line; ctx.globalAlpha = hover && !on ? 0.2 : l.kind === 'prop' ? 0.75 : 0.9; ctx.setLineDash(l.kind === 'prop' ? [] : [4 / scale, 3 / scale]);
      ctx.lineWidth = (l.kind === 'prop' ? 1.8 : 1) / scale; ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const n of nodes) {
      const dim = (hover && n !== hover && !near.has(n)) || (query && !match(n));
      ctx.globalAlpha = dim ? 0.18 : 1;
      ctx.fillStyle = typeOf(n.o).color; ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fill();
      if (n.o.id === focus?.id || match(n)) { ctx.strokeStyle = text; ctx.lineWidth = 2 / scale; ctx.stroke(); }
      if (!dim && (scale > 0.65 || n === hover || n.r > 9 || match(n))) { ctx.fillStyle = text; ctx.font = `${n === hover || n.o.id === focus?.id ? 600 : 500} ${12 / Math.max(scale, 0.8)}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(n.o.title.length > 28 ? n.o.title.slice(0, 27) + '…' : n.o.title, n.x, n.y + n.r + 14 / Math.max(scale, 0.8)); }
    }
    ctx.globalAlpha = 1;
  };
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale }; };
  const pick = (e) => { const p = pt(e); return nodes.find((n) => (n.x - p.x) ** 2 + (n.y - p.y) ** 2 <= (n.r + 4) ** 2) || null; };
  let moved = false; let pan = null;
  canvas.addEventListener('mousedown', (e) => { moved = false; const n = pick(e); if (n) { drag = n; heat = Math.max(heat, 0.4); } else pan = { x: e.clientX - ox, y: e.clientY - oy }; });
  const up = () => { drag = null; pan = null; }; window.addEventListener('mouseup', up);
  canvas.addEventListener('mousemove', (e) => { moved = true; if (drag) { const p = pt(e); drag.x = p.x; drag.y = p.y; heat = Math.max(heat, 0.3); } else if (pan) { ox = e.clientX - pan.x; oy = e.clientY - pan.y; } else { hover = pick(e); canvas.style.cursor = hover ? 'pointer' : 'grab'; } });
  canvas.addEventListener('click', (e) => { const n = pick(e); if (n && !moved) go(n.o.type === 'daily' ? '#/daily/' + n.o.date : '#/o/' + n.o.id); });
  canvas.addEventListener('dblclick', (e) => { const n = pick(e); if (n) go('#/graph/' + n.o.id); });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const k = Math.exp(-e.deltaY * 0.0012); const r = canvas.getBoundingClientRect(); const mx = e.clientX - r.left; const my = e.clientY - r.top; ox = mx - (mx - ox) * k; oy = my - (my - oy) * k; scale *= k; }, { passive: false });
  window.addEventListener('hashchange', () => { alive = false; window.removeEventListener('mouseup', up); }, { once: true });
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
  const rwAuto = h('div', { class: 'seg' }, [['on', 'Auto'], ['off', 'Manual']].map(([k, l]) => h('button', { class: (S.settings.readwiseAuto !== false) === (k === 'on') ? 'on' : '', onclick: () => { S.settings.readwiseAuto = k === 'on'; save(); renderSettings(); } }, l)));
  page.append(sec('Readwise', 'Get your token at readwise.io/access_token. Books, articles and highlights import as Source objects; highlights are quote bullets you can link and annotate. New and changed highlights sync in the background every few minutes. Highlights you edit or annotate in Folio are never overwritten or removed.',
    h('div', { class: 'set-form' }, rwIn, h('button', { class: 'btn primary', onclick: async (e) => { S.settings.readwiseToken = rwIn.value.trim(); save(); const b = e.currentTarget; b.disabled = true; rwMsg.className = 'set-msg'; try { const r = await I.syncReadwise((bk, hl) => { rwMsg.textContent = `Imported ${bk} sources…`; }); rwMsg.textContent = `Done · ${r.books} sources updated, ${r.highlights} new highlights.`; rwMsg.className = 'set-msg ok'; } catch (err) { rwMsg.textContent = err.message; rwMsg.className = 'set-msg err'; } b.disabled = false; } }, 'Connect & import')),
    row(`Keep in sync${S.cache.readwiseSyncedAt ? ' · last ' + timeAgo(Date.parse(S.cache.readwiseSyncedAt)) : ''}`, rwAuto),
    h('div', { class: 'set-actions' }, h('button', { class: 'btn small ghost', onclick: () => { S.cache.readwiseSyncedAt = null; save(); rwMsg.textContent = 'Next import will fetch everything again.'; } }, 'Reset sync cursor')), rwMsg));

  // Email in
  const emSec = h('div', { class: 'set-body' }); const emMsg = h('div', { class: 'set-msg' });
  const paintEmail = async () => {
    emSec.textContent = '';
    if (!runtime.proxy) { emSec.append(h('div', { class: 'muted small' }, 'Run “node server.js” and open Folio from it to use email-in.')); return; }
    let st; try { st = await I.emailStatus(); } catch (e) { emSec.append(h('div', { class: 'set-msg err' }, e.message)); return; }
    if (!st.available) { emSec.append(h('div', { class: 'set-msg err' }, 'Email-in needs two small packages. In the Folio folder run:  npm install   then restart the server.')); return; }
    const host = h('input', { class: 'input', placeholder: 'IMAP host', value: st.host || 'imap.gmail.com' });
    const user = h('input', { class: 'input grow', placeholder: 'you@gmail.com', value: st.user });
    const pass = h('input', { class: 'input grow', type: 'password', placeholder: st.configured ? 'App password saved. Leave blank to keep it.' : 'App password' });
    const box = h('input', { class: 'input', placeholder: 'Folder or label', value: st.mailbox || 'Folio' });
    const plus = /^([^@+]+)@gmail\.com$/i.exec(st.user || '');
    emSec.append(
      h('div', { class: 'set-form' }, user, pass), h('div', { class: 'set-form' }, host, box,
        h('button', { class: 'btn primary', onclick: async (e) => { e.currentTarget.disabled = true; emMsg.className = 'set-msg'; emMsg.textContent = 'Connecting…'; try { await I.emailSave({ host: host.value, user: user.value, pass: pass.value, mailbox: box.value }); emMsg.textContent = 'Connected.'; emMsg.className = 'set-msg ok'; paintEmail(); } catch (err) { emMsg.textContent = err.message; emMsg.className = 'set-msg err'; e.currentTarget.disabled = false; } } }, st.configured ? 'Save & test' : 'Connect')),
      st.configured ? h('div', { class: 'set-actions' },
        h('button', { class: 'btn', html: `${icon('refresh', 14)}<span>Check now</span>`, onclick: async () => { emMsg.className = 'set-msg'; emMsg.textContent = 'Checking…'; try { const r = await I.pullEmail({ poll: true }); emMsg.textContent = r.n ? `Added ${r.n} email${r.n > 1 ? 's' : ''} to your daily notes.` : 'No new email.'; emMsg.className = 'set-msg ok'; if (r.status?.error) { emMsg.textContent = r.status.error; emMsg.className = 'set-msg err'; } } catch (err) { emMsg.textContent = err.message; emMsg.className = 'set-msg err'; } } }),
        h('button', { class: 'btn ghost', onclick: async () => { await I.emailDisconnect(); paintEmail(); } }, 'Disconnect'),
        h('span', { class: 'muted small' }, st.lastCheck ? `Last checked ${timeAgo(st.lastCheck)}${st.error ? ' · ' + st.error : ''}` : 'Not checked yet')) : null,
      st.configured && plus ? h('div', { class: 'set-msg ok' }, `Send or forward to ${plus[1]}+folio@gmail.com`) : null);
  };
  page.append(sec('Email in', 'Email items to yourself and they land in that day’s daily note as bullets tagged #email. Start a subject with “todo:” to make it a task. Setup for Gmail: turn on IMAP, make an app password (myaccount.google.com/apppasswords), create a label called Folio, and add a filter that labels mail sent to you+folio@gmail.com with Folio and skips the inbox. Other providers work with any IMAP folder. The password is kept only on this computer, in a local file.', emSec, emMsg));
  paintEmail();

  // Proxy
  page.append(sec('Network', runtime.proxy ? 'Local proxy detected. Readwise and calendar feeds are routed through it, which avoids browser CORS limits.' : 'Todoist works directly from the browser. Readwise and most calendar feeds need the small local proxy: run “node server.js” and open Folio from it.',
    row('Proxy', h('span', { class: `status ${runtime.proxy ? 'on' : ''}` }, runtime.proxy ? 'Connected' : 'Not running'))));

  // Types
  const typeList = h('div', { class: 'type-list' });
  const paintTypes = () => {
    typeList.textContent = '';
    Object.values(S.types).filter((t) => t.id !== 'daily').forEach((t) => typeList.append(h('button', { class: 'type-item', onclick: () => typeEditor(t.id) }, typeBadge(t), h('span', null, t.name), h('small', null, `${(t.props || []).length} props · ${objectsOfType(t.id).length}`), h('span', { class: 'type-edit', html: icon('edit', 13) }))));
  };
  paintTypes();
  page.append(sec('Object types', 'Every note is an object with a type. Edit a type to rename it, change its icon and color, or add properties. An “Object” property links to other types, like Attendees to People.', typeList,
    h('div', { class: 'set-actions' }, h('button', { class: 'btn primary', html: `${icon('plus', 14)}<span>New type</span>`, onclick: () => typeEditor(null) }))));

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
    h('div', { class: 'pn-actions' }, h('button', { class: 'btn small', onclick: () => present(obj), html: `${icon('play', 12)}<span>Present</span>` }), h('button', { class: 'btn small', onclick: () => historyModal(obj), html: `${icon('history', 12)}<span>History</span>` }), h('button', { class: 'btn small', onclick: () => go('#/graph/' + obj.id), html: `${icon('graph', 12)}<span>Graph</span>` }))));
  return wrap;
}

// ======================================================================
// Highlights library (Readwise + PDF) and the drawer used while writing
// ======================================================================
const HL_COL = { yellow: '#facc15', green: '#4ade80', blue: '#60a5fa', pink: '#f472b6', orange: '#fb923c', purple: '#c084fc', red: '#f87171' };
const hlColor = (it) => HL_COL[it.block.color] || HL_COL[it.block.pdf?.color] || HL_COL.yellow;
let viewObj = null;
export const setViewObj = (o) => { viewObj = o; };

/** Insert a live reference to a highlight into the open note (after the block being edited, else at the end). */
export function insertRef(blockId) {
  const o = viewObj; if (!o) return toast('Open a note first, then add highlights to it.');
  const nb = newBlock('', { ref: blockId });
  const cur = currentOutline();
  const rec = cur && cur.obj === o && cur.editId ? locate(cur.editId) : null;
  if (rec) rec.arr.splice(rec.i + 1, 0, nb);
  else { const last = o.blocks[o.blocks.length - 1]; if (last && !last.text && !last.children.length && !last.task) o.blocks.splice(o.blocks.length - 1, 1, nb, newBlock('')); else o.blocks.push(nb); }
  touch(o, true); rerender(); toast(`Added to “${o.title}”`);
}

function hlCardEl(it, { showSource = true, draggable = true } = {}) {
  const b = it.block; const st = typeOf(it.obj);
  const card = h('div', { class: 'hl-card', style: { '--hl': hlColor(it) }, draggable: draggable ? 'true' : null },
    h('div', { class: 'hl-text', html: renderInline(b.text) }),
    it.note ? h('div', { class: 'hl-note', html: renderInline(it.note) }) : null,
    h('div', { class: 'hl-foot' },
      showSource ? h('a', { class: 'hl-src', style: { '--c': st.color }, onclick: () => go(`#/o/${it.obj.id}?b=${b.id}`), html: `${icon(st.icon, 12)}<span>${esc(it.obj.title)}</span>` }) : null,
      b.pdf ? h('span', { class: 'hl-meta' }, `p. ${b.pdf.page}`) : b.loc ? h('span', { class: 'hl-meta' }, `loc. ${b.loc}`) : null,
      (b.hlTags || []).map((t) => h('span', { class: 'hl-tag' }, '#' + t)),
      h('span', { class: 'top-spacer' }),
      h('button', { class: 'hl-add', title: 'Add to the open note', html: `${icon('plus', 12)}<span>Add</span>`, onclick: (e) => { e.stopPropagation(); insertRef(b.id); } })));
  card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-folio-ref', b.id); e.dataTransfer.setData('text/plain', b.text); e.dataTransfer.effectAllowed = 'copy'; });
  return card;
}

function highlightBrowser({ compact }) {
  const wrap = h('div', { class: `hlb${compact ? ' compact' : ''}` });
  let q = ''; let src = ''; let color = ''; let tag = ''; let kind = '';
  const all = I.allHighlights();
  const sources = [...new Map(all.map((x) => [x.obj.id, x.obj])).values()].sort((a, b) => a.title.localeCompare(b.title));
  const tags = [...new Set(all.flatMap((x) => x.block.hlTags || []))].sort();
  const list = h('div', { class: 'hl-list' });
  const paint = () => {
    list.textContent = '';
    const items = all.filter((x) => (!src || x.obj.id === src) && (!color || (x.block.color || x.block.pdf?.color || 'yellow') === color) && (!tag || (x.block.hlTags || []).includes(tag)) && (!kind || x.kind === kind)
      && (!q || (x.block.text + ' ' + x.note + ' ' + x.obj.title).toLowerCase().includes(q)));
    if (!items.length) { list.append(h('div', { class: 'empty small' }, h('p', null, all.length ? 'No highlights match.' : 'No highlights yet. Connect Readwise in Settings, or highlight text in a PDF.'))); return; }
    if (compact) { items.slice(0, 120).forEach((it) => list.append(hlCardEl(it))); return; }
    const groups = new Map(); items.forEach((it) => { if (!groups.has(it.obj.id)) groups.set(it.obj.id, []); groups.get(it.obj.id).push(it); });
    [...groups.values()].sort((a, b) => Math.max(...b.map((x) => Date.parse(x.block.at) || 0)) - Math.max(...a.map((x) => Date.parse(x.block.at) || 0))).forEach((g) => {
      const o = g[0].obj; const st = typeOf(o);
      list.append(h('section', { class: 'hl-group' },
        h('div', { class: 'hl-ghead', onclick: () => go('#/o/' + o.id) }, o.props?.cover ? h('img', { src: o.props.cover, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : typeBadge(st), h('div', null, h('div', { class: 'hl-gtitle' }, o.title), h('div', { class: 'hl-gsub' }, `${o.props?.author ? o.props.author + ' · ' : ''}${g.length} highlight${g.length > 1 ? 's' : ''}`))),
        h('div', { class: 'hl-gbody' }, g.map((it) => hlCardEl(it, { showSource: false })))));
    });
  };
  const sel = (label, opts, set) => h('select', { class: 'input', onchange: (e) => { set(e.target.value); paint(); } }, h('option', { value: '' }, label), opts.map(([v, l]) => h('option', { value: v }, l)));
  wrap.append(h('div', { class: 'hl-tools' },
    h('input', { class: 'input search', placeholder: 'Search highlights…', oninput: (e) => { q = e.target.value.toLowerCase(); paint(); } }),
    sel('All sources', sources.map((o) => [o.id, o.title]), (v) => { src = v; }),
    ...(compact ? [] : [sel('All colors', Object.keys(HL_COL).map((c) => [c, c[0].toUpperCase() + c.slice(1)]), (v) => { color = v; }), ...(tags.length ? [sel('All tags', tags.map((t) => [t, '#' + t]), (v) => { tag = v; })] : []), sel('Readwise + PDF', [['readwise', 'Readwise'], ['pdf', 'PDFs']], (v) => { kind = v; })])), list);
  paint(); return wrap;
}

export function renderHighlights() {
  const root = main(); root.textContent = ''; setActions([]); setViewObj(null);
  const total = I.allHighlights().length;
  const page = h('div', { class: 'page wide' }, h('div', { class: 'view-head' }, h('h1', null, 'Highlights', h('span', { class: 'muted' }, ` ${total}`)),
    I.readwiseConnected() ? h('button', { class: 'btn small', html: `${icon('refresh', 14)}<span>Sync Readwise</span>`, onclick: async (e) => { e.currentTarget.disabled = true; try { const r = await I.syncReadwise(); toast(`Readwise synced · ${r.highlights} new or changed`); } catch (err) { toast(err.message, { kind: 'warn', ms: 7000 }); } renderHighlights(); } }) : h('button', { class: 'btn small', onclick: () => go('#/settings') }, 'Connect Readwise')),
    h('p', { class: 'muted small hl-hint' }, 'Open any note and use the highlights drawer, or drag a card into a note. A dragged highlight stays linked to its source and shows your edits.'),
    highlightBrowser({ compact: false }));
  root.append(page);
}

export function toggleHighlightDrawer(force) {
  const ex = document.getElementById('hl-drawer');
  if (force === false || (ex && force !== true)) { ex?.remove(); document.body.classList.remove('hl-open'); return; }
  if (ex) return;
  const d = h('aside', { class: 'hl-drawer', id: 'hl-drawer' },
    h('div', { class: 'hl-dhead' }, h('span', { html: `${icon('highlighter', 16)}<b>Highlights</b>` }), h('button', { class: 'icon-btn small', html: icon('x', 15), onclick: () => toggleHighlightDrawer() })),
    h('div', { class: 'hl-dsub' }, 'Drag a highlight into your note, or press Add.'), highlightBrowser({ compact: true }));
  document.body.append(d); document.body.classList.add('hl-open');
}
import { currentOutline } from './outline.js';
import { locate } from './store.js';

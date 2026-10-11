// Client side of the Markdown vault: writes changed notes to the folder and absorbs edits made outside Folio.
import { S, runtime, getObject, createObject, ensureObject, findByTitle, ensureDaily, allObjects, touch, subscribe, renameObject, getFile, walk, typeProps, newBlock, dirtyIds, persist, deleteObject, snapshot } from './store.js';
import { serialize, basePath, safeName, parseFrontMatter, parseBody, mergeExtras } from './vaultmd.js';
import { debounce, titleToKey } from './util.js';

export const vstate = { last: 0, error: '', busy: false, pulled: 0 };
const on = () => runtime.proxy && S.settings.vault?.on;
async function api(path, { method = 'GET', body, raw } = {}) {
  const r = await fetch(`${runtime.proxyBase}/vault/${path}`, { method, headers: { 'x-folio': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: raw || (body ? JSON.stringify(body) : undefined), cache: 'no-store' });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Vault error ${r.status}`); return j;
}
export const vaultStatus = () => api('status');
const V = () => (S.cache.vault ||= { at: {}, paths: {}, files: {} });

export async function connectVault(dir) {
  const st = await api('config', { method: 'POST', body: { dir } });
  S.settings.vault = { on: true }; V();
  persist();
  await pullChanges(); await syncNow({ all: true });
  return st;
}
export async function disconnectVault() { await api('config', { method: 'DELETE' }); S.settings.vault = { on: false }; S.cache.vault = { at: {}, paths: {}, files: {} }; persist(); }

function assignPaths(objs) {
  const used = new Map(); const want = {};
  [...objs].sort((a, b) => a.created - b.created).forEach((o) => {
    const base = basePath(o); const k = base.toLowerCase(); const n = used.get(k) || 0; used.set(k, n + 1);
    want[o.id] = n ? base.replace(/\.md$/i, ` ${n + 1}.md`) : base;
  });
  return want;
}
async function uploadBinary(id, rel) {
  const v = V(); if (v.files[id]) return;
  try { if ((await api(`has?id=${encodeURIComponent(id)}`)).has) { v.files[id] = true; return; } } catch { /* try upload */ }
  const blob = await getFile(id); if (!blob) return;
  await api(`file?id=${encodeURIComponent(id)}&path=${encodeURIComponent(rel)}`, { method: 'PUT', raw: blob });
  v.files[id] = true;
}

let again = false;
/** Write changed notes (and removals) to the vault folder. */
export async function syncNow({ all = false } = {}) {
  if (!on()) return;
  if (vstate.busy) { again = true; return; }
  vstate.busy = true;
  try {
    const v = V(); const objs = allObjects(); const want = assignPaths(objs);
    const items = [];
    for (const o of objs) if (all || dirtyIds.has(o.id) || v.at[o.id] !== o.updated || v.paths[o.id] !== want[o.id]) { const { content, meta } = serialize(o); items.push({ id: o.id, path: want[o.id], content, meta, updated: o.updated }); }
    const live = new Set(objs.map((o) => o.id));
    const remove = Object.keys(v.at).filter((id) => !live.has(id));
    for (const o of objs) {
      if (o.pdf?.fileId && items.some((i) => i.id === o.id)) await uploadBinary(o.pdf.fileId, `Files/${safeName(o.pdf.name || o.title)}`);
      const imgs = []; if (items.some((i) => i.id === o.id)) walk(o.blocks, (b) => { if (b.img) imgs.push(b); });
      for (const b of imgs) await uploadBinary(b.img, `Files/${b.img}.${b.imgExt || 'png'}`);
    }
    for (let i = 0; i < Math.max(items.length, 1); i += 40) {
      const batch = items.slice(i, i + 40);
      if (!batch.length && !(i === 0 && remove.length)) break;
      await api('write', { method: 'POST', body: { items: batch.map(({ updated, ...rest }) => rest), remove: i === 0 ? remove : [] } });
      for (const it of batch) { v.at[it.id] = it.updated; v.paths[it.id] = it.path; dirtyIds.delete(it.id); }
    }
    for (const id of remove) { delete v.at[id]; delete v.paths[id]; }
    vstate.last = Date.now(); vstate.error = ''; persist();
  } catch (e) { vstate.error = e.message; } finally { vstate.busy = false; }
  if (again) { again = false; setTimeout(() => syncNow(), 300); }
}

// ---------- external edits ----------
function resolveType(fm, path, existing) {
  const types = Object.values(S.types);
  const byName = (n) => types.find((t) => t.name.toLowerCase() === String(n).toLowerCase() || t.plural.toLowerCase() === String(n).toLowerCase());
  return (fm.type && byName(fm.type)) || byName(path.split('/')[0]) || (existing && S.types[existing.type]) || S.types.page;
}
function toValue(def, raw, typeObj) {
  const arr = Array.isArray(raw) ? raw : raw === '' || raw == null ? [] : [raw];
  if (def.kind === 'entity') {
    const objs = arr.map((x) => { const title = String(x).replace(/^\[\[|\]\]$/g, '').split('|')[0].replace(/#.*$/, '').trim(); if (!title) return null; const hit = findByTitle(title); if (hit) return hit; const pre = pending.get(title.toLowerCase()); return createObject({ type: pre?.type || (def.types || [])[0] || 'page', title, extra: pre?.id ? { id: pre.id } : {} }); }).filter(Boolean);
    return objs.map((o) => o.id);
  }
  if (def.kind === 'boolean') return String(arr[0]).toLowerCase() === 'true';
  if (def.kind === 'number') return arr[0] === undefined || arr[0] === '' ? '' : Number(arr[0]);
  return arr[0] === undefined ? '' : String(arr[0]);
}
let pending = new Map(); // titles of notes arriving in the same batch, so links to them reuse the incoming note
const RESERVED = new Set(['folio_id', 'title', 'type', 'date', 'aliases', 'created', 'updated', 'file', 'pages']);

function applyChange(c) {
  const { fm, body } = parseFrontMatter(c.content);
  const base = c.path.split('/').pop().replace(/\.md$/i, '');
  let obj = (c.id && getObject(c.id)) || (fm.folio_id && getObject(fm.folio_id)) || null;
  const t = resolveType(fm, c.path, obj);
  const dayKey = t.id === 'daily' ? (fm.date || titleToKey(base) || (/^\d{4}-\d{2}-\d{2}$/.test(base) ? base : null)) : null;
  let isNew = false; let renamed = false;
  if (t.id === 'daily' && dayKey) { obj = obj || ensureDaily(dayKey); }
  else if (!obj) {
    // A note with the same title and type that the vault has not seen yet is the same note: adopt it.
    const title0 = String(fm.title || base).trim().toLowerCase();
    obj = Object.values(S.objects).find((o) => o.type === t.id && o.title.trim().toLowerCase() === title0 && !V().at[o.id]) || null;
  }
  if (!obj) {
    obj = createObject({ type: t.id === 'daily' ? 'page' : t.id, title: String(fm.title || base).trim() || 'Untitled', blocks: [newBlock('')], extra: fm.folio_id && !getObject(fm.folio_id) ? { id: fm.folio_id } : {} });
    isNew = true;
  }
  if (!isNew && obj.blocks.some((b) => b.text || b.children.length)) snapshot(obj, true); // recoverable from History
  if (c.meta?.object) { if (c.meta.object.pdf && !obj.pdf) obj.pdf = c.meta.object.pdf; Object.assign(obj.props ||= {}, c.meta.object.props || {}); }
  if (obj.type !== t.id && t.id !== 'daily') obj.type = t.id;
  if (obj.type !== 'daily') {
    const moved = c.id ? c.path !== V().paths[c.id] : (fm.folio_id && getObject(fm.folio_id) && base !== safeName(obj.title));
    if (!isNew && moved && base !== safeName(obj.title) && (!fm.title || fm.title === obj.title)) { renameObject(obj, base); renamed = true; } // renamed in Obsidian
    else if (fm.title && fm.title !== obj.title) { renameObject(obj, String(fm.title)); renamed = true; }
  }
  obj.aliases = (Array.isArray(fm.aliases) ? fm.aliases : fm.aliases ? [fm.aliases] : []).map(String).filter(Boolean);
  obj.props ||= {};
  const defs = typeProps(obj); const known = new Set(defs.map((d) => d.key));
  for (const d of defs) {
    if (d.key === 'tags') { const names = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : []; obj.props.tags = names.map((n) => ensureObject(String(n).replace(/^#/, ''), 'tag').id); continue; }
    if (d.key in fm) obj.props[d.key] = toValue(d, fm[d.key]); else if (d.kind !== 'boolean') delete obj.props[d.key]; else obj.props[d.key] = false;
  }
  for (const [k, v] of Object.entries(fm)) if (!RESERVED.has(k) && !known.has(k) && k !== 'tags' && !['keywords', 'summary'].includes(k)) obj.props[k] = Array.isArray(v) ? v.join(', ') : String(v);
  const blocks = mergeExtras(parseBody(body, obj.title), isNew || !obj ? null : obj, c.meta);
  obj.blocks = blocks.length ? blocks : [newBlock('')];
  if (fm.created && isNew) { const d = Date.parse(fm.created); if (d) obj.created = d; }
  touch(obj, true);
  const v = V();
  if (renamed) { dirtyIds.add(obj.id); delete v.at[obj.id]; } // rewrite so the front matter title matches the new file name
  else { v.at[obj.id] = obj.updated; v.paths[obj.id] = c.path; dirtyIds.delete(obj.id); }
  return { id: obj.id, path: c.path, hash: c.hash };
}

/** Pull edits made in Obsidian (or any editor). all=true re-reads every note, which restores a vault into an empty Folio. */
export async function pullChanges({ all = false } = {}) {
  if (!runtime.proxy || !S.settings.vault?.on) return 0;
  let n = 0;
  try {
    const { changes } = await api(`changes${all ? '?all=1' : ''}`);
    const movedIds = new Set(changes.filter((c) => c.kind === 'new').map((c) => /^folio_id:\s*(\S+)/m.exec(c.content)?.[1]).filter(Boolean));
    const acks = [];
    pending = new Map();
    for (const c of changes) { if (c.kind === 'deleted') continue; const { fm } = parseFrontMatter(c.content); const b = c.path.split('/').pop().replace(/\.md$/i, ''); const info = { id: fm.folio_id || c.id, type: (Object.values(S.types).find((t) => t.name.toLowerCase() === String(fm.type || '').toLowerCase()) || {}).id }; pending.set(String(fm.title || b).toLowerCase(), info); pending.set(b.toLowerCase(), info); }
    for (const c of changes) {
      if (c.kind === 'deleted') { if (!movedIds.has(c.id)) { V().at[c.id] = -1; dirtyIds.add(c.id); } continue; } // recreate: deleting a file does not delete the note
      if (c.kind === 'same' && getObject(c.id) && V().at[c.id] !== undefined) continue;
      try { acks.push(applyChange(c)); n++; } catch (e) { vstate.error = `${c.path}: ${e.message}`; }
    }
    if (acks.length) await api('ack', { method: 'POST', body: { items: acks } });
    vstate.pulled += n; if (n) persist();
  } catch (e) { vstate.error = e.message; }
  return n;
}

let started = false;
export function startVault(onChange) {
  if (started) return; started = true;
  const push = debounce(() => syncNow(), 1800);
  subscribe(() => { if (on()) push(); });
  const tick = async () => { if (!on() || document.visibilityState !== 'visible' || vstate.busy) return; const n = await pullChanges(); if (n) onChange?.(n); };
  setTimeout(async () => { if (on()) { await pullChanges(); await syncNow(); } }, 1500);
  setInterval(tick, 6000);
  window.addEventListener('beforeunload', () => {});
}

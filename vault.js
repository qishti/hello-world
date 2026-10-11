// Markdown vault: keeps a folder of plain .md files in sync with Folio (Obsidian-compatible).
// The browser app decides what each file contains; this module only touches files inside the chosen folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CONF = path.join(__dirname, '.folio-vault.json');
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
let conf = read(CONF, null);
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const expand = (p) => path.resolve(String(p || '').replace(/^~(?=$|[\\/])/, os.homedir()));

const meta = () => path.join(conf.dir, '.folio');
const manifestFile = () => path.join(meta(), 'manifest.json');
let manifest = null;
function loadManifest() { manifest = read(manifestFile(), { objects: {}, files: {} }); return manifest; }
function saveManifest() { fs.mkdirSync(meta(), { recursive: true }); fs.writeFileSync(manifestFile(), JSON.stringify(manifest)); }
const M = () => manifest || loadManifest();

function inside(rel) {
  const abs = path.resolve(conf.dir, rel);
  if (!abs.startsWith(conf.dir + path.sep) || /(^|[\\/])\.folio([\\/]|$)/.test(rel)) throw new Error('Path outside the vault');
  return abs;
}
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.md$/i.test(e.name)) out.push(p);
  }
  return out;
}

function status() {
  if (!conf) return { configured: false, dir: '', files: 0 };
  let files = 0; try { files = Object.keys(M().objects).length; } catch { /* ignore */ }
  return { configured: true, dir: conf.dir, files, exists: fs.existsSync(conf.dir) };
}
function setDir(dir) {
  const d = expand(dir);
  if (!dir || d === path.parse(d).root) throw new Error('Choose a folder, for example ~/Documents/Folio Vault');
  fs.mkdirSync(d, { recursive: true });
  fs.accessSync(d, fs.constants.W_OK);
  conf = { dir: d }; fs.writeFileSync(CONF, JSON.stringify(conf)); manifest = null; loadManifest(); saveManifest();
  return status();
}
function clear() { conf = null; manifest = null; try { fs.unlinkSync(CONF); } catch { /* none */ } return status(); }

/** items: [{id, path, content, meta}], remove: [id]. External edits are never lost: they are kept as a conflict copy. */
function write(items = [], remove = []) {
  if (!conf) throw new Error('No vault folder chosen');
  const m = M(); let wrote = 0;
  for (const it of items) {
    const abs = inside(it.path); const entry = m.objects[it.id];
    if (entry && entry.path !== it.path) {
      try { const old = inside(entry.path); if (fs.existsSync(old) && sha(fs.readFileSync(old, 'utf8')) === entry.hash) fs.unlinkSync(old); } catch { /* keep */ }
    }
    const hash = sha(it.content);
    if (fs.existsSync(abs)) {
      const disk = fs.readFileSync(abs, 'utf8'); const dh = sha(disk);
      if (dh === hash) { m.objects[it.id] = { path: it.path, hash }; continue; }
      const known = entry && entry.path === it.path ? entry.hash : null;
      if (known && dh !== known) { // edited outside Folio and also changed in Folio: keep both
        const keep = abs.replace(/\.md$/i, ` (conflict ${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}).md`);
        fs.writeFileSync(keep, disk);
      } else if (!known) { // an unrelated file already lives at this path
        const keep = abs.replace(/\.md$/i, ` (existing).md`); if (!fs.existsSync(keep)) fs.writeFileSync(keep, disk);
      }
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, it.content);
    m.objects[it.id] = { path: it.path, hash }; wrote++;
    if (it.meta) { fs.mkdirSync(path.join(meta(), 'meta'), { recursive: true }); fs.writeFileSync(path.join(meta(), 'meta', it.id + '.json'), JSON.stringify(it.meta)); }
  }
  for (const id of remove) {
    const e = m.objects[id]; if (!e) continue;
    try { const abs = inside(e.path); if (fs.existsSync(abs) && sha(fs.readFileSync(abs, 'utf8')) === e.hash) fs.unlinkSync(abs); } catch { /* keep */ }
    delete m.objects[id]; try { fs.unlinkSync(path.join(meta(), 'meta', id + '.json')); } catch { /* none */ }
  }
  saveManifest(); return { wrote };
}

function putFile(rel, fileId, buf) {
  if (!conf) throw new Error('No vault folder chosen');
  if (!/^Files[\\/]/.test(rel)) throw new Error('Files go in Files/');
  const abs = inside(rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, buf);
  const m = M(); m.files[fileId] = { path: rel }; saveManifest(); return { ok: true };
}
const hasFile = (fileId) => !!(conf && M().files[fileId] && fs.existsSync(path.join(conf.dir, M().files[fileId].path)));

/** Files edited, added or removed outside Folio. all=true returns every note (used to restore from a vault). */
function changes(all = false) {
  if (!conf) throw new Error('No vault folder chosen');
  const m = M(); const byPath = new Map(Object.entries(m.objects).map(([id, e]) => [e.path, { id, ...e }]));
  const out = []; const seen = new Set();
  for (const abs of walk(conf.dir)) {
    const rel = path.relative(conf.dir, abs).split(path.sep).join('/'); seen.add(rel);
    const e = byPath.get(rel); const content = fs.readFileSync(abs, 'utf8'); const hash = sha(content);
    if (!e) out.push({ kind: 'new', path: rel, content, hash });
    else if (all || e.hash !== hash) {
      let mt = null; if (all) mt = read(path.join(meta(), 'meta', e.id + '.json'), null);
      out.push({ kind: all && e.hash === hash ? 'same' : 'modified', id: e.id, path: rel, content, hash, meta: mt });
    }
  }
  if (all) for (const c of out) if (c.kind === 'new') { const id = (/^folio_id:\s*(\S+)/m.exec(c.content) || [])[1]; if (id) c.meta = read(path.join(meta(), 'meta', id + '.json'), null); }
  for (const [rel, e] of byPath) if (!seen.has(rel)) out.push({ kind: 'deleted', id: e.id, path: rel });
  return out;
}
/** The app has absorbed these external edits; remember what is on disk so they are not re-sent. */
function ack(items = []) {
  const m = M();
  for (const it of items) { if (it.id) m.objects[it.id] = { path: it.path, hash: it.hash }; }
  saveManifest(); return status();
}

module.exports = { status, setDir, clear, write, putFile, hasFile, changes, ack, configured: () => !!conf };

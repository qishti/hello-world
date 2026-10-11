// Obsidian-compatible Markdown for the vault: one note per object, YAML front matter, nested bullets.
import { S, typeProps, refObjects, locate, walk, newBlock } from './store.js';
import { dailyTitle, titleToKey } from './util.js';

const INTERNAL_PROPS = ['rwId', 'eventId', 'cover', 'readwise'];
const SKIP = new Set(['id', 'text', 'type', 'collapsed', 'children', 'task']);
export const safeName = (s) => String(s).replace(/[\\/:*?"<>|#^\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Untitled';
const yamlStr = (v) => (/^[\w .@/+()-]+$/.test(v) && !/^\s|\s$|^(true|false|null|yes|no|\d+)$/i.test(v) ? v : JSON.stringify(v));

export const basePath = (obj) => (obj.type === 'daily' ? `Daily notes/${obj.date}.md` : `${safeName((S.types[obj.type] || S.types.page).plural)}/${safeName(obj.title)}.md`);

function taskSuffix(t) {
  return `${t.repeat ? ` 🔁 ${t.repeat}` : ''}${t.due ? ` 📅 ${t.due}` : ''}${t.remind ? ` ⏰ ${t.remind}` : ''}${t.todoistId ? ` [todoist:${t.todoistId}]` : ''}${t.status === 'done' && t.completedAt ? ` ✅ ${new Date(t.completedAt).toISOString().slice(0, 10)}` : ''}`;
}
export function blockExtra(b) {
  const e = {}; for (const k of Object.keys(b)) if (!SKIP.has(k) && b[k] !== undefined) e[k] = b[k];
  if (b.task) { const x = {}; for (const k of ['notified', 'doneCount', 'lastDone']) if (b.task[k] !== undefined) x[k] = b.task[k]; if (Object.keys(x).length) e.taskX = x; }
  return e;
}
const dateLinks = (t) => t.replace(/\[\[((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4})(?:\|([^\]]*))?\]\]/g, (m, d) => { const k = titleToKey(d); return k ? `[[${k}|${d}]]` : m; });

export function serialize(obj) {
  const t = S.types[obj.type] || S.types.page;
  const fm = ['---', `folio_id: ${obj.id}`, `title: ${yamlStr(obj.title)}`, `type: ${yamlStr(t.name)}`];
  if (obj.date) fm.push(`date: ${obj.date}`);
  if (obj.pdf) fm.push(`file: Files/${safeName(obj.pdf.name || obj.title)}`, `pages: ${obj.pdf.pages}`);
  if (obj.aliases?.length) fm.push(`aliases: [${obj.aliases.map(yamlStr).join(', ')}]`);
  const tags = new Set(); refObjects(obj, 'tags').forEach((x) => tags.add(x.title));
  walk(obj.blocks, (b) => { for (const m of b.text.matchAll(/(?:^|[\s(])#([A-Za-z0-9][\w-]*)/g)) tags.add(m[1]); });
  if (tags.size) fm.push(`tags: [${[...tags].map(yamlStr).join(', ')}]`);
  const done = new Set(['tags']);
  for (const d of typeProps(obj)) {
    if (done.has(d.key)) continue; done.add(d.key); const v = obj.props?.[d.key];
    if (d.kind === 'entity') { const r = refObjects(obj, d.key); if (r.length) fm.push(`${d.key}: [${r.map((x) => JSON.stringify(`[[${x.title}]]`)).join(', ')}]`); }
    else if (d.kind === 'boolean') { if (v !== undefined) fm.push(`${d.key}: ${v === true}`); }
    else if (d.kind === 'number') { if (v !== undefined && v !== '') fm.push(`${d.key}: ${v}`); }
    else if (v) fm.push(`${d.key}: ${yamlStr(String(v).replace(/\n/g, ' '))}`);
  }
  fm.push(`created: ${new Date(obj.created).toISOString()}`, `updated: ${new Date(obj.updated).toISOString()}`, '---', '');
  const meta = { blocks: {}, object: { pdf: obj.pdf, props: Object.fromEntries(INTERNAL_PROPS.filter((k) => obj.props?.[k] !== undefined).map((k) => [k, obj.props[k]])) } };
  const lines = [];
  walk(obj.blocks, (b, _p, depth) => {
    const pad = '  '.repeat(depth);
    if (b.ref) { const r = locate(b.ref); if (r) lines.push(`${pad}- ![[${safeName(r.obj.title)}#^${b.ref}]]`); return; }
    if (!b.text.trim() && !b.children.length && !b.task && !b.img) return;
    const extra = blockExtra(b); const anchor = Object.keys(extra).length ? ` ^${b.id}` : '';
    if (anchor) meta.blocks[b.id] = extra;
    if (b.type === 'code') { lines.push(`${pad}- \`\`\`${anchor}`, ...b.text.split('\n').map((l) => `${pad}  ${l}`), `${pad}  \`\`\``); return; }
    const head = { h1: '# ', h2: '## ', h3: '### ', quote: '> ', callout: '> [!note] ' }[b.type] || '';
    const box = b.task ? (b.task.status === 'done' ? '[x] ' : '[ ] ') : '';
    let text = dateLinks(b.text).split('\n').join(`\n${pad}  `);
    if (b.img) text = `![snapshot](Files/${b.img}.${b.imgExt || 'png'})${text ? ' ' + text : ''}`;
    const extras = `${b.pdf && !b.img ? ` (p. ${b.pdf.page})` : ''}${b.hlTags?.length ? ' ' + b.hlTags.map((x) => '#' + x).join(' ') : ''}`;
    lines.push(`${pad}- ${box}${head}${text}${extras}${b.task ? taskSuffix(b.task) : ''}${anchor}`.replace(/[ \t]+$/, ''));
  });
  return { content: `${fm.join('\n')}\n${lines.join('\n')}\n`, meta };
}

// ---------- parsing ----------
const unq = (v) => { v = v.trim(); if (/^".*"$/.test(v)) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } } if (/^'.*'$/.test(v)) return v.slice(1, -1); return v; };
function splitList(v) { const out = []; let cur = ''; let q = null; for (const ch of v) { if (q) { cur += ch; if (ch === q) q = null; } else if (ch === '"' || ch === "'") { q = ch; cur += ch; } else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur); return out.map(unq).filter((x) => x !== ''); }
export function parseFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text); const fm = {};
  if (!m) return { fm, body: text };
  const ls = m[1].split(/\r?\n/);
  for (let i = 0; i < ls.length; i++) {
    const km = /^([\w.-]+):\s*(.*)$/.exec(ls[i]); if (!km) continue;
    let v = km[2].trim();
    if (v === '') { const items = []; while (i + 1 < ls.length && /^\s*-\s+/.test(ls[i + 1])) items.push(unq(ls[++i].replace(/^\s*-\s+/, ''))); fm[km[1]] = items.length ? items : ''; }
    else if (v.startsWith('[') && v.endsWith(']')) fm[km[1]] = splitList(v.slice(1, -1));
    else fm[km[1]] = unq(v);
  }
  return { fm, body: text.slice(m[0].length) };
}
const mk = (text, extra = {}) => newBlock(text, extra);
const fixDates = (t) => t.replace(/\[\[(\d{4}-\d{2}-\d{2})\|([^\]]+)\]\]/g, (m, k, d) => `[[${d}]]`).replace(/\[\[(\d{4}-\d{2}-\d{2})\]\]/g, (m, k) => `[[${dailyTitle(k)}]]`);

function parseBullet(content) {
  let id = null; let m = /\s\^([A-Za-z0-9-]{4,})\s*$/.exec(content);
  if (m) { id = m[1]; content = content.slice(0, m.index); }
  const withId = (b) => { if (id) b.id = id; return b; };
  if ((m = /^!\[[^\]]*\]\(Files\/([^)\s]+)\)\s*(.*)$/.exec(content))) { const ext = (/\.([A-Za-z0-9]+)$/.exec(m[1]) || [])[1] || 'png'; return withId(mk(fixDates(m[2] || ''), { img: m[1].replace(/\.[A-Za-z0-9]+$/, ''), imgExt: ext })); }
  if ((m = /^!\[\[(.+?)#\^([\w-]+)\]\]\s*$/.exec(content))) return mk('', { ref: m[2] });
  let task = null;
  if ((m = /^\[( |x|X)\]\s+/.exec(content))) { task = { status: m[1] === ' ' ? 'todo' : 'done' }; content = content.slice(m[0].length); }
  if (task) for (let g = 0; g < 8; g++) {
    let mm;
    if ((mm = /\s\[todoist:(\S+)\]\s*$/.exec(content))) { task.todoistId = mm[1]; content = content.slice(0, mm.index); }
    else if ((mm = /\s(📅|⏰|🔁|✅)\s(\S+)\s*$/.exec(content))) { const k = mm[1]; if (k === '📅') task.due = mm[2]; else if (k === '⏰') task.remind = mm[2]; else if (k === '🔁') task.repeat = mm[2]; else task.completedAt = Date.parse(mm[2]) || Date.now(); content = content.slice(0, mm.index); }
    else break;
  }
  let type = 'text';
  if ((m = /^(#{1,3})\s+/.exec(content))) { type = 'h' + m[1].length; content = content.slice(m[0].length); }
  else if ((m = /^>\s?\[!\w+\]\s*/.exec(content))) { type = 'callout'; content = content.slice(m[0].length); }
  else if ((m = /^>\s?/.exec(content))) { type = 'quote'; content = content.slice(m[0].length); }
  const b = mk(fixDates(content.trim()), { type }); if (task) b.task = task; return withId(b);
}

export function parseBody(text, title) {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/\t/g, '  '));
  const root = []; const hstack = [{ level: 0, kids: root }]; let list = []; let last = null; let para = [];
  const cont = () => hstack[hstack.length - 1].kids;
  const flush = () => { if (para.length) { cont().push(mk(fixDates(para.join(' ').trim()))); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    if (!t.trim()) { flush(); list = []; last = null; continue; }
    let m;
    if ((m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(t))) {
      flush(); const ind = m[1].length; const content = m[3];
      let b;
      if (/^```/.test(content.trim())) {
        const code = []; const anchor = /\s\^([A-Za-z0-9-]{4,})\s*$/.exec(content);
        while (i + 1 < lines.length && !/^\s*```\s*$/.test(lines[i + 1])) code.push(lines[++i].replace(new RegExp(`^ {0,${ind + 2}}`), ''));
        if (i + 1 < lines.length) i++;
        b = mk(code.join('\n'), { type: 'code' }); if (anchor) b.id = anchor[1];
      } else b = parseBullet(content);
      while (list.length && list[list.length - 1].ind >= ind) list.pop();
      (list.length ? list[list.length - 1].block.children : cont()).push(b);
      list.push({ ind, block: b }); last = list[list.length - 1]; continue;
    }
    const lead = t.search(/\S/);
    if (last && lead > last.ind + 1 && !/^#{1,6}\s/.test(t.trim())) { last.block.text += '\n' + fixDates(t.trim()); continue; }
    if (lead === 0 && (m = /^(#{1,6})\s+(.*)$/.exec(t))) {
      flush(); list = []; last = null; const level = m[1].length;
      if (level === 1 && m[2].trim() === title && root.length === 0 && hstack.length === 1) continue;
      while (hstack.length > 1 && hstack[hstack.length - 1].level >= level) hstack.pop();
      const b = mk(fixDates(m[2].trim()), { type: 'h' + Math.min(level, 3) }); cont().push(b); hstack.push({ level, kids: b.children }); continue;
    }
    if (/^>\s?/.test(t.trim())) { flush(); list = []; last = null; cont().push(mk(fixDates(t.trim().replace(/^>\s?/, '')), { type: 'quote' })); continue; }
    last = null; list = []; para.push(t.trim());
  }
  flush(); return root;
}

/** Give anchored blocks back the data Markdown cannot hold, from the live object or the vault's sidecar. */
export function mergeExtras(blocks, existing, meta) {
  const known = new Map(); if (existing) walk(existing.blocks, (b) => known.set(b.id, b));
  walk(blocks, (b) => {
    const old = known.get(b.id); let extra = null;
    if (old) extra = blockExtra(old); else if (meta?.blocks?.[b.id]) extra = meta.blocks[b.id];
    if (!extra) return;
    const { taskX, ...rest } = extra; Object.assign(b, rest);
    if (taskX && b.task) Object.assign(b.task, taskX);
    if (b.pdf && !b.img) b.text = b.text.replace(/\s*\(p\. \d+\)$/, '');
    if (b.hlTags?.length) for (const t of [...b.hlTags].reverse()) b.text = b.text.replace(new RegExp(`\\s+#${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
    if (b.rwNote === undefined && b.rwText !== undefined && old === undefined) { /* keep as is */ }
  });
  return blocks;
}

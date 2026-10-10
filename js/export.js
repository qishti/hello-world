// Plain-Markdown export of everything in Folio: one .md per object, plus index files, in a .zip.
import { S, allObjects, walk, collectTasks, typeOf, linksIn, getFile, locate, typeProps, refObjects } from './store.js';
import { eventsBetween, eventTime, todoistOpen } from './integrations.js';
import { dateKey, todayKey, download, relDate } from './util.js';

const INTERNAL = new Set(['eventId', 'rwId']);
const safe = (s) => String(s).replace(/[\\/:*?"<>|#^\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Untitled';
const yamlStr = (v) => (/^[\w .@/+-]+$/.test(v) && !/^\s|\s$|^(true|false|null|\d+)$/i.test(v) ? v : JSON.stringify(v));

function taskSuffix(t) {
  return `${t.repeat ? ` 🔁 ${t.repeat}` : ''}${t.due ? ` 📅 ${t.due}` : ''}${t.remind ? ` ⏰ ${t.remind}` : ''}${t.todoistId ? ` [todoist:${t.todoistId}]` : ''}${t.status === 'done' && t.completedAt ? ` ✅ ${dateKey(new Date(t.completedAt))}` : ''}`;
}
export function blocksToMarkdown(blocks) {
  const lines = [];
  walk(blocks, (b, _p, depth) => {
    const pad = '  '.repeat(depth);
    if (b.ref) { const r = locate(b.ref); if (r) lines.push(`${pad}- > ${r.block.text.replace(/\n/g, ' ')} ([[${r.obj.title}]]${r.block.pdf ? ', p. ' + r.block.pdf.page : ''})`); return; }
    if (!b.text.trim() && !b.children.length && !b.task && !b.img) return;
    const text = b.text.replace(/\n/g, b.type === 'code' ? '\n' : ' ');
    if (b.type === 'code') {
      lines.push(`${pad}- \`\`\``, ...text.split('\n').map((l) => `${pad}  ${l}`), `${pad}  \`\`\``);
      return;
    }
    if (b.img) { lines.push(`${pad}- ![snapshot${b.pdf ? ' p. ' + b.pdf.page : ''}](Files/${b.img}.png)`); if (!text) return; }
    const head = { h1: '# ', h2: '## ', h3: '### ', quote: '> ', callout: '> [!note] ' }[b.type] || '';
    const box = b.task ? (b.task.status === 'done' ? '[x] ' : '[ ] ') : '';
    lines.push(`${pad}- ${box}${head}${text}${b.pdf && !b.img ? ` (p. ${b.pdf.page})` : ''}${b.hlTags?.length ? ' ' + b.hlTags.map((t) => '#' + t).join(' ') : ''}${b.task ? taskSuffix(b.task) : ''}`.replace(/\s+$/, ''));
  });
  return lines.join('\n');
}

export function objectToMarkdown(obj) {
  const t = typeOf(obj);
  const fm = ['---', `title: ${yamlStr(obj.title)}`, `type: ${t.name}`];
  if (obj.date) fm.push(`date: ${obj.date}`);
  if (obj.aliases?.length) fm.push(`aliases: [${obj.aliases.map(yamlStr).join(', ')}]`);
  if (obj.pdf) { fm.push(`file: Files/${safe(obj.pdf.name || obj.title)}`, `pages: ${obj.pdf.pages}`); if (obj.pdf.analysis) fm.push(`keywords: [${obj.pdf.analysis.keywords.map(yamlStr).join(', ')}]`, `summary: ${JSON.stringify(obj.pdf.analysis.summary)}`); }
  const defs = typeProps(obj); const done = new Set();
  for (const d of defs) {
    done.add(d.key); const v = obj.props?.[d.key];
    if (d.kind === 'entity') { const t = refObjects(obj, d.key); if (t.length) fm.push(`${d.key}: [${t.map((x) => JSON.stringify(`[[${x.title}]]`)).join(', ')}]`); }
    else if (d.kind === 'boolean') { if (v !== undefined) fm.push(`${d.key}: ${v === true}`); }
    else if (d.kind === 'number') { if (v !== undefined && v !== '') fm.push(`${d.key}: ${v}`); }
    else if (v) fm.push(`${d.key}: ${yamlStr(String(v).replace(/\n/g, ' '))}`);
  }
  for (const [k, v] of Object.entries(obj.props || {})) if (v && !INTERNAL.has(k) && !done.has(k) && !Array.isArray(v)) fm.push(`${k}: ${yamlStr(String(v))}`);
  const tags = new Set(); walk(obj.blocks, (b) => { for (const m of b.text.matchAll(/(?:^|[\s(])#([A-Za-z0-9][\w-]*)/g)) tags.add(m[1]); });
  if (tags.size) fm.push(`tags: [${[...tags].join(', ')}]`);
  fm.push(`created: ${new Date(obj.created).toISOString()}`, `updated: ${new Date(obj.updated).toISOString()}`, '---', '');
  return `${fm.join('\n')}\n# ${obj.title}\n\n${blocksToMarkdown(obj.blocks)}\n`;
}

function tasksMarkdown() {
  const L = ['# Tasks', '', '## Open'];
  const open = collectTasks().filter((x) => x.block.task.status !== 'done').sort((a, b) => (a.block.task.due || '9').localeCompare(b.block.task.due || '9'));
  open.forEach(({ obj, block }) => L.push(`- [ ] ${block.text}${taskSuffix(block.task)} — [[${obj.title}]]`));
  const linked = new Set(collectTasks().map((x) => x.block.task.todoistId).filter(Boolean));
  const td = todoistOpen().filter((t) => !linked.has(t.id));
  if (td.length) { L.push('', '## Todoist (not linked to a note)'); td.forEach((t) => L.push(`- [ ] ${t.content}${t.due ? ` 📅 ${t.due}` : ''}${t.project ? ` (${t.project})` : ''} [todoist:${t.id}]`)); }
  L.push('', '## Completed');
  collectTasks().filter((x) => x.block.task.status === 'done').forEach(({ obj, block }) => L.push(`- [x] ${block.text}${taskSuffix(block.task)} — [[${obj.title}]]`));
  return L.join('\n') + '\n';
}
function calendarMarkdown() {
  const from = Date.now() - 60 * 864e5; const to = Date.now() + 180 * 864e5;
  const evs = eventsBetween(from, to); if (!evs.length) return null;
  const L = ['# Calendar events', '', `Cached events from connected calendars (${dateKey(new Date(from))} to ${dateKey(new Date(to))}).`];
  let day = '';
  for (const e of evs) {
    const k = dateKey(new Date(e.start)); if (k !== day) { day = k; L.push('', `## ${k}`); }
    L.push(`- ${eventTime(e)} **${e.title}**${e.location ? ` @ ${e.location.split('\n')[0]}` : ''}${e.attendees.length ? ` — ${e.attendees.map((a) => a.name || a.email).join(', ')}` : ''}`);
  }
  return L.join('\n') + '\n';
}
function typesMarkdown() {
  const L = ['# Object types', ''];
  Object.values(S.types).forEach((t) => L.push(`## ${t.name}`, `- plural: ${t.plural}`, `- icon: ${t.icon}`, `- color: ${t.color}`, ...(t.props?.length ? ['- properties:', ...t.props.map((p) => `  - ${p.label} (${p.kind}${p.kind === 'entity' ? ': ' + ((p.types || []).map((x) => S.types[x]?.name || x).join(', ') || 'any type') + (p.multi ? ', several' : '') : p.kind === 'select' ? ': ' + (p.options || []).join(' / ') : ''})`)] : []), ''));
  return L.join('\n');
}

export async function buildFiles() {
  const files = []; const used = new Set();
  const place = (dir, name, content) => { let p = `${dir}/${safe(name)}`; let n = 2; while (used.has(p.toLowerCase())) p = `${dir}/${safe(name)} ${n++}`; used.add(p.toLowerCase()); files.push({ path: p + '.md', content }); };
  for (const o of allObjects()) {
    if (o.type === 'daily') { if (o.blocks.some((b) => b.text || b.children.length)) place('Daily notes', o.date, objectToMarkdown(o)); }
    else place(typeOf(o).plural, o.title, objectToMarkdown(o));
  }
  for (const o of allObjects()) {
    if (o.pdf?.fileId) { const f = await getFile(o.pdf.fileId); if (f) files.push({ path: `Files/${safe(o.pdf.name || o.title)}`, data: new Uint8Array(await f.arrayBuffer()) }); }
    const imgs = []; walk(o.blocks, (b) => { if (b.img) imgs.push(b.img); });
    for (const id of imgs) { const f = await getFile(id); if (f) files.push({ path: `Files/${id}.png`, data: new Uint8Array(await f.arrayBuffer()) }); }
  }
  files.push({ path: 'Tasks.md', content: tasksMarkdown() }, { path: 'Types.md', content: typesMarkdown() });
  const cal = calendarMarkdown(); if (cal) files.push({ path: 'Calendar.md', content: cal });
  files.push({ path: 'README.md', content: `# Folio export\n\nExported ${new Date().toISOString()}.\n\n- One Markdown file per object, grouped by type. Daily notes are in \`Daily notes/\`.\n- Each file starts with YAML front matter (title, type, properties, aliases, tags, dates).\n- Notes are nested bullet lists. \`[[Title]]\` are links, \`#tag\` are tags.\n- Tasks use \`- [ ]\` with 📅 due, ⏰ reminder, 🔁 repeat and ✅ completion markers.\n- \`Files/\` holds original PDFs and snapshot images. PDF notes quote the highlighted text with its page.\n- \`Tasks.md\`, \`Calendar.md\` and \`Types.md\` are indexes. API tokens are never exported.\n` });
  return files;
}

// ---------- minimal ZIP (store, no compression) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zip(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
  const d = new Date(); const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1); const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.path); const data = f.data || enc.encode(f.content); const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]].forEach(([o, v, n]) => (n === 4 ? lh.setUint32(o, v, true) : lh.setUint16(o, v, true)));
    parts.push(lh.buffer, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]].forEach(([o, v, n]) => (n === 4 ? ch.setUint32(o, v, true) : ch.setUint16(o, v, true)));
    central.push(ch.buffer, name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((s, b) => s + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

export async function downloadZip() {
  const files = await buildFiles();
  const blob = zip(files);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `folio-markdown-${todayKey()}.zip`;
  document.body.append(a); a.click(); a.remove();
  return files.length;
}
export async function downloadSingle() {
  const files = (await buildFiles()).filter((f) => f.content && f.path !== 'README.md');
  download(`folio-all-${todayKey()}.md`, files.map((f) => `<!-- file: ${f.path} -->\n\n${f.content}`).join('\n\n---\n\n'), 'text/markdown');
}

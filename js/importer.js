// Drag-and-drop and file import: PDFs, Markdown/text, Word (.docx), and images.
import { h, uid } from './util.js';
import { S, createObject, newBlock, putFile, touch, findByTitle } from './store.js';
import { importPDF } from './reader.js';
import { toast } from './ui.js';

export const ACCEPT = '.pdf,.md,.markdown,.txt,.docx,.png,.jpg,.jpeg,.gif,.webp,application/pdf,image/*';
export function classify(file) {
  const n = file.name.toLowerCase(); const t = file.type || '';
  if (/\.pdf$/.test(n) || t === 'application/pdf') return 'pdf';
  if (/\.docx$/.test(n)) return 'docx';
  if (/\.(md|markdown|txt)$/.test(n) || t === 'text/plain' || t === 'text/markdown') return 'text';
  if (/^image\//.test(t) || /\.(png|jpe?g|gif|webp)$/.test(n)) return 'image';
  return null;
}

export function pickFiles({ accept = ACCEPT, multiple = true } = {}) {
  return new Promise((res) => {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' }, onchange: () => { const f = [...inp.files]; inp.remove(); res(f); } });
    inp.addEventListener('cancel', () => { inp.remove(); res([]); });
    document.body.append(inp); inp.click();
  });
}

// ---------- Markdown / plain text -> outline ----------
export function textToBlocks(text) {
  text = text.replace(/\r/g, '').replace(/^---\n[\s\S]*?\n---\n/, '');
  const lines = text.split('\n');
  const root = []; const stack = [{ level: 0, kids: root }]; // headings nest what follows
  let list = []; // bullet stack within the current container: {ind, kids}
  const container = () => stack[stack.length - 1].kids;
  let para = [];
  const flushPara = () => { if (para.length) { container().push(newBlock(para.join(' ').trim())); para = []; } };
  let code = null;
  for (const raw of lines) {
    if (/^```/.test(raw.trim())) { if (code) { container().push(newBlock(code.join('\n'), { type: 'code' })); code = null; } else { flushPara(); list = []; code = []; } continue; }
    if (code) { code.push(raw); continue; }
    if (!raw.trim()) { flushPara(); list = []; continue; }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(raw))) {
      flushPara(); list = [];
      const level = m[1].length;
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const b = newBlock(m[2].trim(), { type: 'h' + Math.min(level, 3) });
      container().push(b); stack.push({ level, kids: b.children }); continue;
    }
    if ((m = /^(\s*)(?:[-*+•]|\d+[.)])\s+(.*)$/.exec(raw))) {
      flushPara();
      const ind = m[1].replace(/\t/g, '  ').length; let t = m[2]; let task = null; let tm;
      if ((tm = /^\[( |x|X)\]\s+/.exec(t))) { task = { status: tm[1] === ' ' ? 'todo' : 'done' }; t = t.slice(tm[0].length); }
      const b = newBlock(t.trim(), task ? { task } : {});
      while (list.length && list[list.length - 1].ind >= ind) list.pop();
      (list.length ? list[list.length - 1].block.children : container()).push(b);
      list.push({ ind, block: b }); continue;
    }
    if (/^>\s?/.test(raw)) { flushPara(); container().push(newBlock(raw.replace(/^>\s?/, ''), { type: 'quote' })); continue; }
    list = []; para.push(raw.trim());
  }
  flushPara(); if (code) container().push(newBlock(code.join('\n'), { type: 'code' }));
  return root;
}

// ---------- .docx (a zip of XML) ----------
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzipEntry(buf, wanted) {
  const v = new DataView(buf); const u8 = new Uint8Array(buf);
  let eocd = -1; for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid .docx file');
  let p = v.getUint32(eocd + 16, true); const n = v.getUint16(eocd + 10, true);
  for (let i = 0; i < n; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true); const csize = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true); const el = v.getUint16(p + 30, true); const cl = v.getUint16(p + 32, true); const off = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
    if (name === wanted) {
      const lnl = v.getUint16(off + 26, true); const lel = v.getUint16(off + 28, true);
      const data = u8.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
      return method === 0 ? data : inflateRaw(data);
    }
    p += 46 + nl + el + cl;
  }
  return null;
}
async function docxToBlocks(file) {
  const buf = await file.arrayBuffer();
  const xml = await unzipEntry(buf, 'word/document.xml');
  if (!xml) throw new Error('No text found in that .docx');
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const root = []; const stack = [{ level: 0, kids: root }]; let list = [];
  let title = '';
  const paraText = (p) => { let t = ''; p.querySelectorAll('t, tab, br').forEach((n) => { t += n.localName === 't' ? n.textContent : n.localName === 'tab' ? ' ' : ' '; }); return t.replace(/\s+/g, ' ').trim(); };
  const body = doc.getElementsByTagNameNS(W, 'body')[0]; if (!body) throw new Error('Unreadable .docx');
  const handle = (p) => {
    const text = paraText(p); if (!text) return;
    const style = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') || '';
    const hm = /^(?:Heading|heading)\s?(\d)$/.exec(style) || (/^Title$/i.test(style) ? [0, '1'] : null);
    const num = p.getElementsByTagNameNS(W, 'numPr')[0];
    if (hm) {
      const level = +hm[1]; if (!title && level === 1) title = text;
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const b = newBlock(text, { type: 'h' + Math.min(level, 3) }); stack[stack.length - 1].kids.push(b); stack.push({ level, kids: b.children }); list = []; return;
    }
    if (num || /List/i.test(style)) {
      const ind = +(num?.getElementsByTagNameNS(W, 'ilvl')[0]?.getAttributeNS(W, 'val') || 0);
      const b = newBlock(text); while (list.length && list[list.length - 1].ind >= ind) list.pop();
      (list.length ? list[list.length - 1].block.children : stack[stack.length - 1].kids).push(b); list.push({ ind, block: b }); return;
    }
    list = []; stack[stack.length - 1].kids.push(newBlock(text));
  };
  for (const el of body.children) {
    if (el.localName === 'p') handle(el);
    else if (el.localName === 'tbl') for (const tr of el.getElementsByTagNameNS(W, 'tr')) { const cells = [...tr.getElementsByTagNameNS(W, 'tc')].map((c) => [...c.getElementsByTagNameNS(W, 'p')].map(paraText).filter(Boolean).join(' ')); if (cells.some(Boolean)) stack[stack.length - 1].kids.push(newBlock(cells.join('  |  '))); }
  }
  return { blocks: root, title };
}

const uniqueTitle = (t) => { let title = t.trim() || 'Untitled'; let n = 2; while (findByTitle(title)) title = `${t.trim()} ${n++}`; return title; };

/** Import dropped or picked files. `into` is the note currently open, if any. Returns the created objects. */
export async function importFiles(files, { into = null } = {}) {
  const results = []; const skipped = []; let dups = 0;
  for (const file of files) {
    const kind = classify(file);
    if (!kind) { skipped.push(file.name); continue; }
    try {
      if (kind === 'pdf') { const { obj, existed } = await importPDF(file); if (existed) dups++; results.push({ obj, existed, kind }); }
      else if (kind === 'text') {
        const txt = await file.text(); const blocks = textToBlocks(txt);
        const m = /^#\s+(.+)$/m.exec(txt.replace(/^---\n[\s\S]*?\n---\n/, ''));
        const title = uniqueTitle(m ? m[1] : file.name.replace(/\.[^.]+$/, ''));
        if (m && blocks[0]?.type === 'h1' && blocks[0].text === m[1].trim()) { const first = blocks.shift(); blocks.unshift(...first.children); }
        results.push({ obj: createObject({ type: 'page', title, blocks: blocks.length ? blocks : [newBlock('')] }), kind });
      } else if (kind === 'docx') {
        const { blocks, title } = await docxToBlocks(file);
        if (title && blocks[0]?.type === 'h1' && blocks[0].text === title) { const first = blocks.shift(); blocks.unshift(...first.children); }
        results.push({ obj: createObject({ type: 'page', title: uniqueTitle(title || file.name.replace(/\.docx$/i, '')), blocks: blocks.length ? blocks : [newBlock('')] }), kind });
      } else if (kind === 'image') {
        const id = uid() + uid(); await putFile(id, file);
        const ext = (/\.(png|jpe?g|gif|webp)$/i.exec(file.name)?.[1] || file.type.split('/')[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
        const b = newBlock('', { img: id, imgExt: ext });
        if (into) { const last = into.blocks[into.blocks.length - 1]; if (last && !last.text && !last.children.length && !last.task) into.blocks.splice(into.blocks.length - 1, 0, b); else into.blocks.push(b); touch(into, true); results.push({ obj: into, kind, inline: true }); }
        else results.push({ obj: createObject({ type: 'page', title: uniqueTitle(file.name.replace(/\.[^.]+$/, '')), blocks: [b, newBlock('')] }), kind });
      }
    } catch (e) { toast(e.message || `Could not import ${file.name}`, { kind: 'warn', ms: 6000 }); }
  }
  // Link imported documents from the open note so they are findable in context.
  if (into) {
    const links = results.filter((r) => !r.inline && r.obj.id !== into.id).map((r) => `[[${r.obj.title}]]`);
    if (links.length) {
      const last = into.blocks[into.blocks.length - 1]; const nb = newBlock(links.join(' '));
      if (last && !last.text && !last.children.length && !last.task) into.blocks.splice(into.blocks.length - 1, 0, nb); else into.blocks.push(nb);
      touch(into, true);
    }
  }
  const made = results.filter((r) => !r.existed && !r.inline).length;
  const msg = [made ? `Imported ${made} file${made > 1 ? 's' : ''}` : '', dups ? `${dups} already in Folio` : '', skipped.length ? `Skipped ${skipped.length} unsupported (${skipped.slice(0, 2).join(', ')}${skipped.length > 2 ? '…' : ''})` : ''].filter(Boolean).join(' · ');
  if (msg) toast(msg, { ms: 4500 });
  return results;
}

// PDF reader: page-by-page view, text highlights, notes, area snapshots, local analysis.
import { h, uid, esc } from './util.js';
import { icon } from './icons.js';
import { S, putFile, getFile, createObject, newBlock, touch, walk } from './store.js';
import { toast } from './ui.js';

let lib = null;
async function pdfjs() {
  if (lib) return lib;
  lib = await import('../vendor/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  return lib;
}
const COLORS = { yellow: '#facc15', green: '#4ade80', blue: '#60a5fa', pink: '#f472b6' };
export const HL_COLORS = COLORS;

/** Import one PDF. Returns {obj, existed}; the same file (name and size) is not imported twice. */
export async function importPDF(file) {
  const dup = Object.values(S.objects).find((o) => o.pdf && o.pdf.name === file.name && o.pdf.size === file.size);
  if (dup) return { obj: dup, existed: true };
  const buf = await file.arrayBuffer();
  const L = await pdfjs();
  let doc;
  try { doc = await L.getDocument({ data: buf.slice(0) }).promise; } catch (e) { throw new Error(`Could not read ${file.name}: ${e.message}`); }
  let title = file.name.replace(/\.pdf$/i, '');
  let author = '';
  try { const m = await doc.getMetadata(); const mt = m.info?.Title?.trim(); if (mt && mt.length > 2 && !/^(about:|untitled|microsoft word|https?:)/i.test(mt)) title = mt; author = m.info?.Author || ''; } catch { /* no metadata */ }
  let thumb = '';
  try {
    const pg = await doc.getPage(1); const base = pg.getViewport({ scale: 1 }); const vp = pg.getViewport({ scale: 240 / base.width });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise; thumb = c.toDataURL('image/jpeg', 0.72);
  } catch { /* thumbnail is optional */ }
  const fileId = uid() + uid();
  await putFile(fileId, new Blob([buf], { type: 'application/pdf' }));
  const o = createObject({ type: 'pdf', title, props: author ? { author } : {}, blocks: [newBlock('')], extra: { pdf: { fileId, name: file.name, size: file.size, pages: doc.numPages, page: 1, thumb } } });
  doc.destroy?.();
  return { obj: o, existed: false };
}

const STOP = new Set('the of and a to in is that for it as with was on be by this are at from or an which not but have has had were their its they you we can will more also been than these such other one all into may only when about there what who how some if our out so use used using et al fig figure table page pages however thus our them then both each any between over under after before during while where would could should those his her he she i my your'.split(' '));

export class Reader {
  constructor(obj, host, { onAnnotate, flash }) {
    this.obj = obj; this.host = host; this.onAnnotate = onAnnotate; this.flash = flash;
    this.zoom = 1; this.mode = 'select'; this.token = 0; this.ac = new AbortController();
    this.page = Math.min(Math.max(1, obj.pdf.page || 1), obj.pdf.pages);
    this.build();
    window.addEventListener('folio:pdfgoto', (e) => { if (e.detail.obj === this.obj) this.goto(e.detail.page); }, { signal: this.ac.signal });
    document.addEventListener('keydown', (e) => this.onKey(e), { signal: this.ac.signal });
    this.load();
  }
  destroy() { this.ac.abort(); this.doc?.destroy?.(); }

  build() {
    this.pageInput = h('input', { class: 'pg-input', type: 'number', min: 1, max: this.obj.pdf.pages, value: this.page, onchange: () => this.goto(+this.pageInput.value) });
    this.zoomLabel = h('span', { class: 'zoom-l' }, '100%');
    const btn = (ic, title, fn, cls = '') => h('button', { class: `icon-btn small ${cls}`, title, html: icon(ic, 16), onclick: fn });
    this.selBtn = h('button', { class: 'tool on', title: 'Highlight text', html: `${icon('highlighter', 15)}<span>Highlight</span>`, onclick: () => this.setMode('select') });
    this.snapBtn = h('button', { class: 'tool', title: 'Capture an area as an image', html: `${icon('camera', 15)}<span>Snapshot</span>`, onclick: () => this.setMode('snap') });
    this.bar = h('div', { class: 'reader-bar' },
      btn('chevL', 'Previous page (←)', () => this.goto(this.page - 1)), h('span', { class: 'pg' }, this.pageInput, h('span', null, `/ ${this.obj.pdf.pages}`)), btn('chevR', 'Next page (→)', () => this.goto(this.page + 1)),
      h('span', { class: 'bar-sep' }), btn('zoomOut', 'Zoom out', () => this.setZoom(this.zoom - 0.15)), this.zoomLabel, btn('zoomIn', 'Zoom in', () => this.setZoom(this.zoom + 0.15)),
      h('span', { class: 'bar-sep' }), this.selBtn, this.snapBtn, h('span', { class: 'top-spacer' }),
      h('button', { class: 'btn small', html: `${icon('sparkle', 13)}<span>Analyze</span>`, onclick: () => this.analyze() }),
      btn('download', 'Download original PDF', () => this.download()));
    this.stage = h('div', { class: 'reader-stage' });
    this.analysisEl = h('div', { class: 'analysis' });
    this.root = h('section', { class: 'reader' }, this.bar, this.stage);
    this.host.append(this.root, this.analysisEl);
    this.renderAnalysis();
    this.stage.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.stage.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.stage.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mousedown', (e) => { if (!e.target.closest('.sel-pop')) this.hidePop(); }, { signal: this.ac.signal });
  }

  async load() {
    this.stage.append(h('div', { class: 'reader-msg' }, 'Opening PDF…'));
    try {
      const blob = await getFile(this.obj.pdf.fileId);
      if (!blob) throw new Error('The PDF file is missing from this browser. Re-import it.');
      const L = await pdfjs();
      this.doc = await L.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      this.renderPage();
    } catch (e) { this.stage.textContent = ''; this.stage.append(h('div', { class: 'reader-msg err' }, e.message)); }
  }

  setMode(m) { this.mode = m; this.selBtn.classList.toggle('on', m === 'select'); this.snapBtn.classList.toggle('on', m === 'snap'); this.stage.classList.toggle('snap', m === 'snap'); this.hidePop(); }
  setZoom(z) { this.zoom = Math.min(3, Math.max(0.5, z)); this.zoomLabel.textContent = Math.round(this.zoom * 100) + '%'; this.renderPage(); }
  goto(n, flashId) {
    n = Math.min(Math.max(1, Math.round(n) || 1), this.obj.pdf.pages);
    this.obj.pdf.page = n; touch(this.obj);
    if (n === this.page && this.pageEl) { this.drawHighlights(); return; }
    this.page = n; this.pageInput.value = n; this.renderPage();
  }
  onKey(e) {
    if (e.target.matches?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!document.body.contains(this.root)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); this.goto(this.page + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); this.goto(this.page - 1); }
  }

  async renderPage() {
    if (!this.doc) return;
    const token = ++this.token;
    const page = await this.doc.getPage(this.page);
    if (token !== this.token) return;
    const base = page.getViewport({ scale: 1 });
    const avail = Math.max(300, this.stage.clientWidth - 40);
    const scale = (avail / base.width) * this.zoom;
    const vp = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    const canvas = h('canvas', { class: 'pdf-canvas' });
    canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = vp.width + 'px'; canvas.style.height = vp.height + 'px';
    const hl = h('div', { class: 'hl-layer' });
    const tl = h('div', { class: 'textLayer' });
    tl.style.setProperty('--scale-factor', scale); tl.style.setProperty('--total-scale-factor', scale);
    const pageEl = h('div', { class: 'pdf-page', style: { width: vp.width + 'px', height: vp.height + 'px' } }, canvas, hl, tl);
    this.stage.textContent = ''; this.stage.append(pageEl);
    this.pageEl = pageEl; this.canvas = canvas; this.hlLayer = hl;
    this.drawHighlights();
    const L = await pdfjs();
    const ctx = canvas.getContext('2d');
    const render = page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
    const text = new L.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp }).render();
    try { await Promise.all([render.promise, text]); } catch (e) { if (token === this.token) console.warn(e); }
    this.obj.pdf.page = this.page; this.pageInput.value = this.page;
    this.stage.scrollTop = 0;
  }

  // ---------- annotations are blocks with a `pdf` field ----------
  annotBlocks() { const out = []; walk(this.obj.blocks, (b) => { if (b.pdf) out.push(b); }); return out; }
  drawHighlights() {
    if (!this.hlLayer) return;
    this.hlLayer.textContent = '';
    for (const b of this.annotBlocks().filter((x) => x.pdf.page === this.page)) {
      for (const r of b.pdf.rects) {
        const snap = b.pdf.color === 'snap';
        this.hlLayer.append(h('div', { class: `hl${snap ? ' snap' : ''}`, 'data-b': b.id, style: { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%', ...(snap ? {} : { background: (COLORS[b.pdf.color] || COLORS.yellow) + '66' }) } }));
      }
    }
  }
  hidePop() { this.pop?.remove(); this.pop = null; }

  selectionRects() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!this.pageEl.contains(range.commonAncestorContainer)) return null;
    const pr = this.pageEl.getBoundingClientRect();
    let rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 2).map((r) => ({ x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.height, w: r.width / pr.width, h: r.height / pr.height }));
    rects = rects.filter((a, i) => !rects.some((b, j) => j !== i && b.x <= a.x + 1e-4 && b.y <= a.y + 1e-4 && b.x + b.w >= a.x + a.w - 1e-4 && b.y + b.h >= a.y + a.h - 1e-4 && (b.w * b.h > a.w * a.h || j < i)));
    if (!rects.length) return null;
    const text = sel.toString().replace(/\s*\n\s*/g, ' ').replace(/-\s+(?=[a-z])/g, '').trim();
    return { rects, text, last: [...range.getClientRects()].pop() };
  }
  onMouseUp() {
    if (this.mode === 'snap') return this.endSnap();
    setTimeout(() => {
      const s = this.selectionRects(); this.hidePop();
      if (!s || !s.text) return;
      const pop = h('div', { class: 'sel-pop' }, Object.entries(COLORS).map(([name, c]) => h('button', { class: 'swatch', title: `Highlight ${name}`, style: { background: c }, onclick: () => this.annotate(s, name, false) })),
        h('button', { class: 'pop-note', html: `${icon('plus', 12)}<span>Note</span>`, onclick: () => this.annotate(s, 'yellow', true) }));
      document.body.append(pop); this.pop = pop;
      const lr = s.last; pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, lr.right - pop.offsetWidth / 2)) + 'px'; pop.style.top = (lr.bottom + 8) + 'px';
    }, 10);
  }
  annotate(s, color, withNote) {
    this.hidePop(); window.getSelection().removeAllRanges();
    const b = newBlock(s.text, { type: 'quote', pdf: { page: this.page, rects: s.rects, color }, children: withNote ? [newBlock('')] : [] });
    this.onAnnotate(b, withNote ? b.children[0].id : null);
    this.drawHighlights();
  }

  // ---------- snapshot (area capture) ----------
  onMouseDown(e) {
    if (this.mode !== 'snap' || !this.pageEl?.contains(e.target)) return;
    e.preventDefault();
    const pr = this.pageEl.getBoundingClientRect();
    this.snap = { x0: e.clientX - pr.left, y0: e.clientY - pr.top, pr, box: h('div', { class: 'snap-box' }) };
    this.pageEl.append(this.snap.box);
  }
  onMouseMove(e) {
    const s = this.snap; if (!s) return;
    const x = Math.min(Math.max(e.clientX - s.pr.left, 0), s.pr.width); const y = Math.min(Math.max(e.clientY - s.pr.top, 0), s.pr.height);
    Object.assign(s.box.style, { left: Math.min(s.x0, x) + 'px', top: Math.min(s.y0, y) + 'px', width: Math.abs(x - s.x0) + 'px', height: Math.abs(y - s.y0) + 'px' });
    s.x1 = x; s.y1 = y;
  }
  endSnap() {
    const s = this.snap; this.snap = null; if (!s) return;
    s.box.remove();
    const w = Math.abs((s.x1 ?? s.x0) - s.x0); const hgt = Math.abs((s.y1 ?? s.y0) - s.y0);
    if (w < 12 || hgt < 12) return;
    const r = { x: Math.min(s.x0, s.x1) / s.pr.width, y: Math.min(s.y0, s.y1) / s.pr.height, w: w / s.pr.width, h: hgt / s.pr.height };
    const k = this.canvas.width / s.pr.width;
    const out = document.createElement('canvas'); out.width = Math.round(w * k); out.height = Math.round(hgt * k);
    out.getContext('2d').drawImage(this.canvas, Math.min(s.x0, s.x1) * k, Math.min(s.y0, s.y1) * k, out.width, out.height, 0, 0, out.width, out.height);
    out.toBlob(async (blob) => {
      const id = uid() + uid(); await putFile(id, blob);
      const b = newBlock('', { img: id, pdf: { page: this.page, rects: [r], color: 'snap' } });
      this.onAnnotate(b, null); this.drawHighlights(); toast('Snapshot added to notes');
    }, 'image/png');
  }

  async download() {
    const blob = await getFile(this.obj.pdf.fileId); if (!blob) return;
    const a = h('a', { href: URL.createObjectURL(blob), download: this.obj.pdf.name || 'document.pdf' }); document.body.append(a); a.click(); a.remove();
  }

  // ---------- local analysis (no AI): stats, keywords, extractive summary ----------
  async analyze() {
    if (!this.doc) return;
    toast('Analyzing…', { ms: 1500 });
    const pages = []; const n = this.doc.numPages;
    for (let i = 1; i <= n; i++) {
      const p = await this.doc.getPage(i);
      const tc = await p.getTextContent();
      pages.push(tc.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join(' ').replace(/\s+/g, ' ').trim());
    }
    const text = pages.join(' ');
    const words = text.toLowerCase().match(/[a-zà-ÿ][a-zà-ÿ'-]{2,}/g) || [];
    const freq = new Map(); words.forEach((w) => { if (!STOP.has(w) && w.length > 3) freq.set(w, (freq.get(w) || 0) + 1); });
    const keywords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
    const sentences = [...new Set(text.split(/(?<=[.!?])\s+(?=[A-Z])/))].filter((s) => s.length > 50 && s.length < 360).slice(0, 600);
    const kw = new Map(keywords.map((w, i) => [w, 10 - i]));
    const scored = sentences.map((s, i) => ({ s, i, sc: (s.toLowerCase().match(/[a-zà-ÿ'-]+/g) || []).reduce((t, w) => t + (kw.get(w) || 0), 0) / Math.sqrt(s.length) })).sort((a, b) => b.sc - a.sc).slice(0, 3).sort((a, b) => a.i - b.i);
    this.obj.pdf.analysis = { at: Date.now(), words: words.length, pages: n, keywords, summary: scored.map((x) => x.s).join(' ') };
    touch(this.obj); this.renderAnalysis();
  }
  renderAnalysis() {
    const a = this.obj.pdf.analysis; this.analysisEl.textContent = '';
    if (!a) return;
    this.analysisEl.append(h('div', { class: 'card analysis-card' },
      h('div', { class: 'card-head', html: `${icon('sparkle', 15)}<span>Analysis</span>` }, h('span', { class: 'top-spacer' }), h('span', { class: 'muted small' }, `${a.pages} pages · ${a.words.toLocaleString()} words`)),
      a.summary ? h('p', { class: 'analysis-sum' }, a.summary) : null,
      h('div', { class: 'kw-row' }, a.keywords.map((k) => h('span', { class: 'kw' }, k))),
      h('div', { class: 'analysis-note muted small' }, 'Computed on this device from the text layer: top terms and the most representative sentences. Scanned PDFs without text will show little.'),
      h('div', { class: 'pop-actions', style: { justifyContent: 'flex-start', padding: '4px 10px 8px' } }, h('button', { class: 'btn small', onclick: () => { this.onAnnotate(newBlock(`**Summary** ${a.summary}`, { type: 'callout', children: [newBlock(a.keywords.map((k) => '#' + k.replace(/[^\w-]/g, '')).join(' '))] }), null, true); toast('Summary added to notes'); } }, 'Add to notes'))));
  }
}

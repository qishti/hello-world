import { h, esc, relDate, relDateTime, dateKey, todayKey, addDays, dailyTitle, uid } from './util.js';
import { icon } from './icons.js';
import { S, getFile, REPEATS, toggleTask as storeToggle, newBlock, locate, touch, walk, findByTitle, createObject, ensureObject, search, objectsOfType, meetingBlocks, typeOf, getObject } from './store.js';
import { renderInline } from './inline.js';
import { showMenu, closeMenu, menuOpen, caretXY, datePopover, toast } from './ui.js';
import * as hooks from './hooks.js';

const SLASH = [
  { label: 'Text', icon: 'type', sub: 'Plain bullet', act: 'type:text', k: 'text paragraph' },
  { label: 'Task', icon: 'check', sub: '⌘↵', act: 'task', k: 'task todo checkbox' },
  { label: 'Heading 1', icon: 'heading', act: 'type:h1', k: 'h1 heading title' },
  { label: 'Heading 2', icon: 'heading', act: 'type:h2', k: 'h2 heading' },
  { label: 'Heading 3', icon: 'heading', act: 'type:h3', k: 'h3 heading' },
  { label: 'Quote', icon: 'quote', act: 'type:quote', k: 'quote' },
  { label: 'Callout', icon: 'callout', act: 'type:callout', k: 'callout note info' },
  { label: 'Code', icon: 'code', act: 'type:code', k: 'code snippet' },
  { label: 'Due date', icon: 'calendar', act: 'due', k: 'due date deadline schedule' },
  { label: 'Repeat', icon: 'refresh', act: 'due', k: 'repeat recurring every daily weekly monthly' },
  { label: 'Reminder', icon: 'bell', act: 'remind', k: 'reminder remind alarm notify' },
  { label: 'Link to page', icon: 'link', act: 'link', k: 'link page object reference' },
  { label: "Today's date", icon: 'calendar', act: 'date:0', k: 'today date' },
  { label: "Tomorrow's date", icon: 'calendar', act: 'date:1', k: 'tomorrow date' },
  { label: 'Meeting note', icon: 'users', act: 'meeting', k: 'meeting note' },
  { label: 'Send to Todoist', icon: 'external', act: 'todoist', k: 'todoist send sync task' },
];

const HL = { yellow: '#facc15', green: '#4ade80', blue: '#60a5fa', pink: '#f472b6' };
let active = null; // the Outline with a live textarea

export function mountOutline(host, obj, opts = {}) {
  host.textContent = '';
  const o = new Outline(host, obj, opts);
  o.render();
  return o;
}

class Outline {
  constructor(host, obj, opts) {
    this.host = host; this.obj = obj; this.opts = opts; this.ta = null; this.editId = null; this.pop = null; this.drag = null;
    host.classList.add('outline');
    host.addEventListener('dragover', (e) => this.onDragOver(e));
    host.addEventListener('drop', (e) => this.onDrop(e));
    host.addEventListener('dragend', () => this.clearDrop());
  }

  get blocks() { return this.obj.blocks; }
  changed(struct = false) { touch(this.obj, struct); }

  render(focus) {
    const y = this.host.closest('.main')?.scrollTop;
    this.ta = null; this.editId = null;
    this.host.textContent = '';
    const lone = this.blocks.length === 1 && !this.blocks[0].text && !this.blocks[0].children.length;
    this.host.append(this.list(this.blocks, lone));
    const tail = h('div', { class: 'outline-tail', onclick: () => this.appendBlock() });
    this.host.append(tail);
    if (y != null) this.host.closest('.main').scrollTop = y;
    if (focus) this.edit(focus.id, focus.pos);
  }

  appendBlock() {
    const last = this.blocks[this.blocks.length - 1];
    if (last && !last.text && !last.children.length && !last.task) return this.edit(last.id, 0);
    const b = newBlock(''); this.blocks.push(b); this.changed(true); this.render({ id: b.id, pos: 0 });
  }

  list(blocks, lone) {
    const f = document.createDocumentFragment();
    blocks.forEach((b) => f.append(this.blockEl(b, lone)));
    return f;
  }

  blockEl(b, lone) {
    const el = h('div', { class: `blk t-${b.type || 'text'}${b.collapsed && b.children.length ? ' collapsed' : ''}${b.task ? ' is-task' : ''}${b.task?.status === 'done' ? ' done' : ''}`, 'data-id': b.id });
    const handle = h('button', { class: 'blk-handle', draggable: 'true', tabindex: '-1', title: 'Drag to move · click for options', html: icon('grip', 14),
      onclick: (e) => this.blockMenu(b, e.currentTarget), ondragstart: (e) => this.onDragStart(e, b, el) });
    const toggle = h('button', { class: `blk-toggle${b.children.length ? ' has' : ''}${b.collapsed ? ' closed' : ''}`, tabindex: '-1', html: icon('chevD', 14),
      onclick: () => { b.collapsed = !b.collapsed; this.changed(); this.render(); } });
    const marker = b.task
      ? h('button', { class: `check ${b.task.status}`, tabindex: '-1', title: 'Toggle task', onclick: () => this.toggleTask(b), html: b.task.status === 'done' ? icon('check', 12) : '' })
      : h('span', { class: 'bullet' + (b.collapsed && b.children.length ? ' folded' : '') }, h('i'));
    const body = h('div', { class: 'blk-body' });
    if (b.ref) body.append(this.embedEl(b));
    else {
      if (b.img) body.append(this.imgEl(b));
      body.append(this.view(b, lone));
    }
    if (b.pdf && b.pdf.color !== 'snap') el.style.setProperty('--hl', HL[b.pdf.color] || HL.yellow);
    const chips = b.ref ? null : this.chips(b); if (chips) body.append(chips);
    el.append(h('div', { class: 'blk-row' }, handle, toggle, marker, body));
    if (b.children.length && !b.collapsed) el.append(h('div', { class: 'blk-children' }, this.list(b.children)));
    return el;
  }

  /** A live reference to a highlight (or any block) elsewhere. Edit the source to change it everywhere. */
  embedEl(b) {
    const rec = locate(b.ref);
    if (!rec) return h('div', { class: 'embed gone' }, 'This highlight is no longer available.');
    const t = rec.block; const src = rec.obj; const st = typeOf(src);
    const note = (t.children.find((c) => c.rwNote) || t.children[0])?.text;
    const el = h('div', { class: 'embed', style: { '--hl': HL[t.color] || (t.pdf ? HL[t.pdf.color] : null) || HL.yellow } },
      h('div', { class: 'embed-text', html: renderInline(t.text) }),
      note ? h('div', { class: 'embed-note', html: renderInline(note) }) : null,
      h('a', { class: 'embed-src', style: { '--c': st.color }, html: `${icon(st.icon, 12)}<span>${esc(src.title)}</span>${t.pdf ? `<em>p. ${t.pdf.page}</em>` : t.loc ? `<em>loc. ${esc(t.loc)}</em>` : ''}`, onclick: () => { location.hash = `#/o/${src.id}?b=${t.id}`; } }));
    return el;
  }

  imgEl(b) {
    const img = h('img', { class: 'blk-img', alt: 'PDF snapshot', draggable: 'false' });
    getFile(b.img).then((f) => { if (f) img.src = URL.createObjectURL(f); }).catch(() => {});
    img.addEventListener('click', () => { if (b.pdf) window.dispatchEvent(new CustomEvent('folio:pdfgoto', { detail: { obj: this.obj, page: b.pdf.page } })); });
    return img;
  }

  view(b, lone) {
    const v = h('div', { class: `blk-view${!b.text ? ' is-empty' : ''}`, 'data-ph': lone ? 'Write something, or press / for commands' : b.img ? 'Add a caption…' : '' });
    if (b.type === 'code') v.append(h('pre', null, b.text));
    else v.innerHTML = renderInline(b.text).replace(/\n/g, '<br>');
    v.addEventListener('mousedown', (e) => {
      if (e.target.closest('a')) return;
      e.preventDefault();
      this.edit(b.id, this.posFromPoint(v, e, b));
    });
    return v;
  }

  posFromPoint(v, e, b) {
    // Map a click to a caret offset when the text is plain; fall back to end.
    try {
      const r = document.caretPositionFromPoint?.(e.clientX, e.clientY) || null;
      const node = r?.offsetNode; const off = r?.offset ?? 0;
      if (node && node.nodeType === 3 && v.contains(node) && !node.parentElement.closest('a, code, strong, em, mark, del')) {
        const pre = this.textBefore(v, node) + off;
        if (b.text.slice(0, pre).replace(/[*=~`]/g, '') === v.textContent.slice(0, pre).replace(/[*=~`]/g, '') || b.text.startsWith(v.textContent.slice(0, pre))) return Math.min(pre, b.text.length);
      }
    } catch { /* fall through */ }
    return b.text.length;
  }
  textBefore(root, node) {
    let n = 0; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) { if (w.currentNode === node) return n; n += w.currentNode.nodeValue.length; }
    return n;
  }

  chips(b) {
    const out = [];
    if (b.pdf) out.push(h('button', { class: 'chip pdfpage', tabindex: '-1', title: 'Go to page', html: `${icon('pdf', 11)}<span>p. ${b.pdf.page}</span>`, onclick: () => window.dispatchEvent(new CustomEvent('folio:pdfgoto', { detail: { obj: this.obj, page: b.pdf.page } })) }));
    if (b.hlTags?.length) b.hlTags.forEach((t) => out.push(h('span', { class: 'chip tagchip', html: `#${esc(t)}` })));
    if (!b.task) return out.length ? h('div', { class: 'chips' }, out) : null;
    const t = b.task;
    const overdue = t.due && t.status !== 'done' && t.due < todayKey();
    const mk = (cls, ic, text, mode) => h('button', { class: `chip ${cls}`, tabindex: '-1', html: `${icon(ic, 12)}<span>${esc(text)}</span>`, onclick: (e) => this.pickDate(b, mode, e.currentTarget) });
    if (t.repeat) out.push(h('span', { class: 'chip repeat', title: REPEATS[t.repeat], html: `${icon('refresh', 11)}<span>${t.repeat === 'weekdays' ? 'Weekdays' : t.repeat[0].toUpperCase() + t.repeat.slice(1)}</span>` }));
    if (t.due) out.push(mk(`due${overdue ? ' overdue' : ''}${t.due === todayKey() ? ' today' : ''}`, 'calendar', relDate(t.due), 'due'));
    if (t.remind) out.push(mk(`remind${new Date(t.remind) < new Date() && t.status !== 'done' ? ' overdue' : ''}`, 'bell', relDateTime(t.remind), 'remind'));
    if (t.todoistId) out.push(h('span', { class: 'chip todoist', title: 'Synced with Todoist', html: `${icon('external', 11)}<span>Todoist</span>` }));
    return out.length ? h('div', { class: 'chips' }, out) : null;
  }

  pickDate(b, mode, anchor) {
    datePopover({ anchor, mode, due: b.task?.due, remind: b.task?.remind, repeat: b.task?.repeat, onChange: (v) => {
      b.task ||= { status: 'todo' };
      Object.assign(b.task, v);
      if (v.remind) { b.task.notified = false; hooks.askNotify(); }
      if ('due' in v) hooks.todoistUpdateDue(b);
      this.changed(); this.render(this.editId ? { id: this.editId, pos: this.ta?.selectionStart ?? 0 } : undefined);
    } });
  }

  toggleTask(b) {
    if (!b.task) return;
    storeToggle(b, this.obj, (x) => hooks.todoistToggle(x));
    this.render();
  }

  // ---------- editing ----------
  edit(id, pos) {
    if (this.ta) this.leave();
    const rec = locate(id); if (!rec) return;
    const b = rec.block;
    const row = this.host.querySelector(`[data-id="${id}"] > .blk-row`);
    const view = row?.querySelector('.blk-view'); if (!view) return;
    const ta = h('textarea', { class: `blk-edit t-${b.type}`, rows: '1', spellcheck: 'true' });
    ta.value = b.text;
    view.replaceWith(ta);
    this.ta = ta; this.editId = id; active = this;
    const size = () => { ta.style.height = '0'; ta.style.height = ta.scrollHeight + 'px'; };
    this.size = size;
    ta.addEventListener('input', (e) => this.onInput(e, b));
    ta.addEventListener('keydown', (e) => this.onKey(e, b));
    ta.addEventListener('paste', (e) => this.onPaste(e, b));
    ta.addEventListener('blur', () => setTimeout(() => { if (this.ta === ta && !menuOpen()) this.leave(); }, 0));
    row.parentElement.classList.add('editing');
    ta.focus(); size();
    const p = pos == null ? ta.value.length : Math.min(pos, ta.value.length);
    ta.setSelectionRange(p, p);
  }

  leave() {
    const ta = this.ta; if (!ta) return;
    const id = this.editId; this.ta = null; this.editId = null;
    const rec = locate(id); const el = this.host.querySelector(`[data-id="${id}"]`);
    if (rec) {
      rec.block.text = ta.value;
      if (el) { el.classList.remove('editing'); const nv = this.view(rec.block, false); const row = el.querySelector(':scope > .blk-row'); if (ta.isConnected) ta.replaceWith(nv); else row?.querySelector('.blk-body')?.prepend(nv); }
      this.changed();
    }
    closeMenu();
  }

  onInput(e, b) {
    const ta = this.ta; let v = ta.value; this.size();
    // pair [[ ]]
    if (e.inputType === 'insertText' && e.data === '[') {
      const p = ta.selectionStart;
      if (v.slice(p - 2, p) === '[[' && v.slice(p, p + 2) !== ']]') { ta.setRangeText(']]', p, p, 'start'); v = ta.value; }
    }
    // markdown shortcuts at block start
    let m;
    if ((m = /^(#{1,3}) /.exec(v)) && b.type === 'text') { b.type = 'h' + m[1].length; return this.retype(b, v.slice(m[0].length)); }
    if ((m = /^(?:- )?\[ ?\] /.exec(v)) && !b.task) { b.task = { status: 'todo' }; return this.retype(b, v.slice(m[0].length)); }
    if (/^> /.test(v) && b.type === 'text') { b.type = 'quote'; return this.retype(b, v.slice(2)); }
    if (/^```/.test(v) && b.type === 'text') { b.type = 'code'; return this.retype(b, v.replace(/^```\w*\n?/, '')); }
    b.text = v; this.changed();
    this.triggers();
  }

  retype(b, text) { b.text = text; this.changed(); this.render({ id: b.id, pos: text.length }); }

  triggers() {
    const ta = this.ta; const before = ta.value.slice(0, ta.selectionStart);
    let m;
    if ((m = /\[\[([^\[\]\n]*)$/.exec(before))) return this.openLink(m[1], ta.selectionStart - m[1].length);
    if ((m = /(?:^|\s)#([\w-]*)$/.exec(before))) return this.openTag(m[1], ta.selectionStart - m[1].length - 1);
    if ((m = /(?:^|\s)\/([\w ]{0,14})$/.exec(before)) && this.slashItems(m[1]).length) return this.openSlash(m[1], ta.selectionStart - m[1].length - 1);
    closeMenu(); this.pop = null;
  }

  show(items, onPick, start, kind) {
    this.popKind = kind;
    const { x, y } = caretXY(this.ta);
    if (this.pop && menuOpen()) { this.pop.update(items); return; }
    this.pop = showMenu({ x, y, items, onPick, width: 300 });
  }

  openLink(q, start) {
    const lower = q.trim().toLowerCase();
    let items = [];
    const words = { today: 0, tomorrow: 1, yesterday: -1 };
    if (lower in words) { const k = addDays(todayKey(), words[lower]); items.push({ label: dailyTitle(k), sub: relDate(k), icon: 'calendar', color: S.types.daily.color, value: dailyTitle(k), date: true }); }
    const res = search(q, 7).objects.filter((o) => o.type !== 'daily' || /\d/.test(q));
    items.push(...res.map((o) => ({ label: o.title, sub: typeOf(o).name, icon: typeOf(o).icon, color: typeOf(o).color, value: o.title })));
    if (q.trim() && !res.some((o) => o.title.toLowerCase() === lower)) {
      if (items.length) items.push({ sep: true });
      items.push({ label: `New page “${q.trim()}”`, icon: 'plus', value: q.trim(), create: 'page' });
      ['person', 'meeting', 'source', 'project', 'idea'].filter((t) => S.types[t]).forEach((id) => { const t = S.types[id]; items.push({ label: `New ${t.name.toLowerCase()} “${q.trim()}”`, icon: t.icon, color: t.color, value: q.trim(), create: id }); });
    }
    this.show(items, (it) => {
      if (it.create) createObject({ type: it.create, title: it.value, blocks: it.create === 'meeting' ? meetingBlocks() : undefined });
      this.insertAt(start - 2, '[[' + it.value + ']] ', /\]\]/);
    }, start, 'link');
  }

  openTag(q, start) {
    const tags = objectsOfType('tag').filter((t) => t.title.toLowerCase().includes(q.toLowerCase())).slice(0, 7);
    const items = tags.map((t) => ({ label: '#' + t.title, icon: 'hash', color: S.types.tag.color, value: t.title }));
    if (q && !tags.some((t) => t.title.toLowerCase() === q.toLowerCase())) items.push({ label: `Create #${q}`, icon: 'plus', value: q, create: true });
    if (!items.length) { closeMenu(); this.pop = null; return; }
    this.show(items, (it) => {
      if (it.create) ensureObject(it.value, 'tag');
      this.insertAt(start, '#' + it.value + ' ');
    }, start, 'tag');
  }

  slashItems(q) { q = q.trim().toLowerCase(); return SLASH.filter((s) => !q || (s.label + ' ' + s.k).toLowerCase().includes(q)); }
  openSlash(q, start) {
    this.slashStart = start;
    this.show(this.slashItems(q).map((s) => ({ label: s.label, sub: s.sub, icon: s.icon, value: s.act })), (it) => this.runSlash(it.value, start), start, 'slash');
  }

  /** Replace text from `start` through the caret (and any trailing `]]`) with `text`. */
  insertAt(start, text, eat) {
    const ta = this.ta; const v = ta.value; let end = ta.selectionStart;
    if (eat && v.slice(end, end + 2) === ']]') end += 2;
    ta.value = v.slice(0, start) + text + v.slice(end);
    const p = start + text.length; ta.setSelectionRange(p, p);
    const rec = locate(this.editId); if (rec) rec.block.text = ta.value;
    this.size(); this.changed(); this.pop = null; ta.focus();
  }

  runSlash(act, start) {
    const ta = this.ta; const rec = locate(this.editId); if (!rec) return;
    const b = rec.block;
    ta.value = ta.value.slice(0, start) + ta.value.slice(ta.selectionStart); b.text = ta.value;
    ta.setSelectionRange(start, start);
    const [a, arg] = act.split(':');
    const after = (fn) => { b.text = ta.value; fn(); };
    switch (a) {
      case 'type': return after(() => { b.type = arg; this.changed(); this.render({ id: b.id, pos: b.text.length }); });
      case 'task': return after(() => { b.task = b.task || { status: 'todo' }; this.changed(); this.render({ id: b.id, pos: b.text.length }); });
      case 'due': return after(() => { b.task ||= { status: 'todo' }; this.changed(); this.render({ id: b.id, pos: b.text.length }); setTimeout(() => this.pickDate(b, 'due', this.host.querySelector(`[data-id="${b.id}"] .chip, [data-id="${b.id}"] .blk-edit`) || this.host), 30); });
      case 'remind': return after(() => { b.task ||= { status: 'todo' }; this.changed(); this.render({ id: b.id, pos: b.text.length }); setTimeout(() => this.pickDate(b, 'remind', this.host.querySelector(`[data-id="${b.id}"] .blk-edit`) || this.host), 30); });
      case 'link': ta.setRangeText('[[]]', start, start, 'end'); ta.setSelectionRange(start + 2, start + 2); return this.onInput({ inputType: 'x' }, b) || this.triggers();
      case 'date': { const k = addDays(todayKey(), Number(arg)); return this.insertAt(start, `[[${dailyTitle(k)}]] `); }
      case 'meeting': {
        const m = createObject({ type: 'meeting', title: b.text.trim() || 'Untitled meeting', blocks: meetingBlocks(), props: { date: todayKey() } });
        return this.insertAt(start, `[[${m.title}]] `);
      }
      case 'todoist': return after(() => { b.task ||= { status: 'todo' }; this.changed(); this.render({ id: b.id, pos: b.text.length }); hooks.todoistSend(b); });
    }
  }

  // ---------- keyboard ----------
  onKey(e, b) {
    const ta = this.ta; const mod = e.metaKey || e.ctrlKey;
    if (menuOpen() && this.pop) {
      if (e.key === 'ArrowDown') { e.preventDefault(); return this.pop.move(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); return this.pop.move(-1); }
      if (e.key === 'Enter' || e.key === 'Tab') {
        // A lone “Create #tag” suggestion should not hijack Enter: let it add a new bullet.
        if (this.popKind === 'tag' && this.pop.items.every((i) => i.create) && e.key === 'Enter') { closeMenu(); this.pop = null; }
        else if (this.pop.items.length) { e.preventDefault(); return this.pop.pick(); }
      }
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); this.pop = null; return; }
    }
    const pos = ta.selectionStart; const end = ta.selectionEnd; const collapsed = pos === end;
    if (e.key === ']' && collapsed && ta.value[pos] === ']' && !mod) { e.preventDefault(); ta.setSelectionRange(pos + 1, pos + 1); closeMenu(); this.pop = null; return; }
    if (mod && e.key === 'Enter') { e.preventDefault(); return this.cycleTask(b); }
    if (mod && (e.key === 'b' || e.key === 'i')) { e.preventDefault(); return this.wrap(e.key === 'b' ? '**' : '*'); }
    if (mod && e.key === 'k') { e.preventDefault(); return this.wrapLink(); }
    if (mod && e.key === 'ArrowUp') { e.preventDefault(); if (b.children.length) { b.collapsed = true; this.changed(); this.render({ id: b.id, pos }); } return; }
    if (mod && e.key === 'ArrowDown') { e.preventDefault(); if (b.children.length) { b.collapsed = false; this.changed(); this.render({ id: b.id, pos }); } return; }
    if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); return this.moveSibling(b, -1, pos); }
    if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); return this.moveSibling(b, 1, pos); }
    if (e.key === 'Tab') { e.preventDefault(); return e.shiftKey ? this.outdent(b, pos) : this.indent(b, pos); }
    if (e.key === 'Escape') { e.preventDefault(); this.leave(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      if (b.type === 'code') return; // newline inside code
      e.preventDefault(); return this.enter(b, pos, end);
    }
    if (e.key === 'Backspace' && collapsed && pos === 0) { e.preventDefault(); return this.backspace(b); }
    if (e.key === 'Delete' && collapsed && pos === ta.value.length) { e.preventDefault(); return this.mergeNext(b); }
    if (e.key === 'ArrowUp' && !e.shiftKey && collapsed) { const c = caretXY(ta); if (c.line <= 0) { e.preventDefault(); return this.nav(b, -1); } }
    if (e.key === 'ArrowDown' && !e.shiftKey && collapsed) { const c = caretXY(ta); if (c.line >= c.lines - 1) { e.preventDefault(); return this.nav(b, 1); } }
    if (e.key === 'ArrowLeft' && collapsed && pos === 0 && !e.shiftKey && !mod) { e.preventDefault(); return this.nav(b, -1, true); }
    if (e.key === 'ArrowRight' && collapsed && pos === ta.value.length && !e.shiftKey && !mod) { e.preventDefault(); return this.nav(b, 1, false, true); }
  }

  visible() {
    const out = []; const rec = (arr) => arr.forEach((b) => { out.push(b); if (!b.collapsed) rec(b.children); }); rec(this.blocks); return out;
  }
  nav(b, d, toEnd, toStart) {
    const v = this.visible().filter((x) => !x.ref); const i = v.indexOf(b); const n = v[i + d]; if (!n) return;
    this.edit(n.id, toStart ? 0 : (toEnd || d < 0) ? n.text.length : Math.min(this.ta.selectionStart, n.text.length));
  }

  cycleTask(b) {
    b.text = this.ta.value;
    if (!b.task) b.task = { status: 'todo' };
    else if (b.task.status === 'todo') { storeToggle(b, this.obj, (x) => hooks.todoistToggle(x)); }
    else { b.task = null; }
    this.changed(); this.render({ id: b.id, pos: this.ta.selectionStart });
  }
  wrap(mark) {
    const ta = this.ta; const s = ta.selectionStart; const e = ta.selectionEnd;
    ta.setRangeText(mark + ta.value.slice(s, e) + mark, s, e, 'end');
    if (s === e) ta.setSelectionRange(s + mark.length, s + mark.length);
    locate(this.editId).block.text = ta.value; this.size(); this.changed();
  }
  wrapLink() {
    const ta = this.ta; const s = ta.selectionStart; const e = ta.selectionEnd;
    if (s === e) { ta.setRangeText('[[]]', s, e, 'end'); ta.setSelectionRange(s + 2, s + 2); this.triggers(); return; }
    const t = ta.value.slice(s, e); ensureObject(t);
    ta.setRangeText(`[[${t}]]`, s, e, 'end'); locate(this.editId).block.text = ta.value; this.changed(true);
  }

  enter(b, pos, end) {
    const v = this.ta.value; b.text = v;
    const rec = locate(b.id);
    if (!v && rec) {
      if (b.task) { b.task = null; this.changed(); return this.render({ id: b.id, pos: 0 }); }
      if (b.type !== 'text') { b.type = 'text'; this.changed(); return this.render({ id: b.id, pos: 0 }); }
      if (rec.parent) return this.outdent(b, 0);
    }
    const before = v.slice(0, pos); const after = v.slice(end);
    b.text = before;
    const nb = newBlock(after);
    if (b.task && before) nb.task = { status: 'todo' };
    if (b.type === 'quote' && before) nb.type = 'quote';
    if (b.children.length && !b.collapsed) b.children.unshift(nb); else rec.arr.splice(rec.i + 1, 0, nb);
    this.changed(true); this.render({ id: nb.id, pos: 0 });
  }

  backspace(b) {
    if (b.task) { b.task = null; this.changed(); return this.render({ id: b.id, pos: 0 }); }
    if (b.type !== 'text') { b.type = 'text'; this.changed(); return this.render({ id: b.id, pos: 0 }); }
    const v = this.visible(); const i = v.indexOf(b); const prev = v[i - 1];
    b.text = this.ta.value;
    if (!prev || prev.ref) return;
    const at = prev.text.length;
    prev.text += b.text;
    const rec = locate(b.id); rec.arr.splice(rec.i, 1);
    if (b.children.length) prev.children.push(...b.children);
    this.changed(true); this.render({ id: prev.id, pos: at });
  }
  mergeNext(b) {
    const v = this.visible(); const nx = v[v.indexOf(b) + 1]; b.text = this.ta.value;
    if (!nx || nx.ref) return;
    const at = b.text.length; b.text += nx.text;
    const rec = locate(nx.id); rec.arr.splice(rec.i, 1);
    if (nx.children.length) b.children.push(...nx.children);
    this.changed(true); this.render({ id: b.id, pos: at });
  }

  indent(b, pos) {
    b.text = this.ta.value; const rec = locate(b.id);
    if (rec.i === 0) return;
    const prev = rec.arr[rec.i - 1];
    rec.arr.splice(rec.i, 1); prev.children.push(b); prev.collapsed = false;
    this.changed(true); this.render({ id: b.id, pos });
  }
  outdent(b, pos) {
    b.text = this.ta.value; const rec = locate(b.id);
    if (!rec.parent) return;
    const pr = locate(rec.parent.id);
    rec.arr.splice(rec.i, 1); pr.arr.splice(pr.i + 1, 0, b);
    this.changed(true); this.render({ id: b.id, pos });
  }
  moveSibling(b, d, pos) {
    b.text = this.ta.value; const rec = locate(b.id); const j = rec.i + d;
    if (j < 0 || j >= rec.arr.length) return;
    rec.arr.splice(rec.i, 1); rec.arr.splice(j, 0, b);
    this.changed(true); this.render({ id: b.id, pos });
  }

  onPaste(e, b) {
    const text = e.clipboardData?.getData('text/plain'); if (!text) return;
    const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
    if (/^https?:\/\/\S+$/.test(text.trim())) return; // plain URL: default paste
    if (lines.length < 2) return;
    e.preventDefault();
    const parsed = lines.map((l) => {
      const ind = /^[ \t]*/.exec(l)[0].replace(/\t/g, '  ').length;
      let t = l.trim(); let type = 'text'; let task = null;
      t = t.replace(/^(?:[-*•]|\d+[.)])\s+/, '');
      let m;
      if ((m = /^\[( |x|X)\]\s+/.exec(t))) { task = { status: m[1] === ' ' ? 'todo' : 'done' }; t = t.slice(m[0].length); }
      if ((m = /^(#{1,3})\s+/.exec(t))) { type = 'h' + m[1].length; t = t.slice(m[0].length); }
      else if (/^>\s+/.test(t)) { type = 'quote'; t = t.replace(/^>\s+/, ''); }
      return { ind: Math.floor(ind / 2), block: newBlock(t, { type, ...(task ? { task } : {}) }) };
    });
    const ta = this.ta; const cur = locate(this.editId);
    const first = parsed.shift(); const v = ta.value;
    b.text = v.slice(0, ta.selectionStart) + first.block.text + v.slice(ta.selectionEnd);
    if (first.block.task) b.task = b.task || first.block.task;
    // Build a tree from indent levels: deeper lines nest under the pasted first line (the current block).
    const base = []; let lastBlock = b;
    const stack = [{ ind: -1, kids: base }, { ind: first.ind, kids: b.children }];
    for (const p of parsed) {
      if (p.ind <= first.ind) stack.length = 1; // same level as the pasted first line: becomes its sibling
      else while (stack.length > 2 && p.ind <= stack[stack.length - 1].ind) stack.pop();
      stack[stack.length - 1].kids.push(p.block); lastBlock = p.block;
      stack.push({ ind: p.ind, kids: p.block.children });
    }
    b.collapsed = false;
    cur.arr.splice(cur.i + 1, 0, ...base);
    this.changed(true);
    this.render({ id: lastBlock.id, pos: lastBlock.text.length });
  }

  // ---------- block menu ----------
  blockMenu(b, anchor) {
    const items = [
      { label: 'Text', icon: 'type', value: 'type:text' }, { label: 'Heading', icon: 'heading', value: 'type:h2' }, { label: 'Quote', icon: 'quote', value: 'type:quote' }, { label: 'Callout', icon: 'callout', value: 'type:callout' }, { label: 'Code', icon: 'code', value: 'type:code' },
      { sep: true },
      { label: b.task ? 'Remove task' : 'Make task', icon: 'check', value: 'task' },
      { label: 'Due date…', icon: 'calendar', value: 'due' }, { label: 'Reminder…', icon: 'bell', value: 'remind' },
      ...(b.task && !b.task.todoistId ? [{ label: 'Send to Todoist', icon: 'external', value: 'todoist' }] : []),
      { sep: true },
      { label: 'Duplicate', icon: 'copy', value: 'dup' }, { label: 'Delete', icon: 'trash', value: 'del', danger: true },
    ];
    showMenu({ anchor, items, keepFocus: false, onPick: (it) => {
      const v = it.value;
      if (v.startsWith('type:')) { b.type = v.slice(5); this.changed(); this.render(); }
      else if (v === 'task') { b.task = b.task ? null : { status: 'todo' }; this.changed(); this.render(); }
      else if (v === 'due' || v === 'remind') { b.task ||= { status: 'todo' }; this.changed(); this.render(); setTimeout(() => this.pickDate(b, v, this.host.querySelector(`[data-id="${b.id}"] .blk-view`) || anchor), 30); }
      else if (v === 'todoist') { hooks.todoistSend(b); }
      else if (v === 'dup') { const rec = locate(b.id); const copy = structuredClone(b); walk([copy], (x) => { x.id = uid(); }); rec.arr.splice(rec.i + 1, 0, copy); this.changed(true); this.render(); }
      else if (v === 'del') { const rec = locate(b.id); rec.arr.splice(rec.i, 1); if (!this.blocks.length) this.blocks.push(newBlock('')); this.changed(true); this.render(); toast('Block deleted'); }
    } });
  }

  // ---------- drag & drop ----------
  onDragStart(e, b, el) {
    this.drag = b; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.text);
    e.dataTransfer.setDragImage(el.querySelector('.blk-row'), 0, 10);
    setTimeout(() => el.classList.add('dragging'), 0);
  }
  isExt(e) { return [...(e.dataTransfer?.types || [])].includes('application/x-folio-ref'); }
  dropInfo(e) {
    const ext = this.isExt(e);
    const tail = e.target.closest?.('.outline-tail');
    if (ext && tail) return { el: tail, id: null, where: 'tail', ext };
    const row = e.target.closest?.('.blk-row'); if (!row || (!this.drag && !ext)) return null;
    const el = row.parentElement; const id = el.dataset.id;
    if (!ext) {
      if (id === this.drag.id) return null;
      let inside = false; walk(this.drag.children, (x) => { if (x.id === id) inside = true; });
      if (inside) return null;
    }
    const r = row.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height;
    return { el, id, ext, where: y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'child' };
  }
  onDragOver(e) {
    const d = this.dropInfo(e); this.clearDrop();
    if (!d) return;
    e.preventDefault(); d.el.classList.add('drop-' + (d.where === 'tail' ? 'after' : d.where));
  }
  clearDrop() { this.host.querySelectorAll('.drop-before, .drop-after, .drop-child, .dragging').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-child', 'dragging')); }
  onDrop(e) {
    const d = this.dropInfo(e); this.clearDrop(); if (!d) return;
    e.preventDefault();
    if (d.ext) {
      const nb = newBlock('', { ref: e.dataTransfer.getData('application/x-folio-ref') });
      if (d.where === 'tail') this.blocks.push(nb);
      else { const t = locate(d.id); if (d.where === 'child') { t.block.children.push(nb); t.block.collapsed = false; } else t.arr.splice(t.i + (d.where === 'after' ? 1 : 0), 0, nb); }
      this.changed(true); this.render(); return;
    }
    const b = this.drag; this.drag = null;
    const src = locate(b.id); src.arr.splice(src.i, 1);
    const t = locate(d.id);
    if (d.where === 'child') { t.block.children.push(b); t.block.collapsed = false; }
    else t.arr.splice(t.i + (d.where === 'after' ? 1 : 0), 0, b);
    this.changed(true); this.render();
  }
}

export function currentOutline() { return active; }

import { h, esc } from './util.js';
import { icon } from './icons.js';

// ---------- floating menu (autocomplete / context menus) ----------
let current = null;
export function closeMenu() { if (current) { current.el.remove(); document.removeEventListener('mousedown', current.away, true); current = null; } }
export const menuOpen = () => !!current;

/** items: [{label, sub?, icon?, color?, value, danger?, sep?}] */
export function showMenu({ x, y, items, onPick, anchor, header, width, keepFocus = true }) {
  closeMenu();
  let active = 0;
  const el = h('div', { class: 'menu', style: width ? { width: width + 'px' } : {} });
  el.addEventListener('mousedown', (e) => { if (keepFocus) e.preventDefault(); });
  const away = (e) => { if (!el.contains(e.target)) closeMenu(); };
  document.addEventListener('mousedown', away, true);
  const ctl = {
    el, away,
    get items() { return items; },
    update(next) { items = next; active = 0; paint(); },
    move(d) {
      const sel = items.filter((i) => !i.sep && !i.head);
      if (!sel.length) return;
      do { active = (active + d + items.length) % items.length; } while (items[active].sep || items[active].head);
      paint();
    },
    pick() { const it = items[active]; if (it && !it.sep && !it.head) { closeMenu(); onPick(it); return true; } return false; },
  };
  const headEl = header ? h('div', { class: 'menu-search' }, header) : null;
  const listEl = h('div', { class: 'menu-list' });
  el.append(...(headEl ? [headEl, listEl] : [listEl]));
  function paint() {
    listEl.textContent = '';
    if (!items.length) { listEl.append(h('div', { class: 'menu-empty' }, 'No results')); }
    items.forEach((it, i) => {
      if (it.sep) return listEl.append(h('div', { class: 'menu-sep' }));
      if (it.head) return listEl.append(h('div', { class: 'menu-head' }, it.head));
      const row = h('div', { class: `menu-item${i === active ? ' active' : ''}${it.danger ? ' danger' : ''}`, onmouseenter: () => { active = i; listEl.querySelectorAll('.menu-item').forEach((r) => r.classList.toggle('active', r === row)); }, onclick: () => { closeMenu(); onPick(it); } },
        it.icon ? h('span', { class: 'menu-ic', style: it.color ? { '--c': it.color } : {}, html: icon(it.icon, 15) }) : null,
        h('span', { class: 'menu-label' }, it.label),
        it.sub ? h('span', { class: 'menu-sub' }, it.sub) : null,
        it.check ? h('span', { class: 'menu-check' }, '✓') : null);
      listEl.append(row);
    });
    el.querySelector('.menu-item.active')?.scrollIntoView({ block: 'nearest' });
  }
  if (items[0]?.sep || items[0]?.head) active = items.findIndex((i) => !i.sep && !i.head);
  document.body.append(el);
  paint();
  place(el, x, y, anchor);
  current = ctl;
  return ctl;
}
function place(el, x, y, anchor) {
  if (anchor) { const r = anchor.getBoundingClientRect(); x = r.left; y = r.bottom + 6; }
  const r = el.getBoundingClientRect();
  const W = innerWidth; const H = innerHeight;
  if (x + r.width > W - 8) x = W - r.width - 8;
  if (y + r.height > H - 8) y = Math.max(8, (anchor ? anchor.getBoundingClientRect().top : y) - r.height - 8);
  el.style.left = Math.max(8, x) + 'px'; el.style.top = y + 'px';
}

/** Free-form popover anchored under an element; closes on outside click or Escape. */
export function popover(anchor, content, { width } = {}) {
  closeMenu();
  const el = h('div', { class: 'menu popover free', style: width ? { width: width + 'px' } : {} }, content);
  document.body.append(el);
  const away = (e) => { if (!el.contains(e.target) && !e.target.closest('.menu')) closeMenu(); };
  document.addEventListener('mousedown', away, true);
  const key = (e) => { if (e.key === 'Escape') closeMenu(); };
  document.addEventListener('keydown', key);
  current = { el, away: (e) => away(e), items: [], update() {}, move() {}, pick: () => false };
  const orig = current.el.remove.bind(current.el); current.el.remove = () => { document.removeEventListener('keydown', key); orig(); };
  place(el, 0, 0, anchor);
  return el;
}

// ---------- caret position inside a textarea ----------
export function caretXY(ta, pos = ta.selectionStart) {
  const cs = getComputedStyle(ta);
  const m = h('div'); const props = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'padding', 'border', 'boxSizing', 'textIndent'];
  props.forEach((p) => { m.style[p] = cs[p]; });
  Object.assign(m.style, { position: 'fixed', visibility: 'hidden', whiteSpace: 'pre-wrap', wordWrap: 'break-word', width: ta.clientWidth + 'px', top: '0', left: '-9999px' });
  m.textContent = ta.value.slice(0, pos);
  const s = h('span', null, '​'); m.append(s); document.body.append(m);
  const mr = m.getBoundingClientRect(); const sr = s.getBoundingClientRect(); const tr = ta.getBoundingClientRect();
  const lh = parseFloat(cs.lineHeight) || 24;
  const res = { x: tr.left + (sr.left - mr.left), y: tr.top + (sr.top - mr.top) + lh, line: Math.round((sr.top - mr.top) / lh), lines: 0 };
  m.textContent = ta.value; res.lines = Math.round(m.getBoundingClientRect().height / lh);
  m.remove();
  return res;
}

// ---------- toasts ----------
let toastHost;
export function toast(msg, { actions = [], ms = 3800, kind = '' } = {}) {
  toastHost ||= document.body.appendChild(h('div', { class: 'toasts' }));
  const el = h('div', { class: `toast ${kind}` }, h('span', { class: 'toast-msg' }, msg),
    actions.map((a) => h('button', { class: 'toast-act', onclick: () => { a.fn(); el.remove(); } }, a.label)));
  toastHost.append(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}

// ---------- modal ----------
export function modal(content, { title, wide } = {}) {
  const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(); } });
  const box = h('div', { class: `modal${wide ? ' wide' : ''}` }, title ? h('div', { class: 'modal-title' }, title) : null, content);
  back.append(box); document.body.append(back);
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  function close() { back.remove(); document.removeEventListener('keydown', key); }
  return { close, box };
}
export function confirmBox(msg, ok = 'Delete') {
  return new Promise((res) => {
    const m = modal(h('div', null, h('p', { class: 'modal-p' }, msg), h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', onclick: () => { m.close(); res(false); } }, 'Cancel'),
      h('button', { class: 'btn danger', onclick: () => { m.close(); res(true); } }, ok))));
  });
}
export function promptBox(title, value = '', ok = 'Save') {
  return new Promise((res) => {
    const inp = h('input', { class: 'input', value, onkeydown: (e) => { if (e.key === 'Enter') { m.close(); res(inp.value); } } });
    const m = modal(h('div', null, inp, h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', onclick: () => { m.close(); res(null); } }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => { m.close(); res(inp.value); } }, ok))), { title });
    setTimeout(() => inp.focus(), 20);
  });
}

// ---------- date / reminder popover ----------
import { addDays, todayKey, dateKey, parseKey, pad } from './util.js';
export function datePopover({ anchor, due, remind, repeat, mode = 'due', onChange }) {
  const t = todayKey();
  const nextMon = (() => { const d = parseKey(t); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return dateKey(d); })();
  const dueIn = h('input', { type: 'date', class: 'input', value: due || '' });
  const timeIn = h('input', { type: 'time', class: 'input', value: remind ? `${pad(new Date(remind).getHours())}:${pad(new Date(remind).getMinutes())}` : '09:00' });
  const remDateIn = h('input', { type: 'date', class: 'input', value: remind ? dateKey(new Date(remind)) : (due || t) });
  const el = h('div', { class: 'menu popover' });
  const repSel = h('select', { class: 'input rep' }, h('option', { value: '' }, 'Does not repeat'),
    [['daily', 'Every day'], ['weekdays', 'Every weekday'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']].map(([v, l]) => h('option', { value: v, selected: v === repeat }, l)));
  const done = (v) => { closeMenu(); onChange(v); };
  const q = (label, fn) => h('button', { class: 'pill-btn', onclick: fn }, label);
  if (mode === 'due') {
    const D = (v) => done({ ...v, repeat: repSel.value || null });
    el.append(h('div', { class: 'menu-head' }, 'Due date'),
      h('div', { class: 'pill-row' }, q('Today', () => D({ due: t })), q('Tomorrow', () => D({ due: addDays(t, 1) })), q('Next Mon', () => D({ due: nextMon })), q('+1 week', () => D({ due: addDays(t, 7) }))),
      dueIn, repSel, h('div', { class: 'pop-actions' }, h('button', { class: 'btn small', onclick: () => done({ due: null, repeat: null }) }, 'Clear'), h('button', { class: 'btn small primary', onclick: () => D({ due: dueIn.value || (repSel.value ? t : null) }) }, 'Set')));
  } else {
    const inH = (hrs) => { const d = new Date(Date.now() + hrs * 36e5); d.setSeconds(0, 0); return d.toISOString(); };
    const at = (k, hh) => { const d = parseKey(k); d.setHours(hh, 0, 0, 0); return d.toISOString(); };
    el.append(h('div', { class: 'menu-head' }, 'Remind me'),
      h('div', { class: 'pill-row' }, q('In 1 hour', () => done({ remind: inH(1) })), q('This evening', () => done({ remind: at(t, 18) })), q('Tomorrow 9am', () => done({ remind: at(addDays(t, 1), 9) })), q('Next Mon 9am', () => done({ remind: at(nextMon, 9) }))),
      h('div', { class: 'pop-grid' }, remDateIn, timeIn),
      h('div', { class: 'pop-actions' }, h('button', { class: 'btn small', onclick: () => done({ remind: null }) }, 'Clear'),
        h('button', { class: 'btn small primary', onclick: () => { const [hh, mm] = (timeIn.value || '09:00').split(':').map(Number); const d = parseKey(remDateIn.value || t); d.setHours(hh, mm, 0, 0); done({ remind: d.toISOString() }); } }, 'Set')));
  }
  closeMenu();
  document.body.append(el);
  const away = (e) => { if (!el.contains(e.target)) closeMenu(); };
  document.addEventListener('mousedown', away, true);
  current = { el, away, items: [], update() {}, move() {}, pick: () => false };
  place(el, 0, 0, anchor);
  return el;
}
export { esc };

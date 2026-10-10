import { esc } from './util.js';
import { findByTitle, typeOf, S } from './store.js';
import { icon } from './icons.js';

const RE = /(`[^`\n]+`)|(\[\[[^\[\]\n]+\]\])|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))|(https?:\/\/[^\s<>)\]]+)|(\*\*[^*\n]+\*\*)|(==[^=\n]+==)|(~~[^~\n]+~~)|(\*[^*\s][^*\n]*\*)|((?<![\w&/#])#[A-Za-z0-9][\w-]*)/g;

export function chip(title, extraCls = '') {
  const o = findByTitleQuiet(title);
  const t = o ? typeOf(o) : S.types.page;
  const color = o ? t.color : 'var(--faint)';
  return `<a class="wl ${o ? '' : 'missing'} ${extraCls}" data-title="${esc(title)}" ${o ? `data-id="${o.id}"` : ''} style="--c:${color}">${icon(t.icon, 12)}<span>${esc(title)}</span></a>`;
}
// Avoid creating daily notes just by rendering a date link.
function findByTitleQuiet(title) {
  return S.objects && Object.values(S.objects).length ? findByTitle(title) : null;
}

export function renderInline(text) {
  if (!text) return '';
  let out = ''; let last = 0; const re = new RegExp(RE.source, 'g'); let m;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    const s = m[0];
    if (m[1]) out += `<code>${esc(s.slice(1, -1))}</code>`;
    else if (m[2]) {
      const [t, alias] = s.slice(2, -2).split('|');
      out += chip(t.trim(), alias ? '' : '').replace(/<span>.*?<\/span>/, `<span>${esc((alias || t).trim())}</span>`);
    } else if (m[3]) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(s);
      out += `<a class="ext" href="${esc(mm[2])}" target="_blank" rel="noopener">${esc(mm[1])}</a>`;
    } else if (m[4]) out += `<a class="ext" href="${esc(s)}" target="_blank" rel="noopener">${esc(s.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 48))}${s.length > 56 ? '…' : ''}</a>`;
    else if (m[5]) out += `<strong>${renderInline(s.slice(2, -2))}</strong>`;
    else if (m[6]) out += `<mark>${renderInline(s.slice(2, -2))}</mark>`;
    else if (m[7]) out += `<del>${renderInline(s.slice(2, -2))}</del>`;
    else if (m[8]) out += `<em>${renderInline(s.slice(1, -1))}</em>`;
    else if (m[9]) out += `<a class="tag" data-tag="${esc(s.slice(1))}">${esc(s)}</a>`;
    last = m.index + s.length;
  }
  return out + esc(text.slice(last));
}

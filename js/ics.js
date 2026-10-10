// Minimal iCalendar parser with RRULE expansion — enough for Google/Apple/Outlook feeds.
const unfold = (t) => t.replace(/\r?\n[ \t]/g, '');
const unesc = (s) => (s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\;/g, ';').replace(/\\\\/g, '\\');

function splitLine(line) {
  let q = false; let i = 0;
  for (; i < line.length; i++) { if (line[i] === '"') q = !q; else if (line[i] === ':' && !q) break; }
  const head = line.slice(0, i); const value = line.slice(i + 1);
  const [name, ...ps] = head.split(';'); const params = {};
  ps.forEach((p) => { const [k, ...v] = p.split('='); params[k.toUpperCase()] = v.join('=').replace(/^"|"$/g, ''); });
  return { name: name.toUpperCase(), params, value };
}

function tzOffset(ts, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo, d, h, mi, s);
  try {
    let r = guess - tzOffset(guess, tz);
    r = guess - tzOffset(r, tz);
    return r;
  } catch { return new Date(y, mo, d, h, mi, s).getTime(); }
}

/** Returns {ms, allDay, tz, w:[y,m,d,h,mi,s]} */
function parseDate(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2] - 1, +m[3]];
  if (m[4] === undefined) return { ms: new Date(y, mo, d).getTime(), allDay: true, tz: null, w: [y, mo, d, 0, 0, 0] };
  const [h, mi, s] = [+m[4], +m[5], +(m[6] || 0)];
  if (m[7]) return { ms: Date.UTC(y, mo, d, h, mi, s), allDay: false, tz: 'UTC', w: [y, mo, d, h, mi, s] };
  const tz = params.TZID || null;
  return { ms: tz ? zonedToUtc(y, mo, d, h, mi, s, tz) : new Date(y, mo, d, h, mi, s).getTime(), allDay: false, tz, w: [y, mo, d, h, mi, s] };
}
const atWall = (base, y, mo, d) => {
  const [, , , h, mi, s] = base.w;
  if (base.allDay) return new Date(y, mo, d).getTime();
  if (base.tz === 'UTC') return Date.UTC(y, mo, d, h, mi, s);
  if (base.tz) return zonedToUtc(y, mo, d, h, mi, s, base.tz);
  return new Date(y, mo, d, h, mi, s).getTime();
};

export function parseICS(text) {
  const lines = unfold(text).split(/\r?\n/);
  const events = []; let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { attendees: [], exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur?.start) events.push(finish(cur)); cur = null; continue; }
    if (!cur || !line) continue;
    const { name, params, value } = splitLine(line);
    switch (name) {
      case 'UID': cur.uid = value; break;
      case 'SUMMARY': cur.title = unesc(value); break;
      case 'LOCATION': cur.location = unesc(value); break;
      case 'DESCRIPTION': cur.description = unesc(value); break;
      case 'URL': cur.url = value; break;
      case 'STATUS': cur.status = value; break;
      case 'DTSTART': cur.start = parseDate(value, params); break;
      case 'DTEND': cur.end = parseDate(value, params); break;
      case 'DURATION': cur.duration = value; break;
      case 'RRULE': cur.rrule = Object.fromEntries(value.split(';').map((p) => p.split('='))); break;
      case 'EXDATE': value.split(',').forEach((v) => { const d = parseDate(v, params); if (d) cur.exdates.push(d.ms); }); break;
      case 'RECURRENCE-ID': cur.recId = parseDate(value, params)?.ms; break;
      case 'ATTENDEE': cur.attendees.push({ name: params.CN || '', email: value.replace(/^mailto:/i, ''), role: params.CUTYPE === 'RESOURCE' ? 'resource' : '', status: params.PARTSTAT || '' }); break;
      case 'ORGANIZER': cur.organizer = { name: params.CN || '', email: value.replace(/^mailto:/i, '') }; break;
      default:
    }
    if (name === 'X-GOOGLE-CONFERENCE' || name === 'X-MICROSOFT-SKYPETEAMSMEETINGURL') cur.meet = value;
  }
  return events;
}
function finish(e) {
  const dur = e.duration ? durMs(e.duration) : null;
  let endMs = e.end?.ms;
  if (endMs == null) endMs = e.start.ms + (dur ?? (e.start.allDay ? 864e5 : 0));
  const m = /https?:\/\/[^\s<>"]*(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|webex\.com)[^\s<>"]*/i.exec(`${e.location || ''} ${e.description || ''} ${e.url || ''} ${e.meet || ''}`);
  return {
    uid: e.uid || `${e.title}-${e.start.ms}`, title: e.title || '(No title)', location: e.location || '', description: (e.description || '').slice(0, 600), link: m ? m[0] : '',
    start: e.start, dur: endMs - e.start.ms, allDay: e.start.allDay, rrule: e.rrule || null, exdates: e.exdates, recId: e.recId || null, status: e.status || '',
    attendees: e.attendees.filter((a) => a.role !== 'resource' && !/resource\.calendar/.test(a.email)), organizer: e.organizer || null,
  };
}
function durMs(d) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(d); if (!m) return null;
  return (((+m[1] || 0) * 7 + (+m[2] || 0)) * 24 + (+m[3] || 0)) * 3600e3 + (+m[4] || 0) * 60e3 + (+m[5] || 0) * 1e3;
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
export function expand(events, fromMs, toMs) {
  const out = [];
  const overrides = new Set(events.filter((e) => e.recId).map((e) => `${e.uid}|${e.recId}`));
  for (const e of events) {
    if (e.status === 'CANCELLED') continue;
    const inst = (startMs) => ({ uid: e.uid, id: `${e.uid}@${startMs}`, title: e.title, start: startMs, end: startMs + e.dur, allDay: e.allDay, location: e.location, link: e.link, description: e.description, attendees: e.attendees, organizer: e.organizer });
    if (!e.rrule) { if (e.start.ms < toMs && e.start.ms + e.dur > fromMs) out.push(inst(e.start.ms)); continue; }
    const r = e.rrule; const interval = +r.INTERVAL || 1; const count = r.COUNT ? +r.COUNT : Infinity;
    const until = r.UNTIL ? (parseDate(r.UNTIL, {})?.ms ?? Infinity) : Infinity;
    const [y0, m0, d0] = e.start.w;
    const ex = new Set(e.exdates);
    const byday = r.BYDAY ? r.BYDAY.split(',').map((s) => ({ n: parseInt(s, 10) || 0, d: DAYS.indexOf(s.slice(-2)) })) : null;
    const bymd = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null;
    const bymo = r.BYMONTH ? r.BYMONTH.split(',').map(Number) : null;
    let n = 0; let guard = 0;
    const emit = (y, mo, d) => {
      const ms = atWall(e.start, y, mo, d);
      if (ms < e.start.ms) return true;
      if (ms > until) return false;
      if (++n > count) return false;
      if (ms >= toMs) return false;
      if (!ex.has(ms) && !overrides.has(`${e.uid}|${ms}`) && ms + e.dur > fromMs) out.push(inst(ms));
      return true;
    };
    const dow0 = new Date(Date.UTC(y0, m0, d0)).getUTCDay();
    if (r.FREQ === 'DAILY') {
      for (let i = 0; guard++ < 6000; i += interval) { const dt = new Date(Date.UTC(y0, m0, d0 + i)); if (!emit(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())) break; }
    } else if (r.FREQ === 'WEEKLY') {
      const days = byday ? byday.map((x) => x.d) : [dow0];
      outer: for (let w = 0; guard++ < 3000; w += interval) {
        for (const wd of [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
          // Weeks start on Monday, matching the common WKST default.
          const shift = ((wd + 6) % 7) - ((dow0 + 6) % 7);
          const dt = new Date(Date.UTC(y0, m0, d0 + w * 7 + shift));
          if (!emit(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())) break outer;
        }
      }
    } else if (r.FREQ === 'MONTHLY') {
      outer2: for (let i = 0; guard++ < 1500; i += interval) {
        const y = y0 + Math.floor((m0 + i) / 12); const mo = (m0 + i) % 12;
        const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
        let days = [];
        if (bymd) days = bymd.map((d) => (d < 0 ? dim + 1 + d : d));
        else if (byday) {
          for (const bd of byday) {
            const all = []; for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, mo, d)).getUTCDay() === bd.d) all.push(d);
            if (bd.n > 0) all[bd.n - 1] && days.push(all[bd.n - 1]); else if (bd.n < 0) all[all.length + bd.n] && days.push(all[all.length + bd.n]); else days.push(...all);
          }
        } else days = [d0];
        for (const d of days.filter((d) => d >= 1 && d <= dim).sort((a, b) => a - b)) if (!emit(y, mo, d)) break outer2;
      }
    } else if (r.FREQ === 'YEARLY') {
      for (let i = 0; guard++ < 200; i += interval) {
        const y = y0 + i; const mo = bymo ? bymo[0] - 1 : m0; let d = bymd ? bymd[0] : d0;
        if (byday && byday[0].n) {
          const all = []; const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
          for (let k = 1; k <= dim; k++) if (new Date(Date.UTC(y, mo, k)).getUTCDay() === byday[0].d) all.push(k);
          d = byday[0].n > 0 ? all[byday[0].n - 1] : all[all.length + byday[0].n];
        }
        if (!emit(y, mo, d)) break;
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

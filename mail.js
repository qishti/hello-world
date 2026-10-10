// Email-in: polls an IMAP folder/label and queues messages for the Folio browser app.
// Optional. Needs `npm install` (imapflow, mailparser). Credentials stay on this machine.
const fs = require('fs');
const path = require('path');

const CONF = path.join(__dirname, '.folio-mail.json');
const STATE = path.join(__dirname, '.folio-inbox.json');
let ImapFlow = null; let simpleParser = null; let loadError = '';
try { ({ ImapFlow } = require('imapflow')); ({ simpleParser } = require('mailparser')); } catch (e) { loadError = e.message; }

const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const write = (f, v) => { fs.writeFileSync(f, JSON.stringify(v, null, 1), { mode: 0o600 }); try { fs.chmodSync(f, 0o600); } catch { /* windows */ } };

let conf = read(CONF, null);
let state = read(STATE, { lastUid: 0, uidValidity: 0, queue: [], lastCheck: 0, error: '' });
let polling = null;

const available = () => !!ImapFlow;
const configured = () => !!(conf && conf.user && conf.pass);

function status() {
  return { available: available(), loadError: available() ? '' : loadError, configured: configured(), user: conf?.user || '', host: conf?.host || '', mailbox: conf?.mailbox || 'Folio', lastCheck: state.lastCheck, error: state.error, pending: state.queue.length };
}

const STRIP_QUOTE = [/^On .{5,200}wrote:\s*$/im, /^-{2,}\s*Original Message\s*-{2,}/im, /^From:.{3,200}\r?\n(Sent|Date):/im, /^_{5,}\s*$/m];
function cleanBody(text) {
  let t = (text || '').replace(/\r/g, '');
  for (const re of STRIP_QUOTE) { const m = re.exec(t); if (m && m.index > 80) t = t.slice(0, m.index); }
  t = t.split('\n').filter((l) => !/^\s*>/.test(l)).join('\n');
  t = t.replace(/\n-- \n[\s\S]*$/, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t.slice(0, 5000);
}
function htmlToText(html) {
  return (html || '').replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
/** Turn a raw RFC822 message into the compact shape the app stores. */
async function normalize(source, uid, internalDate) {
  const m = await simpleParser(source);
  const body = cleanBody(m.text || htmlToText(m.html || ''));
  const links = [...new Set((body.match(/https?:\/\/[^\s<>)"']+/g) || []).map((u) => u.replace(/[.,;]+$/, '')))].slice(0, 8);
  const from = m.from?.value?.[0] || {};
  return {
    id: m.messageId || `uid-${uid}`, uid, subject: (m.subject || '(no subject)').trim(), from: { name: from.name || '', address: from.address || '' },
    date: (m.date || internalDate || new Date()).toISOString(), received: (internalDate || m.date || new Date()).toISOString(),
    text: body, links, attachments: (m.attachments || []).filter((a) => !a.related).map((a) => a.filename || 'attachment').slice(0, 10),
  };
}

function client() {
  const host = conf.host || 'imap.gmail.com';
  return new ImapFlow({ host, port: conf.port || 993, secure: true, auth: { user: conf.user, pass: conf.pass }, logger: false, socketTimeout: 60000 });
}

async function poll() {
  if (!available() || !configured()) return status();
  if (polling) return polling;
  polling = (async () => {
    const c = client(); c.on('error', () => {});
    try {
      await c.connect();
      const lock = await c.getMailboxLock(conf.mailbox || 'Folio');
      try {
        const validity = Number(c.mailbox.uidValidity);
        if (state.uidValidity !== validity) { state.uidValidity = validity; state.lastUid = 0; }
        let uids;
        if (!state.lastUid) uids = await c.search({ since: new Date(Date.now() - (conf.days || 14) * 864e5) }, { uid: true });
        else uids = (await c.search({ uid: `${state.lastUid + 1}:*` }, { uid: true })).filter((u) => u > state.lastUid);
        for (const uid of (uids || []).sort((a, b) => a - b)) {
          const msg = await c.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true });
          if (!msg?.source) continue;
          const n = await normalize(msg.source, uid, msg.internalDate);
          if (!state.queue.some((q) => q.id === n.id)) state.queue.push(n);
          state.lastUid = Math.max(state.lastUid, uid);
        }
      } finally { lock.release(); }
      state.error = '';
    } catch (e) { state.error = e.responseText || e.message || String(e); }
    finally { try { await c.logout(); } catch { /* closed */ } state.lastCheck = Date.now(); write(STATE, state); polling = null; }
    return status();
  })();
  return polling;
}

async function saveConfig(c) {
  if (!available()) throw new Error('Run `npm install` in the Folio folder to enable email-in.');
  const next = { host: (c.host || 'imap.gmail.com').trim(), port: 993, user: (c.user || '').trim(), pass: c.pass || conf?.pass || '', mailbox: (c.mailbox || 'Folio').trim(), days: 14 };
  if (!next.user || !next.pass) throw new Error('Enter your email address and an app password.');
  const prev = conf; conf = next;
  const t = client(); t.on('error', () => {});
  try { await t.connect(); const lock = await t.getMailboxLock(next.mailbox); lock.release(); await t.logout(); }
  catch (e) { conf = prev; throw new Error(e.authenticationFailed ? 'Login failed. Use an app password, not your normal password.' : e.responseText || e.message); }
  if (!prev || prev.user !== next.user || prev.mailbox !== next.mailbox || prev.host !== next.host) state = { lastUid: 0, uidValidity: 0, queue: state.queue, lastCheck: 0, error: '' };
  write(CONF, conf); write(STATE, state);
  return status();
}
function clearConfig() { conf = null; state = { lastUid: 0, uidValidity: 0, queue: [], lastCheck: 0, error: '' }; for (const f of [CONF, STATE]) { try { fs.unlinkSync(f); } catch { /* none */ } } return status(); }
const inbox = () => state.queue.slice(0, 50);
function ack(ids) { const s = new Set(ids); state.queue = state.queue.filter((m) => !s.has(m.id)); write(STATE, state); return status(); }

function start(everyMs = 120000) { if (configured() && available()) { poll(); } setInterval(() => { if (configured() && available()) poll(); }, everyMs).unref?.(); }

module.exports = { status, poll, saveConfig, clearConfig, inbox, ack, start, normalize: (...a) => normalize(...a), available };

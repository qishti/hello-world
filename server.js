#!/usr/bin/env node
// Zero-dependency static server + CORS proxy for Folio.
// Usage: node server.js [port]   →  http://localhost:8787
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const mail = require('./mail');
const vault = require('./vault');

const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1'; // local only: the mail and proxy endpoints carry your credentials
const ROOT = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.mjs': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
// Hosts the proxy will talk to. Add your own calendar host here if needed.
const ALLOW = [/^readwise\.io$/, /^api\.todoist\.com$/, /(^|\.)google\.com$/, /(^|\.)icloud\.com$/, /(^|\.)office365\.com$/, /(^|\.)outlook\.com$/, /(^|\.)live\.com$/, /(^|\.)fastmail\.com$/, /(^|\.)proton\.me$/, /(^|\.)nextcloud\.com$/];

const json = (res, code, v) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)); };
const body = async (req) => { const c = []; for await (const x of req) c.push(x); try { return JSON.parse(Buffer.concat(c).toString() || '{}'); } catch { return {}; } };

async function mailApi(req, res, u) {
  // The custom header forces a CORS preflight, so other websites cannot call these endpoints.
  if (req.headers['x-folio'] !== '1') return json(res, 403, { error: 'forbidden' });
  const p = u.pathname.replace('/mail/', '');
  try {
    if (p === 'status') return json(res, 200, mail.status());
    if (p === 'inbox') return json(res, 200, { messages: mail.inbox(), status: mail.status() });
    if (p === 'poll' && req.method === 'POST') return json(res, 200, { status: await mail.poll(), messages: mail.inbox() });
    if (p === 'ack' && req.method === 'POST') return json(res, 200, mail.ack((await body(req)).ids || []));
    if (p === 'config' && req.method === 'POST') { const st = await mail.saveConfig(await body(req)); mail.poll(); return json(res, 200, st); }
    if (p === 'config' && req.method === 'DELETE') return json(res, 200, mail.clearConfig());
  } catch (e) { return json(res, 400, { error: e.message }); }
  json(res, 404, { error: 'not found' });
}

async function vaultApi(req, res, u) {
  if (req.headers['x-folio'] !== '1') return json(res, 403, { error: 'forbidden' });
  const p = u.pathname.replace('/vault/', '');
  try {
    if (p === 'status') return json(res, 200, vault.status());
    if (p === 'config' && req.method === 'POST') return json(res, 200, vault.setDir((await body(req)).dir));
    if (p === 'config' && req.method === 'DELETE') return json(res, 200, vault.clear());
    if (p === 'write' && req.method === 'POST') { const b = await body(req); return json(res, 200, vault.write(b.items, b.remove)); }
    if (p === 'ack' && req.method === 'POST') return json(res, 200, vault.ack((await body(req)).items));
    if (p === 'changes') return json(res, 200, { changes: vault.changes(u.searchParams.get('all') === '1') });
    if (p === 'has') return json(res, 200, { has: vault.hasFile(u.searchParams.get('id')) });
    if (p === 'file' && req.method === 'PUT') { const c = []; for await (const x of req) c.push(x); return json(res, 200, vault.putFile(u.searchParams.get('path'), u.searchParams.get('id'), Buffer.concat(c))); }
  } catch (e) { return json(res, 400, { error: e.message }); }
  json(res, 404, { error: 'not found' });
}

async function proxy(req, res, u) {
  const target = u.searchParams.get('url');
  let t;
  try { t = new URL(target); } catch { res.writeHead(400); return res.end('bad url'); }
  if (t.protocol !== 'https:' || !ALLOW.some((r) => r.test(t.hostname))) { res.writeHead(403); return res.end('host not allowed: ' + t.hostname); }
  const headers = {};
  for (const k of ['authorization', 'content-type', 'accept']) if (req.headers[k]) headers[k] = req.headers[k];
  const chunks = []; for await (const c of req) chunks.push(c);
  try {
    const r = await fetch(t, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks), redirect: 'follow' });
    const out = { 'content-type': r.headers.get('content-type') || 'text/plain', 'cache-control': 'no-store' };
    if (r.headers.get('retry-after')) out['retry-after'] = r.headers.get('retry-after');
    res.writeHead(r.status, out);
    Readable.fromWeb(r.body).pipe(res);
  } catch (e) { res.writeHead(502); res.end('upstream error: ' + e.message); }
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); return res.end('local access only'); }
  if (u.pathname.startsWith('/mail/')) return mailApi(req, res, u);
  if (u.pathname.startsWith('/vault/')) return vaultApi(req, res, u);
  if (u.pathname === '/proxy/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
  if (u.pathname === '/proxy') return proxy(req, res, u);
  let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p.endsWith(path.sep) || p === '.') p = path.join(p, 'index.html');
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || /(^|[/\\])(\.git|node_modules|\.folio-)/.test(p) || /^[/\\]?(server|mail|vault)\.js$/.test(p) || /^[/\\]?package(-lock)?\.json$/.test(p)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, HOST, () => { console.log(`Folio running at http://localhost:${PORT}`); mail.start(); });

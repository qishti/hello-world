#!/usr/bin/env node
// Zero-dependency static server + CORS proxy for Folio.
// Usage: node server.js [port]   →  http://localhost:8787
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const ROOT = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
// Hosts the proxy will talk to. Add your own calendar host here if needed.
const ALLOW = [/^readwise\.io$/, /^api\.todoist\.com$/, /(^|\.)google\.com$/, /(^|\.)icloud\.com$/, /(^|\.)office365\.com$/, /(^|\.)outlook\.com$/, /(^|\.)live\.com$/, /(^|\.)fastmail\.com$/, /(^|\.)proton\.me$/, /(^|\.)nextcloud\.com$/];

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
  if (u.pathname === '/proxy/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
  if (u.pathname === '/proxy') return proxy(req, res, u);
  let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p.endsWith(path.sep) || p === '.') p = path.join(p, 'index.html');
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || /(^|[/\\])(\.git|node_modules|server\.js)/.test(p)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Folio running at http://localhost:${PORT}`));

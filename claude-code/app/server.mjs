/**
 * server.mjs — "sealevel web": a local web page for the sea-level agent.
 * Each question runs one Claude Code turn (engine.mjs) and streams the steps,
 * the answer, and any plots/data files the agent creates straight into the page.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, runTurn, listFiles, kindOf } from './engine.mjs';

const WEB = path.join(ROOT, 'app', 'web');
const TYPES = { html: 'text/html; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', csv: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', json: 'application/json', txt: 'text/plain; charset=utf-8', py: 'text/plain; charset=utf-8', mjs: 'text/plain; charset=utf-8', js: 'text/plain; charset=utf-8' };

function safe(rel) { // only files under outputs/ or data/
  const abs = path.resolve(ROOT, rel);
  if (!(abs.startsWith(path.join(ROOT, 'outputs') + path.sep) || abs.startsWith(path.join(ROOT, 'data') + path.sep))) return null;
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

export function startServer({ port = 8765, host = '127.0.0.1' } = {}) {
  let busy = false;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'content-type': TYPES.html, 'cache-control': 'no-store' });
        return res.end(fs.readFileSync(path.join(WEB, 'index.html')));
      }
      if (req.method === 'GET' && url.pathname === '/api/files') return json(res, 200, { files: listFiles() });
      if (req.method === 'GET' && url.pathname.startsWith('/file/')) {
        const abs = safe(decodeURIComponent(url.pathname.slice(6)));
        if (!abs) return json(res, 404, { error: 'not found' });
        const ext = abs.split('.').pop().toLowerCase();
        res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store',
          ...(url.searchParams.has('download') ? { 'content-disposition': `attachment; filename="${path.basename(abs)}"` } : {}) });
        return fs.createReadStream(abs).pipe(res);
      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        let body = ''; for await (const c of req) body += c;
        const { message, session_id } = JSON.parse(body || '{}');
        if (!message || !String(message).trim()) return json(res, 400, { error: 'empty message' });
        if (busy) return json(res, 409, { error: 'The agent is still working on the previous question.' });
        busy = true;
        res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
        const send = ev => res.write(JSON.stringify(ev) + '\n');
        let done = false;
        await runTurn(String(message), { sessionId: session_id || undefined, web: true }, ev => { if (ev.type === 'done') done = true; send(ev); });
        if (!done) send({ type: 'done' });
        busy = false; return res.end();
      }
      json(res, 404, { error: 'not found' });
    } catch (e) { busy = false; try { json(res, 500, { error: e.message }); } catch { res.end(); } }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => resolve({ server, url: `http://localhost:${server.address().port}/` }));
  });
}
export { kindOf };

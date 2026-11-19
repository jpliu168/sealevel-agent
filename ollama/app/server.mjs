/**
 * server.mjs — local web page for the Ollama sea-level agent.
 * Conversations are kept in memory on this machine (per browser tab session id).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, runTurn, listFiles, listModels, DEFAULT_MODEL, OLLAMA } from './agent.mjs';

const WEB = path.join(ROOT, 'app', 'web');
const TYPES = { html: 'text/html; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', csv: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', json: 'application/json', txt: 'text/plain; charset=utf-8' };
const SESSIONS = new Map();   // id -> message history (no system prompt)
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
function safe(rel) {
  const abs = path.resolve(ROOT, rel);
  if (!(abs.startsWith(path.join(ROOT, 'outputs') + path.sep) || abs.startsWith(path.join(ROOT, 'data') + path.sep))) return null;
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
}
function trimHistory(h, max = 60) { // keep follow-ups possible without overflowing a small context
  if (h.length <= max) return h;
  let i = h.length - max; while (i < h.length && h[i].role !== 'user') i++;
  return h.slice(i);
}

export function startServer({ port = 8766, host = '127.0.0.1' } = {}) {
  let busy = false;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) { res.writeHead(200, { 'content-type': TYPES.html, 'cache-control': 'no-store' }); return res.end(fs.readFileSync(path.join(WEB, 'index.html'))); }
      if (req.method === 'GET' && url.pathname === '/api/models') {
        try { return json(res, 200, { models: await listModels(), default: DEFAULT_MODEL, ollama: OLLAMA }); }
        catch (e) { return json(res, 200, { models: [], default: DEFAULT_MODEL, ollama: OLLAMA, error: 'Ollama not reachable at ' + OLLAMA + ' (' + e.message + '). Start the Ollama app or run `ollama serve`.' }); }
      }
      if (req.method === 'GET' && url.pathname === '/api/files') return json(res, 200, { files: listFiles() });
      if (req.method === 'GET' && url.pathname.startsWith('/file/')) {
        const abs = safe(decodeURIComponent(url.pathname.slice(6))); if (!abs) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': TYPES[abs.split('.').pop().toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store', ...(url.searchParams.has('download') ? { 'content-disposition': `attachment; filename="${path.basename(abs)}"` } : {}) });
        return fs.createReadStream(abs).pipe(res);
      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        let body = ''; for await (const c of req) body += c;
        const { message, session_id, model, think } = JSON.parse(body || '{}');
        if (!message || !String(message).trim()) return json(res, 400, { error: 'empty message' });
        if (busy) return json(res, 409, { error: 'The model is still working on the previous question.' });
        busy = true;
        const sid = session_id && SESSIONS.has(session_id) ? session_id : crypto.randomUUID();
        res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
        const send = ev => res.write(JSON.stringify(ev) + '\n');
        send({ type: 'session', session_id: sid });
        try {
          const hist = await runTurn(String(message), { history: SESSIONS.get(sid) || [], model: model || DEFAULT_MODEL, think: think === 'on' ? true : think === 'off' ? false : undefined }, send);
          SESSIONS.set(sid, trimHistory(hist));
        } finally { busy = false; res.end(); }
        return;
      }
      json(res, 404, { error: 'not found' });
    } catch (e) { busy = false; try { json(res, 500, { error: e.message }); } catch { res.end(); } }
  });
  return new Promise((resolve, reject) => { server.on('error', reject); server.listen(port, host, () => resolve({ server, url: `http://localhost:${server.address().port}/` })); });
}

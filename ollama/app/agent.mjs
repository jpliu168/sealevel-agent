/**
 * agent.mjs — our own small harness. No Claude Code: this file IS the harness.
 *
 *   question ─▶ Ollama (local LLM, e.g. qwen3.5:9b) ─▶ tool calls ─▶ MCP server (noaa-tides)
 *                ▲                                                        │
 *                └──────────────── tool results ◀────────────────────────┘   (repeat)
 *
 * - System prompt  = AGENTS.md + the one-line descriptions of skills/*.
 * - Tools          = the MCP server's tools (discovered with tools/list) + load_skill.
 * - Loop           = call the model, run any tool calls, feed results back, stop
 *                    when the model answers without calling a tool (max MAX_STEPS).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OLLAMA = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '').replace(/^(?!https?:)/, 'http://');
export const DEFAULT_MODEL = process.env.SEALEVEL_MODEL || 'qwen3.5:9b';
const MAX_STEPS = 16;
const NUM_CTX = +(process.env.SEALEVEL_NUM_CTX || 16384);   // Ollama's default context is too small for tools + data

/* ======================= MCP client (stdio, JSON-RPC 2.0) ======================= */
export class MCPClient {
  constructor(command, args, cwd) { this.command = command; this.args = args; this.cwd = cwd; this.id = 0; this.pending = new Map(); this.buf = ''; }
  async start() {
    this.proc = spawn(this.command, this.args, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stderr.on('data', () => {});
    this.proc.stdout.on('data', d => {
      this.buf += d; let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
      }
    });
    this.proc.on('exit', () => { for (const p of this.pending.values()) p.reject(new Error('MCP server exited')); this.pending.clear(); this.proc = null; });
    this.info = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sealevel-local', version: '1.0.0' } });
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    this.tools = (await this.request('tools/list', {})).tools;
    return this;
  }
  request(method, params) {
    if (!this.proc) return Promise.reject(new Error('MCP server not running'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(method + ' timed out')); } }, 120000);
    });
  }
  async call(name, args) { const r = await this.request('tools/call', { name, arguments: args }); return { text: (r.content || []).map(c => c.text || '').join('\n'), isError: !!r.isError }; }
  stop() { if (this.proc) this.proc.kill(); }
}

let MCP = null;
export async function mcp() {
  if (MCP && MCP.proc) return MCP;
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'mcp.json'), 'utf8')).mcpServers['noaa-tides'];
  MCP = await new MCPClient(cfg.command, cfg.args, ROOT).start();
  return MCP;
}

/* ======================= agent files: AGENTS.md + skills ======================= */
function loadSkills() {
  const dir = path.join(ROOT, 'skills');
  return fs.readdirSync(dir).filter(d => fs.existsSync(path.join(dir, d, 'SKILL.md'))).map(d => {
    const t = fs.readFileSync(path.join(dir, d, 'SKILL.md'), 'utf8');
    const m = t.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/); const meta = {};
    if (m) m[1].split('\n').forEach(l => { const k = l.match(/^(\w[\w-]*):\s*(.*)$/); if (k) meta[k[1]] = k[2].trim(); });
    return { name: meta.name || d, description: meta.description || '', body: m ? m[2] : t };
  });
}
function systemPrompt(skills) {
  return fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8') +
    `\n\n## Available skills (call load_skill with the name)\n${skills.map(s => `- ${s.name}: ${s.description}`).join('\n')}\n\nToday is ${new Date().toISOString().slice(0, 10)}. Latest complete year of data: 2025.`;
}
const LOAD_SKILL = { name: 'load_skill', description: 'Read the step-by-step instructions of a skill. Call it before starting a multi-step task.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'skill name' } }, required: ['name'] } };

/* ======================= helpers for small models ======================= */
function coerceArgs(args, schema) { // small models often send "2016" instead of 2016, or a JSON string
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
  const props = schema?.properties || {}; const out = { ...(args || {}) };
  for (const [k, v] of Object.entries(out)) {
    const t = props[k]?.type;
    if ((t === 'integer' || t === 'number') && typeof v === 'string' && v.trim() !== '' && !isNaN(+v)) out[k] = t === 'integer' ? Math.round(+v) : +v;
    if (t === 'array' && typeof v === 'string') { try { out[k] = JSON.parse(v); } catch { out[k] = v.split(/[,\s]+/).filter(Boolean); } }
    if (t === 'string' && typeof v === 'number') out[k] = String(v);
  }
  return out;
}
function textToolCalls(content, names) { // some models write <tool_call>{...}</tool_call> or a bare JSON object instead of a real call
  const calls = []; const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g; let m;
  while ((m = re.exec(content))) { try { const j = JSON.parse(m[1]); if (names.includes(j.name)) calls.push({ function: { name: j.name, arguments: j.arguments || j.parameters || {} } }); } catch { /* ignore */ } }
  if (!calls.length) { try { const j = JSON.parse(content.trim()); if (j && names.includes(j.name)) calls.push({ function: { name: j.name, arguments: j.arguments || j.parameters || {} } }); } catch { /* not JSON */ } }
  return calls;
}
function compact(text) { // shrink tool results so they fit a small context window
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j.stations)) { const n = j.stations.length; j.stations = j.stations.slice(0, 25).map(({ id, name, state, distance_mi }) => ({ id, name, state, ...(distance_mi != null ? { distance_mi } : {}) })); if (n > 25) j.note = `${n - 25} more not shown`; }
    delete j.absolute_path;
    return JSON.stringify(j);
  } catch { return text.length > 4000 ? text.slice(0, 4000) + ' …(truncated)' : text; }
}
function summarize(name, text, isError) {
  if (isError) return text.replace(/\s+/g, ' ').slice(0, 200);
  try {
    const j = JSON.parse(text); const b = [];
    if (j.instructions) return `loaded skill ${j.name}`;
    if (j.label) b.push(j.label);
    if (j.stations) b.push(`${j.stations.length} gauge(s)` + (j.stations[0] ? `, nearest ${j.stations[0].name}${j.stations[0].distance_mi != null ? ' ' + j.stations[0].distance_mi + ' mi' : ''}` : '') + (j.nearest_outside_radius ? `; none in range, nearest ${j.nearest_outside_radius.name} ${j.nearest_outside_radius.distance_mi} mi` : ''));
    if (j.trend_mm_per_yr != null) b.push(`${j.name || j.station_id} ${j.period || ''}: ${j.trend_mm_per_yr >= 0 ? '+' : ''}${j.trend_mm_per_yr} ± ${j.ci95_mm_per_yr} mm/yr`);
    if (j.long_term_trend_mm_per_yr != null) b.push(`long-term ${j.long_term_trend_mm_per_yr} ± ${j.ci95_mm_per_yr} mm/yr (${j.record})`);
    if (j.peak_surge) b.push(`peak surge ${j.peak_surge.meters} m at ${j.peak_surge.time_gmt} GMT`);
    if (j.csv) b.push(j.csv); if (j.file) b.push(j.file); if (j.note) b.push(j.note); if (j.error) b.push(j.error);
    return b.join(' · ') || text.slice(0, 160);
  } catch { return text.replace(/\s+/g, ' ').slice(0, 200); }
}

/* ======================= files the agent creates (shown in the web page) ======================= */
const SKIP = /^data\/(cache|builtin)\b|\/\.gitkeep$/;
export function listFiles() {
  const out = [];
  const walk = rel => { const abs = path.join(ROOT, rel); if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) { const r = rel + '/' + e.name; if (SKIP.test(r) || e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(r); else { const st = fs.statSync(path.join(ROOT, r)); out.push({ path: r, size: st.size, mtime: st.mtimeMs, kind: kindOf(r) }); } } };
  ['outputs', 'data'].forEach(walk);
  return out.sort((a, b) => b.mtime - a.mtime);
}
export function kindOf(p) { const x = p.split('.').pop().toLowerCase(); return { svg: 'image', png: 'image', csv: 'table', md: 'markdown', json: 'json', txt: 'text' }[x] || 'file'; }

/* ======================= Ollama ======================= */
export async function listModels() { const r = await fetch(OLLAMA + '/api/tags'); if (!r.ok) throw new Error('HTTP ' + r.status); return (await r.json()).models.map(m => m.name); }

async function chatStream(body, onChunk) {
  const r = await fetch(OLLAMA + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { let msg = 'HTTP ' + r.status; try { msg = (await r.json()).error || msg; } catch { } throw new Error(msg); }
  const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', content = '', thinking = '', tool_calls = [], stats = {};
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
      const m = JSON.parse(line);
      if (m.error) throw new Error(m.error);
      if (m.message?.thinking) { thinking += m.message.thinking; onChunk({ thinking: m.message.thinking }); }
      if (m.message?.content) { content += m.message.content; onChunk({ content: m.message.content }); }
      if (m.message?.tool_calls) tool_calls.push(...m.message.tool_calls);
      if (m.done) stats = { eval_count: m.eval_count, prompt_eval_count: m.prompt_eval_count, total_duration: m.total_duration };
    }
  }
  return { content, thinking, tool_calls, stats };
}

/**
 * Run one question. `history` is the conversation so far (kept by the caller for follow-ups).
 * onEvent receives the same event types as the Claude Code version:
 *  start · thinking · tool · result · files · delta · answer · done · error
 */
export async function runTurn(question, { history = [], model = DEFAULT_MODEL, think } = {}, onEvent) {
  const snap = new Map(listFiles().map(f => [f.path, f.mtime])); const sent = new Set();
  const pushFiles = () => { const f = listFiles().filter(x => (!snap.has(x.path) || snap.get(x.path) !== x.mtime) && !sent.has(x.path + x.mtime)); f.forEach(x => sent.add(x.path + x.mtime)); if (f.length) onEvent({ type: 'files', files: f }); };
  let server;
  try { server = await mcp(); } catch (e) { onEvent({ type: 'error', message: 'Could not start the MCP server: ' + e.message }); return history; }
  const skills = loadSkills();
  const toolDefs = [LOAD_SKILL, ...server.tools];
  const schemas = Object.fromEntries(toolDefs.map(t => [t.name, t.inputSchema]));
  const tools = toolDefs.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  onEvent({ type: 'start', model, mcp: [`${server.info?.serverInfo?.name || 'noaa-tides'}: ${server.tools.length} tools`], skills: skills.map(s => s.name) });

  const messages = [{ role: 'system', content: systemPrompt(skills) }, ...history, { role: 'user', content: question }];
  const t0 = Date.now(); let tokens = 0, final = '';
  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      const body = { model, messages, tools, stream: true, options: { num_ctx: NUM_CTX, temperature: 0.2 } };
      if (think !== undefined) body.think = think;
      let streamed = '';
      const res = await chatStream(body, c => { if (c.content) { streamed += c.content; onEvent({ type: 'delta', text: c.content }); } });
      tokens += (res.stats.eval_count || 0);
      let calls = res.tool_calls;
      if (!calls.length && res.content) calls = textToolCalls(res.content, toolDefs.map(t => t.name));
      if (res.thinking.trim()) onEvent({ type: 'thinking', text: res.thinking.trim().slice(0, 600) + (res.thinking.length > 600 ? '…' : ''), reasoning: true });
      if (!calls.length) { final = res.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); messages.push({ role: 'assistant', content: res.content }); break; }
      if (res.content.trim() && !/<tool_call>/.test(res.content)) onEvent({ type: 'thinking', text: res.content.trim() });
      onEvent({ type: 'reset_delta' });
      messages.push({ role: 'assistant', content: res.content, tool_calls: calls });
      for (const c of calls) {
        const name = c.function.name, args = coerceArgs(c.function.arguments, schemas[name]);
        onEvent({ type: 'tool', who: name === 'load_skill' ? 'Skill' : 'MCP · noaa-tides', what: name === 'load_skill' ? `load ${args.name}` : `${name}(${JSON.stringify(args)})` });
        let text, isError = false;
        if (name === 'load_skill') { const s = skills.find(x => x.name === args.name); text = s ? JSON.stringify({ name: s.name, instructions: s.body }) : JSON.stringify({ error: 'no such skill; available: ' + skills.map(x => x.name).join(', ') }); isError = !s; }
        else if (!schemas[name]) { text = JSON.stringify({ error: `unknown tool ${name}; available: ${toolDefs.map(t => t.name).join(', ')}` }); isError = true; }
        else { try { ({ text, isError } = await server.call(name, args)); } catch (e) { text = 'Error: ' + e.message; isError = true; } }
        onEvent({ type: 'result', text: summarize(name, text, isError), error: isError });
        messages.push({ role: 'tool', content: name === 'load_skill' ? text : compact(text), tool_name: name });
        pushFiles();
      }
      if (step === MAX_STEPS) final = '(Stopped after ' + MAX_STEPS + ' steps without a final answer. Try a narrower question.)';
    }
  } catch (e) {
    const hint = /ECONNREFUSED|fetch failed/.test(e.message) ? ' Is Ollama running? Start the Ollama app or run `ollama serve`.' : /not found/.test(e.message) ? ` Pull it with: ollama pull ${model}` : /does not support tools/.test(e.message) ? ' Pick a model that supports tool calling (e.g. qwen3.5:9b, granite4.1:8b, llama3.2).' : '';
    onEvent({ type: 'error', message: e.message + hint }); return history;
  }
  pushFiles();
  onEvent({ type: 'answer', text: final || '(no answer)' });
  onEvent({ type: 'done', seconds: Math.round((Date.now() - t0) / 1000), tokens, model });
  // keep the conversation (without the system prompt) for follow-up questions
  return messages.slice(1);
}

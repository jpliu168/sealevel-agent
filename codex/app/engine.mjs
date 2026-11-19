/**
 * engine.mjs — runs one agent turn through OpenAI Codex CLI (the harness) in
 * non-interactive mode and turns its JSONL events into the same simple events the
 * Claude Code version uses, so the CLI and web front ends are shared.
 *
 *   codex exec --json --sandbox workspace-write --skip-git-repo-check
 *              -c mcp_servers.noaa-tides.command="node" -c ... [resume <id>] "<question>"
 *
 * Codex reads AGENTS.md and the skills in .agents/skills by itself. The MCP server is
 * passed with -c overrides, so it works even before you trust the folder in Codex.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CODEX_BIN = process.env.SEALEVEL_CODEX_BIN || 'codex';
/* Use OpenAI's cloud models even if ~/.codex/config.toml points Codex at a local model
   (Ollama / LM Studio, often with a 4,096-token context that this agent can't fit in).
   Newer Codex: --ignore-user-config (sign-in is kept). Older Codex: force the provider.
   Set SEALEVEL_CODEX_USE_USER_CONFIG=1 to use your own Codex config instead. */
import { spawnSync } from 'node:child_process';
let _ignoreFlag;
export function providerArgs() {
  if (process.env.SEALEVEL_CODEX_USE_USER_CONFIG === '1') return [];
  if (_ignoreFlag === undefined) { const h = spawnSync(CODEX_BIN, ['exec', '--help'], { encoding: 'utf8', timeout: 10000 }); _ignoreFlag = /--ignore-user-config/.test(h.stdout || ''); }
  return _ignoreFlag ? ['--ignore-user-config'] : ['-c', 'model_provider="openai"', '-c', 'oss=false'];
}
export const MCP_OVERRIDES = [
  '-c', 'mcp_servers.noaa-tides.command="node"',
  '-c', 'mcp_servers.noaa-tides.args=["../shared/mcp/noaa-tides-server.mjs"]',
  '-c', 'mcp_servers.noaa-tides.startup_timeout_sec=20',
  '-c', 'mcp_servers.noaa-tides.tool_timeout_sec=120',
  '-c', 'mcp_servers.noaa-tides.default_tools_approval_mode="approve"',
];

/* ---------- files the agent creates (shown automatically in the web UI) ---------- */
const SKIP = /^data\/(cache|builtin)\b|\/\.gitkeep$|^outputs\/scripts\/__pycache__/;
export function listFiles() {
  const out = [];
  const walk = rel => {
    const abs = path.join(ROOT, rel); if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel + '/' + e.name; if (SKIP.test(r) || e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(r); else { const st = fs.statSync(path.join(ROOT, r)); out.push({ path: r, size: st.size, mtime: st.mtimeMs, kind: kindOf(r) }); }
    }
  };
  ['outputs', 'data'].forEach(walk);
  return out.sort((a, b) => b.mtime - a.mtime);
}
export function kindOf(p) {
  const x = p.split('.').pop().toLowerCase();
  return { svg: 'image', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', csv: 'table', md: 'markdown', json: 'json', py: 'code', mjs: 'code', js: 'code', html: 'html', txt: 'text' }[x] || 'file';
}
const snapshot = () => new Map(listFiles().map(f => [f.path, f.mtime]));
const changedSince = snap => listFiles().filter(f => !snap.has(f.path) || snap.get(f.path) !== f.mtime);

/* ---------- describe Codex items ---------- */
const short = (s, n = 160) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
function describeStart(it) {
  const type = it.type || it.item_type;
  if (type === 'mcp_tool_call') return { who: `MCP · ${it.server || 'noaa-tides'}`, what: `${it.tool}(${short(JSON.stringify(it.arguments ?? it.args ?? {}), 140)})` };
  if (type === 'command_execution') {
    const cmd = Array.isArray(it.command) ? it.command.join(' ') : String(it.command || '');
    const sk = cmd.match(/\.agents\/skills\/([\w-]+)\/SKILL\.md/);
    return sk ? { who: 'Skill', what: 'read ' + sk[1] } : { who: 'Tool · shell', what: short(cmd.replace(/^(bash|zsh|sh) -lc /, ''), 160) };
  }
  if (type === 'file_change') return { who: 'Tool · edit', what: (it.changes || []).map(c => `${c.kind || 'update'} ${path.relative(ROOT, c.path || '') || c.path}`).join(', ') || 'files' };
  if (type === 'web_search') return { who: 'Tool · web search', what: short(it.query) };
  return null;
}
function summarizeResult(it) {
  const type = it.type || it.item_type;
  if (type === 'mcp_tool_call') {
    if (it.error) return { text: short(it.error.message || it.error), error: true };
    const r = it.result; let t = '';
    if (r && Array.isArray(r.content)) t = r.content.map(c => c.text || '').join(' ');
    else if (typeof r === 'string') t = r; else if (r) t = JSON.stringify(r.structured_content ?? r);
    try {
      const j = JSON.parse(t), b = [];
      if (j.label) b.push(j.label);
      if (j.stations) b.push(`${j.stations.length} gauge(s)` + (j.stations[0] ? `, nearest ${j.stations[0].name}${j.stations[0].distance_mi != null ? ' ' + j.stations[0].distance_mi + ' mi' : ''}` : '') + (j.nearest_outside_radius ? `; none in range, nearest ${j.nearest_outside_radius.name} ${j.nearest_outside_radius.distance_mi} mi` : ''));
      if (j.trend_mm_per_yr != null) b.push(`${j.name || j.station_id} ${j.period || ''}: ${j.trend_mm_per_yr >= 0 ? '+' : ''}${j.trend_mm_per_yr} ± ${j.ci95_mm_per_yr} mm/yr`);
      if (j.long_term_trend_mm_per_yr != null) b.push(`long-term ${j.long_term_trend_mm_per_yr} ± ${j.ci95_mm_per_yr} mm/yr (${j.record})`);
      if (j.peak_surge) b.push(`peak surge ${j.peak_surge.meters} m at ${j.peak_surge.time_gmt} GMT`);
      if (j.csv) b.push(j.csv); if (j.file) b.push(j.file); if (j.note) b.push(j.note);
      if (b.length) return { text: b.join(' · '), error: false };
    } catch { /* not JSON */ }
    return { text: short(t, 200) || (it.status || 'done'), error: /^Error/.test(t) || it.status === 'failed' };
  }
  if (type === 'command_execution') return { text: `exit ${it.exit_code ?? '?'}${it.aggregated_output ? ' · ' + short(it.aggregated_output, 160) : ''}`, error: it.exit_code ? it.exit_code !== 0 : false };
  if (type === 'file_change') return { text: it.status || 'done', error: it.status === 'failed' };
  return { text: it.status || 'done', error: false };
}

/** Same event contract as the Claude Code engine (start, thinking, tool, result, files, answer, done, error). */
export async function runTurn(question, opts = {}, onEvent) {
  let stale = false;
  const r = await runOnce(question, opts, ev => {
    if (opts.sessionId && ev.type === 'error' && /no rollout found|thread\/resume failed|(no|not) (session|conversation|thread)|unknown (session|thread)|could not find/i.test(ev.message)) { stale = true; return; }
    onEvent(ev);
  });
  if (!stale) return r;
  onEvent({ type: 'thinking', text: 'Previous conversation not found (folder moved?). Starting a new one.' });
  return runOnce(question, { ...opts, sessionId: undefined }, onEvent);
}
function runOnce(question, { sessionId, web = false, model = process.env.SEALEVEL_CODEX_MODEL } = {}, onEvent) {
  return new Promise(resolve => {
    const snap = snapshot();
    const note = web
      ? '[Context from the sealevel web app: files you save under outputs/ or data/ are shown to the user automatically; mention them by relative path. Prefer plot_sea_level for trend plots.]\n\n'
      : '[Context from the sealevel terminal app: mention every file you create by relative path.]\n\n';
    const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write', ...providerArgs(), ...MCP_OVERRIDES, ...(model ? ['-m', model] : [])];
    if (sessionId) args.push('resume', sessionId);
    args.push(note + question);
    let child;
    try { child = spawn(CODEX_BIN, args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { onEvent({ type: 'error', message: e.message }); return resolve(); }
    let buf = '', stderr = '', thread = sessionId, finalText = '', gotEnd = false, usage = null, this_ctx = false;
    const started = new Set(), sent = new Set();
    const pushFiles = () => { const f = changedSince(snap).filter(x => !sent.has(x.path + x.mtime)); f.forEach(x => sent.add(x.path + x.mtime)); if (f.length) onEvent({ type: 'files', files: f }); };
    child.on('error', e => onEvent({ type: 'error', message: e.code === 'ENOENT' ? `Codex CLI ("${CODEX_BIN}") not found. Install it with: npm install -g @openai/codex, then run \`codex\` once to sign in.` : e.message }));
    child.stderr.on('data', d => { stderr += d; });
    child.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type === 'thread.started') { thread = m.thread_id || thread; onEvent({ type: 'start', session_id: thread, mcp: ['noaa-tides (via -c)'], skills: [] }); }
        else if (m.type === 'item.started' && m.item) { const d = describeStart(m.item); if (d) { started.add(m.item.id); onEvent({ type: 'tool', ...d }); } }
        else if (m.type === 'item.completed' && m.item) {
          const it = m.item, type = it.type || it.item_type;
          if (type === 'agent_message' || type === 'assistant_message') finalText = it.text || finalText;
          else if (type === 'reasoning') { if (it.text) onEvent({ type: 'thinking', text: short(it.text.replace(/\*\*/g, ''), 300) }); }
          else if (type === 'error') onEvent({ type: 'thinking', text: 'note: ' + short(it.message, 200) });
          else if (type === 'todo_list') { /* plan updates: not shown */ }
          else {
            if (!started.has(it.id)) { const d = describeStart(it); if (d) onEvent({ type: 'tool', ...d }); }
            const r = summarizeResult(it); onEvent({ type: 'result', text: r.text, error: r.error });
            pushFiles();
          }
        }
        else if (m.type === 'turn.completed') { gotEnd = true; usage = m.usage || null; }
        else if (m.type === 'turn.failed') { gotEnd = true; onEvent({ type: 'error', message: m.error?.message || JSON.stringify(m.error || m) }); }
        else if (m.type === 'error') {
          const msg = m.message || '';
          if (/exceeds the available context size/i.test(msg)) { if (!this_ctx) { this_ctx = true; onEvent({ type: 'error', message: msg + ' — Codex is using a model with a small context window (usually a local Ollama/LM Studio model set in ~/.codex/config.toml). Run `sealevel codex doctor`, or pass --model with an OpenAI model.' }); } }
          else if (/^Reconnecting/i.test(msg)) onEvent({ type: 'thinking', text: short(msg, 160) });
          else onEvent({ type: 'error', message: msg });
        }
      }
    });
    child.on('close', code => {
      pushFiles();
      if (finalText) onEvent({ type: 'answer', text: finalText });
      else if (code && !gotEnd && !this_ctx) onEvent({ type: 'error', message: (stderr.split('\n').filter(l => /error|not logged|auth|login/i.test(l)).slice(-3).join(' ') || stderr || `codex exited with code ${code}`).trim().slice(0, 600) });
      onEvent({ type: 'done', session_id: thread, tokens: usage ? (usage.input_tokens || 0) + (usage.output_tokens || 0) : undefined, usage });
      resolve(thread);
    });
  });
}

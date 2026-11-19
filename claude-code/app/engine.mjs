/**
 * engine.mjs — runs one agent turn through Claude Code (the harness) in headless mode
 * and turns its stream-json output into simple events for the CLI and the web UI.
 *
 *   claude -p "<question>" --output-format stream-json --verbose
 *          --mcp-config .mcp.json --allowedTools ... [--resume <session>]
 *
 * Claude Code loads CLAUDE.md -> AGENTS.md, the skills in .claude/skills, and the
 * noaa-tides MCP server, exactly as in the interactive `claude` session.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLAUDE_BIN = process.env.SEALEVEL_CLAUDE_BIN || 'claude';

const ALLOWED = [
  'mcp__noaa-tides', 'Skill', 'Read', 'Glob', 'Grep', 'TodoWrite',
  'Write(outputs/**)', 'Edit(outputs/**)',
  'Bash(python3 outputs/scripts/*)', 'Bash(python outputs/scripts/*)', 'Bash(node outputs/scripts/*)',
  'Bash(mkdir -p outputs/*)', 'Bash(ls *)', 'Bash(head *)', 'Bash(pip3 show *)',
];

/* ---------- files the agent creates (shown automatically in the web UI) ---------- */
const WATCH = ['outputs', 'data'];
const SKIP = /^data\/(cache|builtin)\b|\/\.gitkeep$|^outputs\/scripts\/__pycache__/;
export function listFiles() {
  const out = [];
  const walk = rel => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel + '/' + e.name;
      if (SKIP.test(r) || e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(r);
      else { const st = fs.statSync(path.join(ROOT, r)); out.push({ path: r, size: st.size, mtime: st.mtimeMs, kind: kindOf(r) }); }
    }
  };
  WATCH.forEach(walk);
  return out.sort((a, b) => b.mtime - a.mtime);
}
export function kindOf(p) {
  const x = p.split('.').pop().toLowerCase();
  return { svg: 'image', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', csv: 'table', md: 'markdown', json: 'json', py: 'code', mjs: 'code', js: 'code', html: 'html', txt: 'text' }[x] || 'file';
}
const snapshot = () => new Map(listFiles().map(f => [f.path, f.mtime]));
const changedSince = snap => listFiles().filter(f => !snap.has(f.path) || snap.get(f.path) !== f.mtime);

/* ---------- short, human-readable step descriptions ---------- */
function describeTool(name, input = {}) {
  const n = name.replace(/^mcp__noaa-tides__/, '');
  const a = JSON.stringify(input);
  if (name.startsWith('mcp__')) return { who: 'MCP · noaa-tides', what: `${n}(${a.length > 140 ? a.slice(0, 140) + '…' : a})` };
  if (name === 'Skill') return { who: 'Skill', what: `load ${input.skill || input.name || a}` };
  if (name === 'Read' && /SKILL\.md$/.test(input.file_path || '')) return { who: 'Skill', what: 'read ' + path.relative(ROOT, input.file_path) };
  if (name === 'ToolSearch') return { who: 'Harness', what: 'load tool definitions: ' + String(input.query || '').replace(/^select:/, '').split(',').map(t => t.replace(/^mcp__noaa-tides__/, '')).join(', ') };
  if (name === 'Bash') return { who: 'Tool · Bash', what: input.command || a };
  if (name === 'Write' || name === 'Edit') return { who: 'Tool · ' + name, what: path.relative(ROOT, input.file_path || '') || a };
  return { who: 'Tool · ' + name, what: a.length > 160 ? a.slice(0, 160) + '…' : a };
}
function summarizeResult(content) {
  let t = Array.isArray(content) ? content.map(c => c.text || '').join(' ') : String(content ?? '');
  try { // MCP results are JSON: pull out the most useful fields
    const j = JSON.parse(t);
    const bits = [];
    if (j.label) bits.push(j.label);
    if (j.stations) bits.push(`${j.stations.length} gauge(s)` + (j.stations[0] ? `, nearest ${j.stations[0].name} ${j.stations[0].distance_mi ?? ''}${j.stations[0].distance_mi != null ? ' mi' : ''}` : '') + (j.nearest_outside_radius ? `; none in range, nearest ${j.nearest_outside_radius.name} ${j.nearest_outside_radius.distance_mi} mi` : ''));
    if (j.trend_mm_per_yr != null) bits.push(`${j.name || j.station_id} ${j.period || ''}: ${j.trend_mm_per_yr >= 0 ? '+' : ''}${j.trend_mm_per_yr} ± ${j.ci95_mm_per_yr} mm/yr`);
    if (j.long_term_trend_mm_per_yr != null) bits.push(`long-term ${j.long_term_trend_mm_per_yr} ± ${j.ci95_mm_per_yr} mm/yr (${j.record})`);
    if (j.peak_surge) bits.push(`peak surge ${j.peak_surge.meters} m at ${j.peak_surge.time_gmt} GMT`);
    if (j.csv) bits.push(j.csv);
    if (j.file) bits.push(j.file);
    if (j.source && !bits.length) bits.push(j.source);
    if (j.note) bits.push(j.note);
    if (bits.length) return bits.join(' · ');
  } catch { /* not JSON */ }
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) return 'done';
  return t.length > 200 ? t.slice(0, 200) + '…' : t;
}

/**
 * Run one question. onEvent receives:
 *  {type:'start', session_id, mcp, skills}  {type:'thinking', text}
 *  {type:'tool', who, what}  {type:'result', text, error}
 *  {type:'files', files:[...]}  {type:'answer', text}
 *  {type:'done', session_id, cost_usd, turns}  {type:'error', message}
 */
export async function runTurn(question, opts = {}, onEvent) {
  // A saved session id stops working if the folder was moved or copied (Claude Code
  // stores sessions per folder path). In that case start a fresh conversation.
  let stale = false;
  const r = await runOnce(question, opts, ev => {
    if (opts.sessionId && ev.type === 'error' && /no conversation found|session/i.test(ev.message)) { stale = true; return; }
    onEvent(ev);
  });
  if (!stale) return r;
  onEvent({ type: 'thinking', text: 'Previous conversation not found (folder moved?). Starting a new one.' });
  return runOnce(question, { ...opts, sessionId: undefined }, onEvent);
}
function runOnce(question, { sessionId, web = false } = {}, onEvent) {
  return new Promise(resolve => {
    const snap = snapshot();
    const sys = web
      ? 'You are answering inside the "sealevel web" page. Plots and files you save under outputs/ or data/ are displayed to the user automatically, so mention them by relative path instead of describing how to open them. Prefer plot_sea_level for trend plots.'
      : 'You are answering in the "sealevel" terminal app. Mention every file you create by relative path.';
    const args = ['-p', question, '--output-format', 'stream-json', '--verbose',
      '--mcp-config', path.join(ROOT, '.mcp.json'), '--strict-mcp-config',
      '--append-system-prompt', sys, '--allowedTools', ...ALLOWED];
    if (sessionId) args.push('--resume', sessionId);
    let child;
    try { child = spawn(CLAUDE_BIN, args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { onEvent({ type: 'error', message: e.message }); return resolve(); }
    const toolNames = {}; let buf = '', stderr = '', gotResult = false, session = sessionId, sentFiles = new Set(), finalText = '';
    const pushFiles = () => { const f = changedSince(snap).filter(x => !sentFiles.has(x.path + x.mtime)); f.forEach(x => sentFiles.add(x.path + x.mtime)); if (f.length) onEvent({ type: 'files', files: f }); };
    child.on('error', e => { onEvent({ type: 'error', message: e.code === 'ENOENT' ? `Claude Code ("${CLAUDE_BIN}") not found. Install it with: npm install -g @anthropic-ai/claude-code` : e.message }); });
    child.stderr.on('data', d => { stderr += d; });
    child.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type === 'system' && m.subtype === 'init') {
          session = m.session_id;
          onEvent({ type: 'start', session_id: m.session_id, mcp: (m.mcp_servers || []).map(s => `${s.name}: ${s.status}`), skills: (m.skills || []).filter(s => !s.includes(':')).slice(0, 12) });
        } else if (m.type === 'assistant') {
          const blocks = m.message?.content || [];
          const hasTool = blocks.some(b => b.type === 'tool_use');
          for (const b of blocks) {
            if (b.type === 'text' && b.text.trim()) { if (hasTool) onEvent({ type: 'thinking', text: b.text.trim() }); else finalText = b.text; }
            if (b.type === 'tool_use') { toolNames[b.id] = b.name; onEvent({ type: 'tool', ...describeTool(b.name, b.input) }); }
          }
        } else if (m.type === 'user') {
          for (const b of m.message?.content || []) if (b.type === 'tool_result') { onEvent({ type: 'result', text: summarizeResult(b.content), error: !!b.is_error }); }
          pushFiles();
        } else if (m.type === 'result') {
          gotResult = true;
          session = m.session_id || session;
          if (m.is_error || (m.subtype && m.subtype !== 'success')) onEvent({ type: 'error', message: m.result || m.subtype });
          else onEvent({ type: 'answer', text: m.result || finalText });
          pushFiles();
          onEvent({ type: 'done', session_id: session, cost_usd: m.total_cost_usd, turns: m.num_turns });
        }
      }
    });
    child.on('close', code => {
      if (code && !gotResult) onEvent({ type: 'error', message: (stderr || `claude exited with code ${code}`).trim().slice(0, 600) });
      resolve(session);
    });
  });
}

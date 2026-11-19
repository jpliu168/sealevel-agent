#!/usr/bin/env node
/**
 * sealevel — command-line front end for the MEAS sea-level agent.
 *
 *   sealevel                      interactive chat in the terminal
 *   sealevel ask "question"       one question, then exit   (--continue to follow up)
 *   sealevel web [--port 8765]    open the web version in your browser
 *   sealevel claude               open the full Claude Code session in this folder
 *   sealevel files                list plots and data the agent has created
 *   sealevel doctor               check Node, Claude Code, the MCP server, and NOAA
 *
 * Every question runs through Claude Code (the harness) with AGENTS.md, the skills
 * in .claude/skills, and the noaa-tides MCP server in mcp/.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, CLAUDE_BIN, runTurn, listFiles } from '../app/engine.mjs';

const tty = process.stdout.isTTY;
const c = (code, s) => tty ? `\x1b[${code}m${s}\x1b[0m` : s;
const dim = s => c('2', s), bold = s => c('1', s), green = s => c('32', s), blue = s => c('34', s), violet = s => c('35', s), red = s => c('31', s), cyan = s => c('36', s);
const SESSION_FILE = path.join(ROOT, '.sealevel_session');

function printEvent(ev, quiet) {
  switch (ev.type) {
    case 'start': if (!quiet) console.log(dim(`harness: Claude Code · MCP ${ev.mcp.join(', ') || 'none'}`)); break;
    case 'thinking': if (!quiet) console.log(dim('agent: ' + ev.text.replace(/\n+/g, ' '))); break;
    case 'tool': {
      if (quiet) break;
      const col = /^MCP/.test(ev.who) ? green : /^Skill/.test(ev.who) ? violet : blue;
      console.log(col('▸ ' + ev.who) + ' ' + dim(ev.what)); break;
    }
    case 'result': if (!quiet) console.log((ev.error ? red : dim)('   ↳ ' + ev.text)); break;
    case 'files': for (const f of ev.files) console.log(cyan(`  📄 ${f.path}`) + dim(`  (${f.kind}${f.kind === 'image' ? ' — open with: open ' + f.path : ''})`)); break;
    case 'answer': console.log('\n' + renderMarkdown(ev.text) + '\n'); break;
    case 'error': console.log(red('Error: ' + ev.message)); break;
    case 'done': if (ev.session_id) fs.writeFileSync(SESSION_FILE, ev.session_id);
      console.log(dim([ev.turns ? `${ev.turns} model turns` : '', ev.cost_usd != null ? `$${ev.cost_usd.toFixed(3)}` : ''].filter(Boolean).join(' · '))); break;
  }
}
function renderMarkdown(t) { // light terminal formatting
  return String(t || '').replace(/^#{1,4}\s+(.*)$/gm, (m, h) => bold(h)).replace(/\*\*(.+?)\*\*/g, (m, b) => bold(b)).replace(/`([^`]+)`/g, (m, x) => cyan(x));
}

async function ask(question, { cont = false, quiet = false } = {}) {
  const sessionId = cont && fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, 'utf8').trim() : undefined;
  return runTurn(question, { sessionId }, ev => printEvent(ev, quiet));
}

async function chat() {
  console.log(bold('sealevel') + dim(' — ask about sea level at any US tide gauge. Commands: /new  /files  /web  /quit'));
  let session;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: bold('\nyou › ') });
  rl.prompt();
  for await (const line of rl) {
    const q = line.trim();
    if (!q) { rl.prompt(); continue; }
    if (q === '/quit' || q === '/exit') break;
    if (q === '/new') { session = undefined; console.log(dim('new conversation')); rl.prompt(); continue; }
    if (q === '/files') { files(); rl.prompt(); continue; }
    if (q === '/web') { console.log(dim('run: sealevel web')); rl.prompt(); continue; }
    rl.pause();
    session = await runTurn(q, { sessionId: session }, ev => printEvent(ev, false)) || session;
    rl.resume(); rl.prompt();
  }
  rl.close();
}

function files() {
  const f = listFiles();
  if (!f.length) return console.log(dim('no files yet'));
  for (const x of f) console.log(`${x.kind.padEnd(8)} ${x.path}  ${dim(new Date(x.mtime).toLocaleString())}`);
}

async function web(args) {
  const i = args.indexOf('--port'); const port = i >= 0 ? +args[i + 1] : 8765;
  const { startServer } = await import('../app/server.mjs');
  let s; for (let p = port; p < port + 20; p++) { try { s = await startServer({ port: p }); break; } catch (e) { if (e.code !== 'EADDRINUSE') throw e; } }
  console.log(bold('sealevel web') + ' running at ' + cyan(s.url) + dim('  (Ctrl-C to stop)'));
  if (!args.includes('--no-open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const a = process.platform === 'win32' ? ['/c', 'start', s.url] : [s.url];
    try { spawn(opener, a, { stdio: 'ignore', detached: true }).unref(); } catch { /* open manually */ }
  }
}

async function doctor() {
  const ok = m => console.log(green('✔ ') + m), bad = m => console.log(red('✘ ') + m);
  const major = +process.versions.node.split('.')[0];
  (major >= 18 ? ok : bad)(`Node ${process.versions.node}` + (major >= 18 ? '' : ' (need 18+)'));
  const v = spawnSync(CLAUDE_BIN, ['--version'], { encoding: 'utf8' });
  v.status === 0 ? ok(`Claude Code ${v.stdout.trim().split('\n')[0].slice(0, 80)}`) : bad('Claude Code not found — install: npm install -g @anthropic-ai/claude-code, then run `claude` once to sign in');
  for (const f of ['AGENTS.md', 'CLAUDE.md', '.mcp.json']) (fs.existsSync(path.join(ROOT, f)) ? ok : bad)(f + (f === '.mcp.json' && !fs.existsSync(path.join(ROOT, f)) ? ' missing' : ''));
  const sk = path.join(ROOT, '.claude', 'skills');
  const skills = fs.existsSync(sk) ? fs.readdirSync(sk).filter(d => fs.existsSync(path.join(sk, d, 'SKILL.md'))) : [];
  (skills.length ? ok : bad)(`skills: ${skills.join(', ') || 'none found in .claude/skills'}`);
  // MCP server: initialize + tools/list
  const mcp = spawnSync('node', [path.join(ROOT, '..', 'shared', 'mcp', 'noaa-tides-server.mjs')], { cwd: ROOT, input: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n', encoding: 'utf8', timeout: 10000 });
  try { const tools = JSON.parse(mcp.stdout.trim().split('\n')[1]).result.tools.map(t => t.name); ok(`MCP server noaa-tides: ${tools.length} tools`); } catch { bad('MCP server did not respond: ' + (mcp.stderr || '').slice(0, 200)); }
  try { const r = await fetch('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/8651370.json', { signal: AbortSignal.timeout(8000) }); (r.ok ? ok : bad)('NOAA API reachable' + (r.ok ? '' : ' (HTTP ' + r.status + ')')); }
  catch { bad('NOAA API not reachable — the agent will use built-in data (27 gauges, 2016–2025)'); }
}

const argv = process.argv.slice(2), pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--port');
const [cmd] = pos, rest = cmd ? argv.slice(argv.indexOf(cmd) + 1) : argv;
const usage = `${bold('sealevel')} — MEAS sea-level agent

  sealevel                     chat in the terminal
  sealevel ask "question"      ask one question  (--continue: follow up on the last one, --quiet: answer only)
  sealevel web [--port N]      web version with plots and data shown in the page
  sealevel claude              full Claude Code session in this folder
  sealevel files               list plots and data the agent created
  sealevel doctor              check the setup`;
(async () => {
  if (!cmd) return chat();
  if (cmd === 'ask') { const q = rest.filter(a => !a.startsWith('--')).join(' '); if (!q) return console.log(usage); return ask(q, { cont: rest.includes('--continue'), quiet: rest.includes('--quiet') }); }
  if (cmd === 'web') return web(rest);
  if (cmd === 'claude') return spawn(CLAUDE_BIN, rest, { cwd: ROOT, stdio: 'inherit' }).on('exit', code => process.exit(code ?? 0));
  if (cmd === 'files') return files();
  if (cmd === 'doctor') return doctor();
  console.log(usage);
})().catch(e => { console.error(red(e.stack || e.message)); process.exit(1); });

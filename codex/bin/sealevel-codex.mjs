#!/usr/bin/env node
/**
 * sealevel-codex — command-line front end for the MEAS sea-level agent on OpenAI Codex.
 *
 *   sealevel-codex                      interactive chat in the terminal
 *   sealevel-codex ask "question"       one question, then exit   (--continue to follow up)
 *   sealevel-codex web [--port 8767]    open the web version in your browser
 *   sealevel-codex codex                open the full interactive Codex session in this folder
 *   sealevel-codex files                list plots and data the agent has created
 *   sealevel-codex doctor               check Node, Codex, skills, the MCP server, and NOAA
 *   option: --model NAME                use a specific OpenAI model
 *
 * Every question runs through OpenAI Codex (the harness), which reads AGENTS.md and the
 * skills in .agents/skills; the shared noaa-tides MCP server is passed with -c overrides.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, CODEX_BIN, MCP_OVERRIDES, providerArgs, runTurn, listFiles } from '../app/engine.mjs';
import os from 'node:os';

const tty = process.stdout.isTTY;
const c = (code, s) => tty ? `\x1b[${code}m${s}\x1b[0m` : s;
const yellow = s => c('33', s);
const dim = s => c('2', s), bold = s => c('1', s), green = s => c('32', s), blue = s => c('34', s), violet = s => c('35', s), red = s => c('31', s), cyan = s => c('36', s);
const SESSION_FILE = path.join(ROOT, '.sealevel_session');
const MODEL = (() => { const a = process.argv.indexOf('--model'); return a >= 0 ? process.argv[a + 1] : undefined; })();
if (MODEL) process.env.SEALEVEL_CODEX_MODEL = MODEL; // also used by the web version

function printEvent(ev, quiet) {
  switch (ev.type) {
    case 'start': if (!quiet) console.log(dim(`harness: Codex · thread ${String(ev.session_id || '').slice(0, 8)} · MCP noaa-tides`)); break;
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
      console.log(dim(ev.usage ? `${ev.usage.input_tokens || 0} input · ${ev.usage.output_tokens || 0} output tokens` : '')); break;
  }
}
function renderMarkdown(t) { // light terminal formatting
  return String(t || '').replace(/^#{1,4}\s+(.*)$/gm, (m, h) => bold(h)).replace(/\*\*(.+?)\*\*/g, (m, b) => bold(b)).replace(/`([^`]+)`/g, (m, x) => cyan(x));
}

async function ask(question, { cont = false, quiet = false } = {}) {
  const sessionId = cont && fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, 'utf8').trim() : undefined;
  return runTurn(question, { sessionId, model: MODEL }, ev => printEvent(ev, quiet));
}

async function chat() {
  console.log(bold('sealevel-codex') + dim(' — ask about sea level at any US tide gauge (OpenAI Codex). Commands: /new  /files  /quit'));
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
    session = await runTurn(q, { sessionId: session, model: MODEL }, ev => printEvent(ev, false)) || session;
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
  const i = args.indexOf('--port'); const port = i >= 0 ? +args[i + 1] : 8767;
  const { startServer } = await import('../app/server.mjs');
  let s; for (let p = port; p < port + 20; p++) { try { s = await startServer({ port: p }); break; } catch (e) { if (e.code !== 'EADDRINUSE') throw e; } }
  console.log(bold('sealevel web (Codex)') + ' running at ' + cyan(s.url) + dim('  (Ctrl-C to stop)'));
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
  const v = spawnSync(CODEX_BIN, ['--version'], { encoding: 'utf8' });
  v.status === 0 ? ok(`Codex CLI ${v.stdout.trim().split('\n')[0].replace(/^codex-cli\s*/, '').slice(0, 80)}`) : bad('Codex CLI not found — install: npm install -g @openai/codex, then run `codex` once to sign in (ChatGPT account or API key)');
  if (v.status === 0) { const l = spawnSync(CODEX_BIN, ['login', 'status'], { encoding: 'utf8', timeout: 10000 }); const t = (l.stdout + l.stderr).trim().split('\n').pop() || ''; (l.status === 0 ? ok : bad)('Codex sign-in: ' + (t || (l.status === 0 ? 'ok' : 'not signed in — run `codex login`'))); }
  // which model provider will Codex use?
  const cfgPath = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
  if (fs.existsSync(cfgPath)) {
    const cfg = fs.readFileSync(cfgPath, 'utf8'), top = cfg.split(/^\[/m)[0];
    const prov = (top.match(/^\s*model_provider\s*=\s*"([^"]+)"/m) || [])[1], mdl = (top.match(/^\s*model\s*=\s*"([^"]+)"/m) || [])[1], oss = /^\s*oss\s*=\s*true/m.test(top), prof = (top.match(/^\s*profile\s*=\s*"([^"]+)"/m) || [])[1];
    const local = oss || /ollama|lmstudio|oss/i.test(prov || '') || /ollama|lmstudio/i.test(prof || '');
    const pa = providerArgs();
    if (local) console.log(yellow('! ') + `your ~/.codex/config.toml uses a local model (${[prov && 'provider ' + prov, mdl && 'model ' + mdl, prof && 'profile ' + prof, oss && 'oss'].filter(Boolean).join(', ')}). ` + (pa.length ? 'This app overrides it to use OpenAI cloud models (' + pa.filter(x => x !== '-c').join(' ') + ').' : 'SEALEVEL_CODEX_USE_USER_CONFIG=1 is set, so that local model will be used.'));
    else ok(`Codex model: ${mdl || 'Codex default'}${prov ? ' via ' + prov : ''}` + (pa.length ? ' (app uses OpenAI cloud models: ' + pa.filter(x => x !== '-c').join(' ') + ')' : ''));
  } else ok('Codex model: Codex default (no ~/.codex/config.toml)');
  (fs.existsSync(path.join(ROOT, 'AGENTS.md')) ? ok : bad)('AGENTS.md');
  (fs.existsSync(path.join(ROOT, '.codex', 'config.toml')) ? ok : bad)('.codex/config.toml (used by the interactive `codex` session once you trust the folder)');
  const sk = path.join(ROOT, '.agents', 'skills');
  const skills = fs.existsSync(sk) ? fs.readdirSync(sk).filter(d => fs.existsSync(path.join(sk, d, 'SKILL.md'))) : [];
  (skills.length ? ok : bad)(`skills: ${skills.join(', ') || 'none found in .agents/skills'}`);
  if (v.status === 0) { const m = spawnSync(CODEX_BIN, ['mcp', 'list', ...MCP_OVERRIDES], { cwd: ROOT, encoding: 'utf8', timeout: 15000 }); (/noaa-tides/.test(m.stdout) ? ok : bad)('Codex sees MCP server noaa-tides' + (/noaa-tides/.test(m.stdout) ? '' : ': ' + (m.stderr || m.stdout).trim().slice(0, 200))); }
  // MCP server: initialize + tools/list
  const mcp = spawnSync('node', [path.join(ROOT, '..', 'shared', 'mcp', 'noaa-tides-server.mjs')], { cwd: ROOT, input: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n', encoding: 'utf8', timeout: 10000 });
  try { const tools = JSON.parse(mcp.stdout.trim().split('\n')[1]).result.tools.map(t => t.name); ok(`MCP server noaa-tides: ${tools.length} tools`); } catch { bad('MCP server did not respond: ' + (mcp.stderr || '').slice(0, 200)); }
  try { const r = await fetch('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/8651370.json', { signal: AbortSignal.timeout(8000) }); (r.ok ? ok : bad)('NOAA API reachable' + (r.ok ? '' : ' (HTTP ' + r.status + ')')); }
  catch { bad('NOAA API not reachable — the agent will use built-in data (27 gauges, 2016–2025)'); }
}

const argv = process.argv.slice(2), pos = argv.filter((a, i) => !a.startsWith('--') && !['--model', '--port'].includes(argv[i - 1]));
const [cmd] = pos, rest = argv.slice(argv.indexOf(cmd) + 1);
const usage = `${bold('sealevel-codex')} — MEAS sea-level agent on OpenAI Codex

  sealevel-codex                     chat in the terminal
  sealevel-codex ask "question"      ask one question  (--continue: follow up, --quiet: answer only)
  sealevel-codex web [--port N]      web version with plots and data shown in the page
  sealevel-codex codex               full interactive Codex session in this folder
  sealevel-codex files               list plots and data the agent created
  sealevel-codex doctor              check the setup
  option: --model NAME`;
(async () => {
  if (!cmd) return chat();
  if (cmd === 'ask') { const q = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--model').join(' '); if (!q) return console.log(usage); return ask(q, { cont: rest.includes('--continue'), quiet: rest.includes('--quiet') }); }
  if (cmd === 'web') return web(rest);
  if (cmd === 'codex') return spawn(CODEX_BIN, [...MCP_OVERRIDES, ...rest], { cwd: ROOT, stdio: 'inherit' }).on('exit', code => process.exit(code ?? 0));
  if (cmd === 'files') return files();
  if (cmd === 'doctor') return doctor();
  console.log(usage);
})().catch(e => { console.error(red(e.stack || e.message)); process.exit(1); });

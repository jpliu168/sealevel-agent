#!/usr/bin/env node
/**
 * sealevel-local — the sea-level agent running on a LOCAL model through Ollama.
 * No Claude Code and no cloud AI: app/agent.mjs is the harness.
 *
 *   sealevel-local                         chat in the terminal
 *   sealevel-local ask "question"          one question
 *   sealevel-local web [--port 8766]       web version (plots and data in the page)
 *   sealevel-local models                  list installed Ollama models
 *   sealevel-local doctor                  check Ollama, the model, and the MCP server
 *
 * Options: --model qwen3.5:9b   --think on|off
 */
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { runTurn, listFiles, listModels, mcp, DEFAULT_MODEL, OLLAMA } from '../app/agent.mjs';

const tty = process.stdout.isTTY;
const c = (k, s) => tty ? `\x1b[${k}m${s}\x1b[0m` : s;
const dim = s => c('2', s), bold = s => c('1', s), green = s => c('32', s), violet = s => c('35', s), red = s => c('31', s), cyan = s => c('36', s);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const MODEL = opt('model', DEFAULT_MODEL);
const THINK = opt('think') === 'on' ? true : opt('think') === 'off' ? false : undefined;
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--model', '--think', '--port'].includes(args[i - 1])));

let streaming = false, streamed = '';
function printEvent(ev, quiet) {
  if (ev.type !== 'delta' && streaming) { process.stdout.write('\n'); streaming = false; }
  switch (ev.type) {
    case 'start': if (!quiet) console.log(dim(`harness: local · model ${ev.model} · MCP ${ev.mcp.join(', ')} · skills: ${ev.skills.join(', ')}`)); break;
    case 'thinking': if (!quiet) console.log(dim((ev.reasoning ? 'model reasoning: ' : 'agent: ') + ev.text.replace(/\n+/g, ' ').slice(0, 300))); break;
    case 'tool': if (!quiet) console.log((ev.who === 'Skill' ? violet : green)('▸ ' + ev.who) + ' ' + dim(ev.what)); break;
    case 'result': if (!quiet) console.log((ev.error ? red : dim)('   ↳ ' + ev.text)); break;
    case 'files': for (const f of ev.files) console.log(cyan(`  📄 ${f.path}`) + dim(` (${f.kind})`)); break;
    case 'delta': if (!quiet && !/<tool_call>/.test(streamed + ev.text)) { if (!streaming) { process.stdout.write('\n'); streaming = true; } process.stdout.write(ev.text); } streamed += ev.text; break;
    case 'reset_delta': streamed = ''; break;
    case 'answer': if (quiet || streamed.trim() !== String(ev.text).trim()) console.log('\n' + String(ev.text).replace(/\*\*(.+?)\*\*/g, (m, b) => bold(b))); console.log(''); streamed = ''; break;
    case 'error': console.log(red('Error: ' + ev.message)); break;
    case 'done': console.log(dim(`${ev.model} · ${ev.seconds} s · ${ev.tokens} tokens · local`)); break;
  }
}

async function chat() {
  console.log(bold('sealevel-local') + dim(` — model ${MODEL} via Ollama. Commands: /new  /files  /quit`));
  let history = [];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: bold('\nyou › ') });
  rl.prompt();
  for await (const line of rl) {
    const q = line.trim();
    if (!q) { rl.prompt(); continue; }
    if (q === '/quit' || q === '/exit') break;
    if (q === '/new') { history = []; console.log(dim('new conversation')); rl.prompt(); continue; }
    if (q === '/files') { listFiles().forEach(f => console.log(`${f.kind.padEnd(7)} ${f.path}`)); rl.prompt(); continue; }
    rl.pause();
    history = await runTurn(q, { history, model: MODEL, think: THINK }, ev => printEvent(ev, false));
    rl.resume(); rl.prompt();
  }
  rl.close(); process.exit(0);
}

async function web() {
  const port = +(opt('port', 8766));
  const { startServer } = await import('../app/server.mjs');
  let s; for (let p = port; p < port + 20; p++) { try { s = await startServer({ port: p }); break; } catch (e) { if (e.code !== 'EADDRINUSE') throw e; } }
  console.log(bold('sealevel web (local)') + ' at ' + cyan(s.url) + dim(`  · Ollama ${OLLAMA} · Ctrl-C to stop`));
  if (!args.includes('--no-open')) { const o = process.platform === 'darwin' ? 'open' : 'xdg-open'; try { spawn(o, [s.url], { stdio: 'ignore', detached: true }).unref(); } catch { } }
}

async function doctor() {
  const ok = m => console.log(green('✔ ') + m), bad = m => console.log(red('✘ ') + m);
  const major = +process.versions.node.split('.')[0]; (major >= 18 ? ok : bad)(`Node ${process.versions.node}`);
  let models = [];
  try { models = await listModels(); ok(`Ollama running at ${OLLAMA} (${models.length} models)`); } catch (e) { bad(`Ollama not reachable at ${OLLAMA}: start the Ollama app or run "ollama serve"`); }
  if (models.length) (models.includes(MODEL) ? ok : bad)(`model ${MODEL}` + (models.includes(MODEL) ? ' installed' : ` not installed: ollama pull ${MODEL}`));
  try { const m = await mcp(); ok(`MCP server noaa-tides: ${m.tools.length} tools`); m.stop(); } catch (e) { bad('MCP server: ' + e.message); }
  try { const r = await fetch('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/8651370.json', { signal: AbortSignal.timeout(8000) }); (r.ok ? ok : bad)('NOAA API reachable'); }
  catch { bad('NOAA API not reachable: the agent will use built-in data (27 gauges, 2016–2025)'); }
  if (models.includes(MODEL)) {
    process.stdout.write(dim('Testing tool calling with ' + MODEL + ' … '));
    try {
      const r = await fetch(OLLAMA + '/api/chat', { method: 'POST', body: JSON.stringify({ model: MODEL, stream: false, think: false, messages: [{ role: 'user', content: 'Call the ping tool.' }], tools: [{ type: 'function', function: { name: 'ping', description: 'test', parameters: { type: 'object', properties: {} } } }] }) });
      const lines = (await r.text()).trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return {}; } });
      const err = lines.find(j => j.error), called = lines.some(j => j.message?.tool_calls?.length);
      if (err) console.log(red(err.error)); else console.log(called ? green('tool call OK') : red('model answered without calling the tool (tool calling may be unreliable)'));
    } catch (e) { console.log(red(e.message)); }
  }
  process.exit(0);
}

const usage = `${bold('sealevel-local')} — sea-level agent on a local Ollama model

  sealevel-local                      chat in the terminal
  sealevel-local ask "question"       ask one question
  sealevel-local web [--port 8766]    web version with plots and data
  sealevel-local models               installed Ollama models
  sealevel-local doctor               check the setup

  options: --model ${DEFAULT_MODEL}   --think on|off`;
const [cmd, ...rest] = positional;
(async () => {
  if (!cmd) return chat();
  if (cmd === 'ask') { const q = rest.join(' '); if (!q) return console.log(usage); await runTurn(q, { model: MODEL, think: THINK }, ev => printEvent(ev, args.includes('--quiet'))); process.exit(0); }
  if (cmd === 'web') return web();
  if (cmd === 'models') { try { (await listModels()).forEach(m => console.log((m === DEFAULT_MODEL ? '* ' : '  ') + m)); } catch (e) { console.log(red('Ollama not reachable: ' + e.message)); } return; }
  if (cmd === 'doctor') return doctor();
  console.log(usage);
})().catch(e => { console.error(red(e.stack || e.message)); process.exit(1); });

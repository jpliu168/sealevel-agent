#!/usr/bin/env node
/**
 * sealevel — one command for both versions of the sea-level agent.
 *
 *   sealevel                        menu: pick Claude Code or a local model, then web or terminal
 *   sealevel claude web             skip the menu (engine: claude | codex | ollama; mode: web | chat | doctor)
 *   sealevel ollama chat --model granite4.1:8b
 *   sealevel claude ask "How has sea level changed at Duck, NC?"
 *
 * It only starts the right program: claude-code/bin/sealevel.mjs, codex/bin/sealevel-codex.mjs,
 * or ollama/bin/sealevel-local.mjs.
 */
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tty = process.stdout.isTTY;
const c = (k, s) => tty ? `\x1b[${k}m${s}\x1b[0m` : s;
const bold = s => c('1', s), dim = s => c('2', s), green = s => c('32', s), red = s => c('31', s), cyan = s => c('36', s);

const ENGINES = {
  claude: { label: 'Claude Code (cloud, most capable)', dir: 'claude-code', script: 'bin/sealevel.mjs' },
  codex: { label: 'OpenAI Codex (cloud, ChatGPT or OpenAI account)', dir: 'codex', script: 'bin/sealevel-codex.mjs' },
  ollama: { label: 'Local model via Ollama (private, free, slower)', dir: 'ollama', script: 'bin/sealevel-local.mjs' },
};
const MODES = { web: 'Web page (plots and data in the browser)', chat: 'Terminal chat', doctor: 'Check the setup' };
const ALIAS = { local: 'ollama', 'claude-code': 'claude', cc: 'claude', openai: 'codex', cli: 'chat', terminal: 'chat', check: 'doctor' };
const OLLAMA = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '').replace(/^(?!https?:)/, 'http://');
const DEFAULT_MODEL = process.env.SEALEVEL_MODEL || 'qwen3.5:9b';

function claudeStatus() {
  const v = spawnSync(process.env.SEALEVEL_CLAUDE_BIN || 'claude', ['--version'], { encoding: 'utf8', timeout: 8000 });
  return v.status === 0 ? { ok: true, text: 'installed ' + v.stdout.trim().split('\n')[0].replace(/\s*\(Claude Code\)/, '') } : { ok: false, text: 'not found (npm install -g @anthropic-ai/claude-code)' };
}
function codexStatus() {
  const v = spawnSync(process.env.SEALEVEL_CODEX_BIN || 'codex', ['--version'], { encoding: 'utf8', timeout: 8000 });
  return v.status === 0 ? { ok: true, text: 'installed ' + v.stdout.trim().split('\n')[0].replace(/^codex-cli\s*/, '') } : { ok: false, text: 'not found (npm install -g @openai/codex)' };
}
async function ollamaStatus() {
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(2000) });
    const models = (await r.json()).models.map(m => m.name);
    return { ok: true, models, text: `running, ${models.length} model${models.length === 1 ? '' : 's'}` };
  } catch { return { ok: false, models: [], text: 'not running (start the Ollama app)' }; }
}

/* line reader that also works when answers are piped in (keeps lines that arrive early) */
function lineReader() {
  const rl = readline.createInterface({ input: process.stdin }); const queue = []; const waiting = []; let closed = false;
  rl.on('line', l => waiting.length ? waiting.shift()(l) : queue.push(l));
  rl.on('close', () => { closed = true; while (waiting.length) waiting.shift()(''); });
  return { question(q) { process.stdout.write(q); if (queue.length) { const l = queue.shift(); if (!tty) console.log(l); return Promise.resolve(l); } if (closed) { console.log(''); return Promise.resolve(''); } return new Promise(r => waiting.push(l => { if (!tty) console.log(l); r(l); })); }, close() { rl.close(); } };
}
async function pick(rl, title, options, def) { // options: [[key, label, note?]]
  console.log('\n' + bold(title));
  options.forEach(([, label, note], i) => console.log(`  ${cyan(String(i + 1))}) ${label}${note ? '  ' + note : ''}`));
  const d = Math.max(0, options.findIndex(o => o[0] === def));
  for (;;) {
    const a = (await rl.question(`Choose [${d + 1}]: `)).trim();
    if (!a) return options[d][0];
    const n = +a; if (n >= 1 && n <= options.length) return options[n - 1][0];
    const k = options.find(o => o[0] === (ALIAS[a] || a)); if (k) return k[0];
    console.log(red('  Please type a number from the list.'));
  }
}

(async () => {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(`${bold('sealevel')} — NC State MEAS sea-level agent

  sealevel                         menu
  sealevel <engine> <mode>         engine: claude | codex | ollama     mode: web | chat | doctor
  sealevel <engine> ask "question"
  options: --model NAME (codex, ollama)   --think on|off (ollama)
  any other options are passed to the version's own command (e.g. --port 9000)`);
    return;
  }
  const pos = [], rest = [];
  for (let i = 0; i < args.length; i++) { const a = args[i]; if (a.startsWith('--')) { rest.push(a); if (args[i + 1] && !args[i + 1].startsWith('--') && ['--model', '--think', '--port'].includes(a)) rest.push(args[++i]); } else pos.push(a); }
  let engine = ALIAS[pos[0]] || pos[0], mode = ALIAS[pos[1]] || pos[1];
  const question = mode === 'ask' ? pos.slice(2).join(' ') : '';
  if (engine && !ENGINES[engine]) { console.log(red(`Unknown engine "${engine}". Use claude, codex, or ollama.`)); process.exit(1); }
  if (mode && !MODES[mode] && mode !== 'ask') { console.log(red(`Unknown mode "${mode}". Use web, chat, doctor, or ask.`)); process.exit(1); }

  let rl = null;
  if (!engine || !mode) {
    rl = lineReader();
    console.log(bold('sealevel') + dim(' — ask about sea level at any US tide gauge (NOAA data)'));
  }
  let ost = null;
  if (!engine) {
    process.stdout.write(dim('checking what is available… '));
    const cs = claudeStatus(), xs = codexStatus(); ost = await ollamaStatus(); process.stdout.write('\r' + ' '.repeat(40) + '\r');
    const mark = s => (s.ok ? green('✔ ') : red('✘ ')) + dim(s.text);
    engine = await pick(rl, 'Which AI should answer?', [
      ['claude', ENGINES.claude.label, mark(cs)],
      ['codex', ENGINES.codex.label, mark(xs)],
      ['ollama', ENGINES.ollama.label, mark(ost)],
    ], cs.ok ? 'claude' : xs.ok ? 'codex' : ost.ok ? 'ollama' : 'claude');
  }
  if (!mode) mode = await pick(rl, 'How do you want to use it?', Object.entries(MODES).map(([k, v]) => [k, v]), 'web');

  // local model: offer the installed models (unless --model was given)
  if (engine === 'ollama' && !rest.includes('--model') && mode !== 'doctor' && rl) {
    ost = ost || await ollamaStatus();
    if (ost.ok && ost.models.length > 1) {
      const def = ost.models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : ost.models[0];
      const m = await pick(rl, 'Which local model? ' + dim('(it must support tool calling)'), ost.models.map(n => [n, n, n === DEFAULT_MODEL ? dim('recommended') : '']), def);
      rest.push('--model', m);
    } else if (!ost.ok) console.log(red('\nOllama is not running.') + ' Start the Ollama app (or run `ollama serve`), then try again.');
  }
  if (rl) rl.close();

  const E = ENGINES[engine], cwd = path.join(ROOT, E.dir), script = path.join(cwd, E.script);
  if (!fs.existsSync(script)) { console.log(red('Missing ' + path.relative(ROOT, script))); process.exit(1); }
  const childArgs = mode === 'chat' ? [] : mode === 'ask' ? ['ask', question] : [mode];
  console.log(dim(`\n→ ${E.dir}: node ${E.script} ${[...childArgs, ...rest].join(' ')}\n`));
  const mi = rest.indexOf('--model');
  const env = { ...process.env, ...(engine === 'ollama' && mi >= 0 ? { SEALEVEL_MODEL: rest[mi + 1] } : {}) }; // also the web page's default model
  const child = spawn(process.execPath, [script, ...childArgs, ...rest], { cwd, stdio: 'inherit', env });
  child.on('exit', code => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
})().catch(e => { console.error(red(e.stack || e.message)); process.exit(1); });

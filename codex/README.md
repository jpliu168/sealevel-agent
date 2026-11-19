# Sea-level agent — OpenAI Codex version

The same agent with **OpenAI Codex CLI** as the harness and an OpenAI model as
the brain. It uses the shared `noaa-tides` MCP server and the **same six skills**
as the Claude Code version: `SKILL.md` is an open format that both tools read.

| Piece | Where |
|---|---|
| **Harness** | Codex CLI (`codex`; this app runs `codex exec --json`) |
| **Agent instructions** | `AGENTS.md` (Codex reads it natively, no `CLAUDE.md` needed) |
| **Skills** | `.agents/skills/*/SKILL.md` (identical to `claude-code/.claude/skills/`) |
| **MCP server** | `../shared/mcp/noaa-tides-server.mjs`, in `.codex/config.toml` and passed with `-c` |
| **Front ends** | `sealevel codex web`, `sealevel codex chat`, or `codex` itself |

## Requirements

- Node 18+
- Codex CLI: `npm install -g @openai/codex`, then run `codex` once to sign in
  with a ChatGPT plan or an OpenAI API key. Questions use that account.
- Optional, for skills that make their own plots: `pip3 install matplotlib pandas`

## Run

```
sealevel codex web         # from anywhere, after `npm install -g .` at the repo root
sealevel codex doctor
# or, in this folder:
node bin/sealevel-codex.mjs web          # http://localhost:8767
node bin/sealevel-codex.mjs              # terminal chat
node bin/sealevel-codex.mjs ask "How has sea level changed at Wilmington, NC?" --model gpt-5.1
node bin/sealevel-codex.mjs codex        # full interactive Codex session, NOAA tools attached
```

How each question runs: `codex exec --json --sandbox workspace-write` in this
folder, with the MCP server given as `-c mcp_servers.noaa-tides.…` overrides and
its tools set to run without prompting. Shell commands Codex writes (custom
analysis scripts) run in Codex's sandbox, which can write inside this folder only.

**Trust:** Codex only reads a project's own `.codex/config.toml` after you trust
the folder. The app passes the MCP settings on the command line, so it should not
need that, but if tools don't show up, run `node bin/sealevel-codex.mjs codex`
once and accept the trust prompt.

## Compare with the other versions

Ask the same question with `sealevel claude`, `sealevel codex`, and
`sealevel ollama`: same tools, same skills, different model and harness.

# Sea-level agent — local LLM (Ollama) version

The same idea without Claude Code or any cloud AI: a model running on your
computer through [Ollama](https://ollama.com) (default `qwen3.5:9b`) plans the
steps, calls the shared NOAA tools, and writes the answer.

| Piece | Claude Code version | This version |
|---|---|---|
| **LLM** | Claude (cloud) | `qwen3.5:9b` or another Ollama model with tool calling (local) |
| **Harness** | Claude Code | `app/agent.mjs`, about 200 lines: the loop, an MCP client, tool-call repair |
| **Agent instructions** | `AGENTS.md` | `AGENTS.md`, shorter and more explicit for a small model |
| **Skills** | 6 in `.claude/skills/` | 4 in `skills/`, loaded by our `load_skill` tool |
| **MCP server** | `../shared/mcp/noaa-tides-server.mjs` | the **same** file |

## Requirements

- Node 18+
- Ollama running (the app, or `ollama serve`) with a model that supports tool
  calling: `ollama pull qwen3.5:9b` (others to try: `granite4.1:8b`, `llama3.2`)

No npm packages and no API key.

## Run

```
cd ollama
node bin/sealevel-local.mjs doctor    # checks Ollama, the model (incl. a tool-call test), MCP, NOAA
node bin/sealevel-local.mjs web       # web page at http://localhost:8766
node bin/sealevel-local.mjs           # terminal chat
node bin/sealevel-local.mjs ask "How has sea level changed at Duck, NC over the past 10 years?"
```

Options: `--model granite4.1:8b` (or pick in the web page), `--think off`
(faster answers from reasoning models), `--port 8766`. Environment:
`OLLAMA_HOST` (default http://localhost:11434), `SEALEVEL_MODEL`,
`SEALEVEL_NUM_CTX` (default 16384). On a Mac you can double-click
`start_web.command`. From the repo root, `sealevel ollama web` (or just `sealevel` for a menu) starts this version too.

## What to expect from a ~9B local model

- Slower: each step is a full model call on your computer; a question can
  take from 30 seconds to a few minutes.
- Less reliable tool use. The harness repairs common slips (numbers sent as
  strings, tool calls written as text), and the skills spell out every step,
  but the model may still skip a tool or stop early. Watch the steps panel.
- Private and free: nothing leaves your computer except the NOAA requests.
- No code-running tools, so there are no custom-analysis or report skills.

A good demo: ask the same question here and in `../claude-code` and compare
the steps, the answer, and the time.

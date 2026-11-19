# Sea-level agent — Claude Code version

Claude (via the Claude Code CLI) answers sea-level questions with real NOAA
tide-gauge data, using the shared `noaa-tides` MCP server and six skills.

| Piece | Where |
|---|---|
| **Harness** | Claude Code (`claude`) |
| **Agent instructions** | `AGENTS.md` (`CLAUDE.md` imports it, since Claude Code reads `CLAUDE.md`) |
| **Skills** | `.claude/skills/*/SKILL.md` |
| **MCP server** | `../shared/mcp/noaa-tides-server.mjs`, registered in `.mcp.json` |
| **Front ends** | `claude`, `sealevel` (CLI), `sealevel web` |

```
claude-code/
  AGENTS.md  CLAUDE.md  .mcp.json
  .claude/settings.json          pre-approves the NOAA tools and the outputs/ folder
  .claude/skills/
    sea-level-at-place/  rank-stations/  explain-sea-level-change/
    storm-surge-event/   custom-analysis/  sea-level-report/
  bin/sealevel.mjs               the `sealevel` command
  app/engine.mjs                 runs one question through Claude Code (headless), streams the steps
  app/server.mjs, app/web/       `sealevel web`
  data/      downloads + 10-day cache (created as you go)
  outputs/   plots, scripts, reports the agent creates
```

## Requirements

- Node 18+
- Claude Code: `npm install -g @anthropic-ai/claude-code`, then run `claude`
  once to sign in. Questions use your Claude plan.
- Optional, for the custom-analysis and storm-surge skills' own plots:
  `pip3 install matplotlib pandas`

## Run

```
cd claude-code
node bin/sealevel.mjs doctor     # checks Node, Claude Code, skills, MCP server, NOAA
node bin/sealevel.mjs web        # web page at http://localhost:8765
node bin/sealevel.mjs            # terminal chat (/new, /files, /quit)
node bin/sealevel.mjs ask "How has sea level changed at Wilmington, NC over the past 10 years?"
claude                           # the full interactive Claude Code session
```

From the repo root, `sealevel claude web` (or just `sealevel` for a menu) starts this version too.
On a Mac you can double-click `sealevel-web.command`.

The first `claude` session in this folder asks you to trust it and approve
the `noaa-tides` server; type `/mcp` to see its 8 tools. The `sealevel` CLI
and web app pass the MCP config and an allow-list (NOAA tools, reading the
folder, writing to `outputs/`, running scripts in `outputs/scripts/`)
directly, so they don't prompt.

## Demo questions

1. How has sea level changed at Wilmington, NC over the past 10 years?
2. Compare Duck, Norfolk and Charleston since 1996, and plot them.
3. Which NC gauge has the highest and which the lowest rate?
4. Why is Galveston so different from Boston?
5. Is sea level rise accelerating at Duck? Show your work.
6. Make a one-page report on Outer Banks sea level for my class.

Then open a `SKILL.md`, change the 50-mile radius to 25, and ask again.

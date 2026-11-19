# sealevel-agent

**An AI agent that answers sea-level questions with real NOAA tide-gauge data,
built three ways to teach how agents work.** Developed for NC State's Department
of Marine, Earth, and Atmospheric Sciences (MEAS).

Ask *"How has sea level changed at Wilmington, NC over the past 10 years?"* and
the agent finds the place, picks the nearest NOAA tide gauge within 50 miles,
downloads the monthly data, fits a trend with a 95% confidence interval,
compares it with NOAA's long-term record, plots it, and explains it.

| | [`claude-code/`](claude-code) | [`codex/`](codex) | [`ollama/`](ollama) |
|---|---|---|---|
| **LLM** | Claude (cloud) | OpenAI model (cloud) | `qwen3.5:9b` or another model on your computer |
| **Harness** | Claude Code | OpenAI Codex CLI | our own ~200-line loop (`app/agent.mjs`) |
| **Skills** | 6 in `.claude/skills/` | the same 6, in `.agents/skills/` | 4, written for a small model |
| **Needs** | Claude Code + Claude plan | Codex CLI + ChatGPT plan or OpenAI key | Ollama |
| **Best for** | the most capable agent | teams on OpenAI | private, free, offline-friendly teaching |
| **Run** | `sealevel claude web` | `sealevel codex web` | `sealevel ollama web` |

All three use the **same MCP server**, [`shared/mcp/noaa-tides-server.mjs`](shared/mcp/noaa-tides-server.mjs),
which is the point: one data plug, three different agents. Claude Code and Codex
even share the same `SKILL.md` files, since skills are an open format.

## Quick start

```
git clone https://github.com/jpliu168/sealevel-agent.git
cd sealevel-agent
npm install -g .        # once: adds the `sealevel` command (no dependencies are downloaded)
sealevel                # menu: Claude Code or local model, then web page or terminal
```

```
sealevel
Which AI should answer?
  1) Claude Code (cloud, most capable)               ✔ installed 2.1.x
  2) OpenAI Codex (cloud, ChatGPT or OpenAI account) ✔ installed 0.17x
  3) Local model via Ollama (private, free, slower)  ✔ running, 9 models
How do you want to use it?
  1) Web page (plots and data in the browser)
  2) Terminal chat
  3) Check the setup
```

Skip the menu with `sealevel claude web`, `sealevel codex chat`, `sealevel ollama chat --model granite4.1:8b`,
`sealevel claude doctor`, or `sealevel ollama ask "How has sea level changed at Duck, NC?"`.
Without installing, use `node bin/sealevel.mjs` (or double-click `sealevel.command` on a Mac).
Each version's folder has its own README with details, demo questions, and options.

## How the pieces fit

```
 you ──▶ HARNESS (Claude Code, Codex CLI, or ollama/app/agent.mjs)
            │   loads AGENTS.md + skill descriptions
            ▼
          LLM ──── tool call ───▶ MCP server: noaa-tides ──▶ NOAA CO-OPS API
            ▲                       (shared/mcp)               (cached 10 days)
            └────── result ─────────┘
            │
            ▼
       answer + plots + data files (in the version's outputs/ and data/)
```

| Concept | What it is here |
|---|---|
| **LLM** | the model that reads the question, plans, and writes the answer |
| **Harness** | the program that runs the loop: sends messages, runs requested tools, returns results, enforces permissions |
| **Agent instructions** | `AGENTS.md`: role, ground rules (50-mile radius, numbers only from tools, report uncertainty) |
| **Skills** | `SKILL.md` recipes the model loads only when a question matches |
| **MCP** | the Model Context Protocol: a standard way to plug tools and data into any agent |

## MCP tools (`noaa-tides`)

`geocode` · `find_stations` (within N miles, with distance) · `list_stations`
(by state) · `get_monthly_mean` (CSV) · `compute_trend` (deseasonalized OLS,
95% CI corrected for autocorrelation) · `get_long_term_trend` (NOAA's published
rate) · `get_water_levels` (hourly level, tide prediction, surge) ·
`plot_sea_level` (SVG).

Without internet, the server falls back to built-in data in
`shared/data/builtin`: all 303 NOAA water-level gauge locations, NOAA long-term
trends for 144 gauges, and monthly means for 27 gauges (2016–2025).

## Also in this repo

- [`browser-demos/`](browser-demos): single-file web versions (a faculty demo
  with a scripted vs. Claude brain, and a chat page using your own Claude or
  OpenAI API key).
- [`docs/`](docs): a slide deck explaining LLMs, harnesses, agents, skills, and
  MCP with all three versions.

## Data and credits

- Tide-gauge data: [NOAA CO-OPS Tides & Currents](https://tidesandcurrents.noaa.gov)
  (US government work, public domain). Please follow NOAA's API usage guidance.
- Place names: [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org)
  (© OpenStreetMap contributors, ODbL); keep requests light, per its usage policy.
- AI answers can be wrong. Check important numbers on the NOAA station pages.

## License

[MIT](LICENSE) © 2026 Paul Liu, NC State University MEAS.

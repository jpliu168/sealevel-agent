# Browser demos (single HTML files)

Earlier, simpler versions of the agent that run entirely in a web page.

- **`sea_level_agent_demo.html`** — the faculty demo. A "Scripted rules" brain
  (no key needed) and a "Claude (real tool calling)" brain (your Anthropic API
  key), side by side, with the agent trace. Has NOAA data built in for 27
  gauges, so it also works offline.
- **`sea_level_chat.html`** — a simple chat page for end users, using their own
  Anthropic or OpenAI API key.

Both read `AGENTS.md`, `skills/` and `tools.json` from this folder when served
over http (edit them and reload), and fall back to built-in copies otherwise.

```
cd browser-demos
python3 -m http.server 8000
# open http://localhost:8000/sea_level_agent_demo.html  or  /sea_level_chat.html
```

API keys stay in your browser and go only to the provider you chose.

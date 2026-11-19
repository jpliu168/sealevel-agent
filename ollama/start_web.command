#!/bin/bash
# Double-click: start the local (Ollama) sea-level web app and open it. Close this window to stop.
cd "$(dirname "$0")"
node bin/sealevel-local.mjs web

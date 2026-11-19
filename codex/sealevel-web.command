#!/bin/bash
# Double-click: start the Codex version's web page and open it. Close this window to stop.
cd "$(dirname "$0")"
node bin/sealevel-codex.mjs web

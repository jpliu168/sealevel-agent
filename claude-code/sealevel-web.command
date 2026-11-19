#!/bin/bash
# Double-click: start "sealevel web" and open it in your browser. Close this window to stop.
cd "$(dirname "$0")"
node bin/sealevel.mjs web

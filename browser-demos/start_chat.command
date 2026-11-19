#!/bin/bash
# Double-click: serve this folder locally and open sea_level_chat.html. Close this window to stop.
cd "$(dirname "$0")"
PORT=8000
while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done
( sleep 1; open "http://localhost:$PORT/sea_level_chat.html" ) &
python3 -m http.server $PORT --bind 127.0.0.1

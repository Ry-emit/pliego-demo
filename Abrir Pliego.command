#!/bin/bash
# Starts the Pliego demo on localhost:8245 and opens it in the browser.
cd "$(dirname "$0")"
PORT=8245
if ! lsof -ti tcp:$PORT >/dev/null; then
  python3 servir.py $PORT &
  sleep 1
fi
open "http://localhost:$PORT/"
wait

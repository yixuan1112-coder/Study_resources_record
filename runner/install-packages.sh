#!/usr/bin/env bash
# Installs the language packages the vault offers a Run button for.
#
# Anything not installed here simply has no Run button in the editor — the app
# asks the runner what it has rather than assuming. Add a line to widen it;
# `curl -s localhost:2000/api/v2/packages` lists everything available.
set -u

for pkg in "python 3.12.0" "java 15.0.2" "gcc 10.2.0" "node 20.11.1" \
           "typescript 5.0.3" "bash 5.2.0" "sqlite3 3.36.0" "rscript 4.1.1"; do
  set -- $pkg
  echo "--- installing $1 $2"
  curl -s --max-time 900 -X POST http://127.0.0.1:2000/api/v2/packages \
    -H "Content-Type: application/json" \
    -d "{\"language\":\"$1\",\"version\":\"$2\"}"
  echo
done
echo "=== done ==="

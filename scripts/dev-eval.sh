#!/usr/bin/env bash
# Run JS inside the DEV Zotero instance started by `npm start` (never the user's Zotero).
# Usage: scripts/dev-eval.sh 'return Zotero.version'   |  scripts/dev-eval.sh -f file.js
# The code runs as an async function body with Zotero, addon, dev in scope.
PORT="${ZEST_DEV_PORT:-23124}"
TOKEN="zest-dev-5c1e9a27"
if [ "$1" = "-f" ]; then CODE="$(cat "$2")"; else CODE="$1"; fi
python3 - "$PORT" "$TOKEN" "$CODE" <<'PY'
import sys, json, urllib.request
port, token, code = sys.argv[1], sys.argv[2], sys.argv[3]
req = urllib.request.Request(f"http://127.0.0.1:{port}/zest-dev/eval",
    data=json.dumps({"token": token, "code": code}).encode(),
    headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.loads(r.read().decode())
        print(d.get("result") if d.get("ok") else "ERROR: " + str(d.get("error")))
except Exception as e:
    print("REQUEST FAILED:", e)
PY

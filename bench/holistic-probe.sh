#!/usr/bin/env bash
# holistic-probe.sh: the Catalog worked example's orchestrator receipt, re-runnable. One
# routed headless Claude Code session on the holistic-review prompt, in a stub signup
# workspace, capped at 30 turns. Records the verdict and every Skill call with the gate's
# answer, so you can see better-interface load leaves the router left below both bands.
#
#   bash bench/holistic-probe.sh            # fable
#   bash bench/holistic-probe.sh opus       # any --model alias
#
# Same arm as cross-model-probe.sh's "routed": the installed jev-skill-router plugin
# switched off, this working tree loaded via --plugin-dir, clean environment (env -i).
# Key: an exported TYPESAFE_API_KEY, else the repo's .env.local.
# Output: bench/session-results/holistic-<timestamp>/routed-<model>.jsonl (gitignored).
# The workspace is kept so the chat can be reopened: cd <workspace> && claude --resume
set -u

REPO=$(cd "$(dirname "$0")/.." && pwd)
MODEL=${1:-fable}
PROMPT='give the signup screen a holistic review across the board — layout, copy, colors, type, accessibility — and hand me one ranked list of what to fix'
PLUGIN_OFF='{"enabledPlugins":{"jev-skill-router@jev":false}}'

KEY=${TYPESAFE_API_KEY:-}
if [ -z "$KEY" ] && [ -f "$REPO/.env.local" ]; then
  KEY=$(grep -E '^TYPESAFE_API_KEY=' "$REPO/.env.local" | cut -d= -f2- | tr -d '"'"'")
fi
[ -n "$KEY" ] || { echo "no TYPESAFE_API_KEY: the router would be off"; exit 1; }

OUT=${PROBE_OUT:-"$REPO/bench/session-results/holistic-$(date +%Y%m%d-%H%M%S)"}
mkdir -p "$OUT" && OUT=$(cd "$OUT" && pwd)

WS=$(mktemp -d "${TMPDIR:-/tmp}/holistic-$MODEL.XXXX")
mkdir -p "$WS/src"
printf '# demo-app\n\nSmall signup app.\n' > "$WS/README.md"
printf '{\n  "name": "demo-app",\n  "private": true,\n  "dependencies": { "react": "^19.0.0" }\n}\n' > "$WS/package.json"
cat > "$WS/src/Signup.tsx" <<'TSX'
import { useState } from 'react'
import './signup.css'

export function Signup() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  return (
    <div className="card">
      <div className="title">SIGN UP NOW!!!</div>
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="Password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
      {err && <div className="err">Oops! Something went wrong.</div>}
      <div className="btn" onClick={() => (pw.length < 8 ? setErr('bad') : alert('ok'))}>Submit</div>
      <a href="#">Click here</a> to log in
    </div>
  )
}
TSX
cat > "$WS/src/signup.css" <<'CSS'
.card { width: 420px; margin: 40px auto; padding: 13px; border-radius: 16px; box-shadow: 0 0 20px #0003; }
.title { font-size: 31px; font-weight: 900; color: #999; letter-spacing: -0.08em; }
input { display: block; width: 100%; margin: 5px 0; border: 1px solid #eee; outline: none; }
.err { color: red; font-size: 11px; }
.btn { background: #7c7; color: #fff; padding: 6px; border-radius: 4px; transition: all 0.6s ease-in; }
.btn:hover { transform: scale(1.2); }
CSS
(cd "$WS" && git init -q && git add -A && git -c user.name=probe -c user.email=probe@local commit -qm init)

(cd "$WS" && env -i HOME="$HOME" PATH="$PATH" TERM=xterm USER="${USER:-}" TYPESAFE_API_KEY="$KEY" \
  claude -p "$PROMPT" --model "$MODEL" --max-turns 30 --settings "$PLUGIN_OFF" --plugin-dir "$REPO" \
  --output-format stream-json --verbose > "$OUT/routed-$MODEL.jsonl" 2> "$OUT/routed-$MODEL.err")
echo "done: routed-$MODEL (exit $?)"

python3 - "$OUT/routed-$MODEL.jsonl" <<'PY'
import json, re, sys
raw = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'jev-skill-router · invoke \[[^\]]*\](?: · suggest \[[^\]]*\])?[^"\\]*', raw)
print("\nVERDICT:", m.group(0) if m else "none found")
calls, results = [], {}
for line in raw.splitlines():
    try:
        e = json.loads(line)
    except json.JSONDecodeError:
        continue
    for c in (e.get('message') or {}).get('content') or []:
        if not isinstance(c, dict):
            continue
        if c.get('type') == 'tool_use' and c.get('name') == 'Skill':
            calls.append((c['id'], (c.get('input') or {}).get('skill')))
        if c.get('type') == 'tool_result':
            body = c.get('content')
            body = body if isinstance(body, str) else json.dumps(body)
            results[c.get('tool_use_id')] = ('DENIED' if c.get('is_error') or 'deni' in body.lower() else 'loaded', body[:200])
print("\nSKILL CALLS (in order):")
for i, (tid, sk) in enumerate(calls, 1):
    status, body = results.get(tid, ('no result', ''))
    print(f"  {i}. {sk:<28} {status}" + (f"  <- {body}" if status == 'DENIED' else ''))
print(f"\nTranscript: {sys.argv[1]}")
PY
echo "Open the chat:  cd $WS && claude --resume"

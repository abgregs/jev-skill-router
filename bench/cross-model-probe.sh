#!/usr/bin/env bash
# cross-model-probe.sh: the demo opener's evidence, re-runnable. One headless Claude
# Code session per arm x model on the a11y-widget prompt, in a fresh stub workspace,
# capped at 4 turns. Records whether each session invoked a skill, and which.
#
#   bash bench/cross-model-probe.sh                 # all 8 sessions in parallel, then summary
#   bash bench/cross-model-probe.sh stock           # one arm, all 4 models
#   bash bench/cross-model-probe.sh stock haiku     # one session
#   PROBE_OUT=DIR bash bench/cross-model-probe.sh … # add runs to an existing DIR
#   bash bench/cross-model-probe.sh --summary DIR   # re-print a past run's summary
#
# Arms:
#   stock   the installed jev-skill-router plugin switched off; your skills load as usual
#   routed  the installed plugin switched off, this working tree loaded via --plugin-dir,
#           so the hooks are the current code, not the marketplace copy
#
# Key: an exported TYPESAFE_API_KEY, else the repo's .env.local. Sessions start from a
# clean environment (env -i), so nothing from a parent Claude session leaks into them.
# Output: bench/session-results/cross-model-<timestamp>/<arm>-<model>.jsonl (gitignored).
set -u

REPO=$(cd "$(dirname "$0")/.." && pwd)
MODELS=(haiku sonnet opus fable)
PROMPT='our custom combobox is broken for keyboard users and voiceover announces nothing — fix the focus management and aria wiring'
PLUGIN_OFF='{"enabledPlugins":{"jev-skill-router@jev":false}}'

summary() {
  python3 - "$1" <<'PY'
import json, os, re, sys
out = sys.argv[1]
print(f"\n== SUMMARY: {out} ==")
print(f"{'run':<16} {'skills loaded':<14} {'a11y skill listed':<18} {'router verdict':<72} skill calls")
for name in sorted(os.listdir(out)):
    if not name.endswith('.jsonl'):
        continue
    path = os.path.join(out, name)
    raw = open(path, encoding='utf-8').read()
    skills, listed, calls = '?', '?', []
    for line in raw.splitlines():
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if e.get('type') == 'system' and e.get('subtype') == 'init':
            sk = e.get('skills') or e.get('slash_commands') or []
            skills, listed = str(len(sk)), str(any('better-accessibility' in str(s) for s in sk))
        if e.get('type') == 'assistant':
            for c in e.get('message', {}).get('content', []):
                if c.get('type') == 'tool_use' and c.get('name') == 'Skill':
                    calls.append(str((c.get('input') or {}).get('skill', '?')))
    m = re.search(r'jev-skill-router · invoke \[[^\]]*\](?: · suggest \[[^\]]*\])?', raw)
    verdict = m.group(0).replace('jev-skill-router · ', '') if m else '—'
    print(f"{name[:-6]:<16} {skills:<14} {listed:<18} {verdict[:72]:<72} {', '.join(calls) or 'none'}")
print("\nTranscripts: the .jsonl files above (stream-json). stderr: the matching .err files.")
PY
}

run_one() {
  local arm=$1 model=$2 out=$3
  local ws
  ws=$(mktemp -d "${TMPDIR:-/tmp}/probe-$arm-$model.XXXX")
  mkdir -p "$ws/components/ui"
  printf '# demo-app\n\nSmall app used for the jev-skill-router recorded demo work.\n' > "$ws/README.md"
  printf '{\n  "name": "demo-app",\n  "version": "0.1.0",\n  "private": true\n}\n' > "$ws/package.json"
  cat > "$ws/components/ui/combobox.tsx" <<'TSX'
import { useState } from 'react'

export function Combobox({ options }: { options: string[] }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  return (
    <div className="combobox">
      <div className="trigger" onClick={() => setOpen(!open)}>{value || "Select…"}</div>
      {open && options.map((o) => (
        <div key={o} className="option" onClick={() => { setValue(o); setOpen(false) }}>{o}</div>
      ))}
    </div>
  )
}
TSX
  (cd "$ws" && git init -q && git add -A && git -c user.name=probe -c user.email=probe@local commit -qm init)

  local extra=()
  [ "$arm" = routed ] && extra=(--plugin-dir "$REPO")
  (cd "$ws" && env -i HOME="$HOME" PATH="$PATH" TERM=xterm USER="${USER:-}" TYPESAFE_API_KEY="$KEY" \
    claude -p "$PROMPT" --model "$model" --max-turns 4 --settings "$PLUGIN_OFF" ${extra[@]+"${extra[@]}"} \
    --output-format stream-json --verbose > "$out/$arm-$model.jsonl" 2> "$out/$arm-$model.err")
  echo "done: $arm-$model (exit $?)"
  rm -rf "$ws"
}

if [ "${1:-}" = "--summary" ]; then
  summary "${2:?usage: --summary DIR}"
  exit 0
fi

KEY=${TYPESAFE_API_KEY:-}
if [ -z "$KEY" ] && [ -f "$REPO/.env.local" ]; then
  KEY=$(grep -E '^TYPESAFE_API_KEY=' "$REPO/.env.local" | cut -d= -f2- | tr -d '"'"'")
fi
[ -n "$KEY" ] || echo "warning: no TYPESAFE_API_KEY; routed sessions will run with the router off"

OUT=${PROBE_OUT:-"$REPO/bench/session-results/cross-model-$(date +%Y%m%d-%H%M%S)"}
mkdir -p "$OUT" && OUT=$(cd "$OUT" && pwd)   # absolute: sessions write from their workspace

if [ $# -eq 2 ]; then
  run_one "$1" "$2" "$OUT"
else
  arms=(stock routed)
  [ $# -eq 1 ] && arms=("$1")
  for arm in "${arms[@]}"; do
    for model in "${MODELS[@]}"; do
      run_one "$arm" "$model" "$OUT" &
    done
  done
  wait
fi
summary "$OUT"

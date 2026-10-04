#!/usr/bin/env bash
# Screenshot self-check: takes pictures of the running game and measures them. See docs/shots.md.
#   bash tools/shots.sh                      one picture, High, 1280x720 (the quick set)
#   bash tools/shots.sh --set levels         Low, Medium and High at 1280x720
#   bash tools/shots.sh --quality high --shape wide
#   bash tools/shots.sh flow                 the flow set (same as --set flow); quick works the same way
#   bash tools/shots.sh e2e                  the flow end to end check (tools/flow_e2e.py, shots/e2e.json)
#   bash tools/shots.sh --help
# Finds a Python that has Playwright (SHOTS_PYTHON, then ~/tools/shots/venv, then python3) and runs tools/shots.py.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
PY=""
for cand in "${SHOTS_PYTHON:-}" "$HOME/tools/shots/venv/bin/python" python3; do
  [ -n "$cand" ] || continue
  if command -v "$cand" > /dev/null 2>&1 && "$cand" -c 'import playwright' > /dev/null 2>&1; then
    PY=$cand
    break
  fi
done
if [ -z "$PY" ]; then
  cat >&2 << 'MSG'
SHOTS TOOL NOT READY: no Python with Playwright was found.
One-time setup (outside the repo):
  mkdir -p ~/tools/shots && cd ~/tools/shots && python3 -m venv venv
  venv/bin/pip install playwright
  venv/bin/playwright install chromium
  sudo venv/bin/playwright install-deps chromium
Then run the same command again. If screenshots cannot run, continue without them and say so in the summary:
never claim a visual check you did not do.
MSG
  exit 2
fi
case "${1:-}" in
  e2e) shift; exec "$PY" "$HERE/flow_e2e.py" "$@" ;;
  quick|levels|shapes|hud|full|flow) set_name=$1; shift; exec "$PY" "$HERE/shots.py" --set "$set_name" "$@" ;;
esac
exec "$PY" "$HERE/shots.py" "$@"

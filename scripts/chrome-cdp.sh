#!/usr/bin/env bash
# scripts/chrome-cdp.sh
# Starts Chrome with remote debugging, connects agent-browser to the CDP session,
# then keeps Chrome running (as the foreground process) so run-pty can manage it.
#
# run-pty shows this tile as "Chrome CDP". Ctrl+C in the dashboard kills Chrome.

set -uo pipefail

CDP_PORT=9222
CHROME_DATA_DIR="./data/chrome"

# ── Helpers ───────────────────────────────────────────────────────────────────

log()  { echo "[chrome-cdp] $*"; }
err()  { echo "[chrome-cdp] ERROR: $*" >&2; }

evict_port() {
  local holders
  holders=$(lsof -ti tcp:"$CDP_PORT" 2>/dev/null || true)
  if [[ -z "$holders" ]]; then return; fi
  log "Port ${CDP_PORT} in use — evicting PIDs: $(echo "$holders" | tr '\n' ' ')"
  echo "$holders" | xargs kill -9 2>/dev/null || true
  local i=0
  while lsof -ti tcp:"$CDP_PORT" &>/dev/null && [[ $i -lt 6 ]]; do
    sleep 0.5; i=$(( i + 1 ))
  done
}

wait_for_port() {
  local max_secs=30 elapsed=0
  log "Waiting for Chrome CDP on port ${CDP_PORT}…"
  while ! (echo > /dev/tcp/127.0.0.1/"$CDP_PORT") 2>/dev/null; do
    sleep 0.5; elapsed=$(( elapsed + 1 ))
    if [[ $elapsed -ge $(( max_secs * 2 )) ]]; then
      err "Timed out waiting for Chrome after ${max_secs}s"
      exit 1
    fi
  done
  log "Chrome CDP ready on port ${CDP_PORT}."
}

get_cdp_url() {
  curl -sf "http://127.0.0.1:${CDP_PORT}/json/version" 2>/dev/null \
    | jq -r '.webSocketDebuggerUrl // empty'
}

# ── Pre-flight ────────────────────────────────────────────────────────────────

mkdir -p "$CHROME_DATA_DIR"
evict_port

# ── Start Chrome ──────────────────────────────────────────────────────────────

log "Starting Chrome (CDP port ${CDP_PORT})…"

google-chrome-stable \
  --remote-debugging-port="${CDP_PORT}" \
  --user-data-dir="${CHROME_DATA_DIR}" \
  --no-first-run \
  --no-default-browser-check \
  --disable-default-apps \
  &
CHROME_PID=$!

# Kill Chrome if this script exits for any reason before the wait at the bottom.
trap 'kill "$CHROME_PID" 2>/dev/null || true' EXIT

# ── Wait for CDP ──────────────────────────────────────────────────────────────

wait_for_port

# ── Connect agent-browser ─────────────────────────────────────────────────────

CDP_URL=$(get_cdp_url)
if [[ -z "$CDP_URL" ]]; then
  err "Could not retrieve CDP WebSocket URL from Chrome."
  exit 1
fi
log "CDP URL: ${CDP_URL}"

log "Connecting agent-browser…"
if ! bun run ab connect "$CDP_URL"; then
  err "agent-browser connect failed. Is 'agent-browser' installed?"
  exit 1
fi
log "agent-browser connected. Chrome is running (PID ${CHROME_PID})."

# Clear the exit trap — we want Chrome to stay alive from here.
trap - EXIT

# ── Keep Chrome alive ─────────────────────────────────────────────────────────
# Hand control back to Chrome. `wait` waits for Chrome to exit (e.g. user closes
# it, or run-pty sends Ctrl+C). When Chrome exits, this script exits too.

log "DevTools listening on ws://127.0.0.1:${CDP_PORT}"
wait "$CHROME_PID"

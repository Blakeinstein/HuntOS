#!/usr/bin/env bash
# scripts/dev.sh
# Starts the Vite development server, piping output to data/logs/dev.log
# Managed by run-pty as the "Dev Server" tile.

set -uo pipefail

cd "$(dirname "$0")/.."

mkdir -p data/logs

exec bun run dev 2>&1 | tee data/logs/dev.log

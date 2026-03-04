#!/usr/bin/env bash
# scripts/dev.sh
# Starts the Vite development server.
# Managed by run-pty as the "Dev Server" tile.

set -uo pipefail

cd "$(dirname "$0")/.."

exec bun run dev

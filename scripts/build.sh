#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  printf '%s\n' 'Node.js and npm are required.' >&2
  exit 1
fi
if [[ "${1:-}" == "--fresh" ]]; then
  npm ci
elif [[ ! -d node_modules ]]; then
  printf '%s\n' 'Dependencies are missing. Run the approved npm ci installation first.' >&2
  exit 1
fi
npm run typecheck
npm run lint
npm run build
printf '%s\n' 'Build completed. Live checks marked SKIP are not verified. Start with npm start.'

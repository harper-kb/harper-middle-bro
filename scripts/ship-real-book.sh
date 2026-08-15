#!/usr/bin/env bash
#
# Put the real book on a deployed instance, in one command.
#
#   RAILWAY_TOKEN=... ./scripts/ship-real-book.sh --service harper-step-bro
#
# Everything except the pull is automated. The pull goes through the Harper
# MCP, which is an agent tool rather than a shell command, so do this first:
#
#   harper_tools execute: data policy-state read --in-force-only --limit 400
#
# and save the returned envelope as data/harper-policy-state.local.json. The
# importer accepts either {"policies": [...]} or the raw {"rows": [...]}.
#
# Add --dry-run to resolve the Railway target and change nothing.
#
# Nothing here writes customer data into git: /data/ is gitignored, and the
# book reaches the service as environment variables.

set -euo pipefail
cd "$(dirname "$0")/.."

PULL="data/harper-policy-state.local.json"

if [ ! -f "$PULL" ]; then
  echo "Missing $PULL."
  echo
  echo "Pull it through the Harper MCP first:"
  echo "  data policy-state read --in-force-only --limit 400"
  echo "then save the response there."
  exit 1
fi

echo "==> importing"
npx tsx --conditions react-server scripts/import-harper-book.ts

echo
echo "==> packing"
node scripts/pack-harper-book.mjs

echo
echo "==> deploying"
node scripts/deploy-book-to-railway.mjs "$@"

echo
echo "The loader that reads these variables landed in PR #57. If that is not"
echo "merged into main, the running service cannot read them and will keep"
echo "booting the seed — check before concluding the deploy did nothing."

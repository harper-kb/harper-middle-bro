#!/bin/bash
# Run every self-check harness with its required invocation.
#
# Three invocation classes exist and the wrong one fails on import:
#   plain        — pure modules, no server-only import
#   react-server — imports src/lib/policy-intelligence (server-only)
#   stub         — react-dom/server + server-only both in play; the
#                  render-check tsconfig maps server-only to a stub
#
# scripts/service-loop-check.ts writes to data/underwriter-desk.db and
# deletes everything it created before exiting.

set -u
cd "$(dirname "$0")/.."

fails=0
run() {
  local label="$1"; shift
  if "$@" > /tmp/check-"$label".log 2>&1; then
    echo "PASS  $label"
  else
    fails=$((fails+1))
    echo "FAIL  $label — see /tmp/check-$label.log"
  fi
}

for f in \
  access-check.ts \
  agent-watch-check.ts \
  carrier-knowledge-check.ts \
  cert-invariants-check.ts \
  cert-run-check.ts \
  cert-verify-check.ts \
  day-story-check.ts \
  desk-brain-check.ts \
  intake-match-check.ts \
  middle-bro-check.ts \
  pipeline-render-check.tsx
do
  run "${f%.*}" npx tsx "scripts/$f"
done

for f in \
  cert-corrections-check.ts \
  isc-intake-check.ts \
  insured-address-verify-check.ts \
  service-loop-check.ts
do
  run "${f%.*}" npx tsx --conditions react-server "scripts/$f"
done

run insured-box-render-check npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/insured-box-render-check.tsx
run cert-upload-check npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/cert-upload-check.ts
run harper-mapper-check npx tsx scripts/harper-mapper-check.ts
run workitem-contracts-check npx tsx scripts/workitem-contracts-check.ts
run bigbrother-adapter-check npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/bigbrother-adapter-check.ts
run agent-tools-check npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/agent-tools-check.ts
run priority-engine-check npx tsx scripts/priority-engine-check.ts
run lane-mode-check npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/lane-mode-check.ts
run account-workspace-check npx tsx scripts/account-workspace-check.ts
run agentification-check npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/agentification-check.ts

run hardening-check npx tsx --tsconfig scripts/tsconfig.render-check.json scripts/hardening-check.ts
run manager-kpi-check npx tsx scripts/manager-kpi-check.ts
run manager-qa-check npx tsx scripts/manager-qa-check.ts

echo "---"
if [ $fails -eq 0 ]; then
  echo "All harnesses green."
else
  echo "$fails harness(es) FAILED."
fi
exit $([ $fails -eq 0 ] && echo 0 || echo 1)

# Step Bro production rollout

## Feature flags

| Flag / env | Default | Effect |
|------------|---------|--------|
| `BIGBROTHER_BASE_URL` + `BIGBROTHER_API_TOKEN` | unset | Lanes stay labeled sample |
| `HARPER_AGENT_TOOLS_*` | unset | Writes blocked / legacy fallback |
| `NOTION_TOKEN` | unset | Template registry stays on seeds |
| `BIGBROTHER_ACTOR_MAP_JSON` | `{}` | Clerk→BB actor mapping |

Never enable unlabeled live numbers. Use `GET /api/lane-status` before flipping a lane live.

## Auth / scope

- All pages/APIs require Clerk except sign-in/sign-up.
- Manager surfaces check `operator.role === "manager"`.
- Mutations require server-side auth + idempotency + confirmation policy.

## Parity dashboards

- Per-lane count reconciliation (`reconcileCounts` / lane-status API).
- Manager KPI board distinguishes `sample` vs `live` / `snapshot`.
- Section counts must match drilldowns (`reconcileSectionCounts`).

## Read-after-write

Every Agent Tools mutation returns an `ActionReceipt` with `verified` when confirmation succeeds; retries return `idempotent_replay`.

## Telemetry

- Prefer existing Agent Watch / PostHog patterns; do not invent silent KPI mixes.
- Preserve live source timestamps on manager metrics.

## Migration seam → `service.*`

Adapters already isolate UI from BigBrother SQL. When `service.issues` / `service.tasks` / `service.issue_events` become source of truth, swap lane/action adapter implementations without rewriting Desk or section shells.

## Rollout order

1. Provision BigBrother read credentials; reconcile one lane at a time.
2. Provision Agent Tools for drafts/comms; keep bind human-gated.
3. Enable Notion template sync.
4. Turn on manager live KPIs only after section count parity.

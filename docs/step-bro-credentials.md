# Step Bro credential provisioning

Live lanes require server env credentials. Until they are set **and** each lane's counts reconcile against BigBrother, the UI stays in labeled **Sample Mode**.

## Required

| Variable | Used by |
|----------|---------|
| `BIGBROTHER_BASE_URL` | Live lane reads (`/api/service-workbench/*`) |
| `BIGBROTHER_API_TOKEN` | Bearer for BigBrother internal APIs |
| `HARPER_AGENT_TOOLS_BASE_URL` | Agent Tools gateway origin (`POST {base}/api/v1/commands/...`) |
| `HARPER_AGENT_TOOLS_TOKEN` | API key for Agent Tools (sent as bearer) |

## Optional

| Variable | Used by |
|----------|---------|
| `BIGBROTHER_ACTOR_MAP_JSON` | Clerk/operator → BigBrother actor id map |
| `STEP_BRO_SERVICE_SPINE_ENABLED` | Explicit Spine activation; defaults off |
| `STEP_BRO_SERVICE_AGENT_ENABLED` | Explicit Agent activation; defaults off |

Agent Tools credentials do not activate Service Spine or Service Agent. They
only move those systems to **available, not activated**. Do not set either
activation flag in production-facing defaults; activation requires an explicit
operator decision.

## Live flip gate

1. Credentials present (`bigBrotherConfigured()`).
2. Swim-lanes fetch succeeds.
3. Step Bro listed count === BigBrother `sourceCount` (`reconcileCounts`).
4. Only then `LaneSnapshot.mode === "live"`.

Inspect current state (signed-in): `GET /api/lane-status`.

Never ship unlabeled or fabricated live numbers.

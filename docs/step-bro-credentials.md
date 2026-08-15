# Step Bro credential provisioning

Live lanes require server env credentials. Until they are set **and** each lane's counts reconcile against BigBrother, the UI stays in labeled **Sample Mode**.

## Required

| Variable | Used by |
|----------|---------|
| `BIGBROTHER_BASE_URL` | Live lane reads (`/api/service-workbench/*`) |
| `BIGBROTHER_API_TOKEN` | Bearer for BigBrother internal APIs |
| `HARPER_AGENT_TOOLS_BASE_URL` | Mutation doors (`POST /execute`) **and the book sync** |
| `HARPER_AGENT_TOOLS_TOKEN` | Bearer for Agent Tools |

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

## The book

Without credentials the desk serves the fictional seed — recognisable by
Oakridge, Lakeside, Northstar. Two ways to give it the real one:

**Live sync (preferred).** With the Agent Tools variables set, a signed-in
operator refreshes the book from Harper on the running instance:

```js
fetch("/api/book/sync", { method: "POST" }).then(r => r.json()).then(console.log)
```

It reads `data policy-state read --in-force-only`, maps the rows, and writes
them over the same upsert boot uses. It fails closed: a `not_configured`, a
missing `rows` key or an empty page declines and leaves the serving book
alone, because an empty book is not a true statement about a broker's
business and the desk would start refusing certificates over nothing.

Without the variables the route answers 502 with
`Harper Agent Tools credentials not provisioned` — that is the sync
declining, not the route being broken.

**Baked snapshot.** For an instance that will not hold Agent Tools
credentials, `scripts/pack-harper-book.mjs` emits `HARPER_BOOK_B64_1..n`
(gzipped, base64, split because a book exceeds the common 32KB ceiling).
The loader prefers `data/supabase-book.local.json`, then those variables,
then the seed. A truncated value falls back to the seed rather than
presenting half a book as real.

The book is real customer data and never enters git; `/data/` is gitignored.

## Live flip gate

1. Credentials present (`bigBrotherConfigured()`).
2. Swim-lanes fetch succeeds.
3. Step Bro listed count === BigBrother `sourceCount` (`reconcileCounts`).
4. Only then `LaneSnapshot.mode === "live"`.

Inspect current state (signed-in): `GET /api/lane-status`.

Never ship unlabeled or fabricated live numbers.

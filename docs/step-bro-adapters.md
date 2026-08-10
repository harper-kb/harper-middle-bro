# Step Bro adapter contracts

Typed seams for live reads and guarded writes. UI consumes `WorkItem` /
`LaneSnapshot` / `ActionReceipt` only — never BigBrother or HWS shapes directly.

## Source APIs (reads)

| Adapter | Source | Notes |
|---------|--------|-------|
| BigBrother lanes | BigBrother service-workbench APIs backed by `lane-config.ts`, `fetch-swim-lanes.ts`, `fetch-unbound-accounts.ts` | Server-only. Do not copy BB SQL into Step Bro. |
| BigBrother account | BigBrother account / ticket detail APIs | Identity mapped via Clerk → operator → external actor. |
| Local sample | Seeded SQLite book | Labeled `mode: "sample"` when credentials missing or counts unreconciled. |

A lane flips to `mode: "live"` only when `reconciled === true` (Step Bro count matches BigBrother `sourceCount`) and credentials are present. Unlabeled or fabricated numbers are forbidden.

## Capability gates (writes)

| CapabilityId | Preferred provider | Confirmation | Fallback |
|--------------|-------------------|--------------|----------|
| `write.comms.email` / `text` | Agent Tools | `one_click` | Legacy harper-tools / BB proven paths |
| `write.comms.bulk` | Agent Tools | `batch_review` | — |
| `write.docusign` | Agent Tools | `one_click` | BigBrother bind/DocuSign adapters |
| `write.payment_link` | Agent Tools | `one_click` | Legacy |
| `write.bind` | Agent Tools | `one_click` | Human portal bind until safe door exists |
| `write.coi.issue` / `send` | Agent Tools | `one_click` | Step Bro cert issuance + BB binder-to-COI |
| `write.draft` / `issue` / `task` / `reminder` | Agent Tools | `none` or `one_click` | Local |
| `read.memory` / `read.agent_status` | Agent Tools / local | `none` | — |

Every mutation requires: server-side auth, stable idempotency key, confirmation policy, redacted `ActionReceipt`, read-after-write verification when applicable, and safe retry (`idempotent_replay`).

## Browser rule

Never call HWS product routes from the browser. Wakes/status go through Agent Tools on the server.

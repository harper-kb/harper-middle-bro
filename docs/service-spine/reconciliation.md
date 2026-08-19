# Service Spine — live data reconciliation (development artifact)

Development-only evidence record for the Step Bro Service Spine mirror against
the live Harper database, per the parity plan in
`docs/service-spine/step-bro-design.md` §11. Sample issue ids below are live
production identifiers recorded for verification evidence only — they are not
referenced by any production UI or permanent test.

## Observation A — whole-mirror counts (2026-08-19 ~18:57 UTC)

First full sync completed 2026-08-19 ~18:56:50Z
(`service_spine_refresh { trigger: 'boot', mode: 'full', requests: 3, issues:
3876, tasks: 7681, links: 426, events: 161142, ms: 16289 }`).

Three-way comparison — Step Bro SQLite mirror (read 18:57:13Z), live Supabase
SQL via the Supabase MCP (18:57:25Z), Harper Tools `service_query`
`open_issues_by_stage` pack (~18:57Z):

| Figure | Mirror | Live SQL | Harper Tools | Verdict |
|---|---:|---:|---:|---|
| open | 2,321 | 2,321 | — | exact |
| resolved | 723 | 723 | — | exact |
| blocked | 332 | 332 | — | exact |
| waiting_customer | 243 | 243 | — | exact |
| waiting_third_party | 174 | 174 | — | exact |
| cancelled | 83 | 83 | — | exact |
| non-terminal total | 3,070 | 3,070 | **3,070** (spine open sum over 238 pack rows) | exact, all three paths |
| task_links | 426 | 426 | — | exact |
| closure-proposed (non-terminal) | 727 | 727 | — | exact |
| agent tasks total / open | 4,335 / 1,586 | 4,335 / 1,586 | — | exact |
| human tasks total / open | 3,346 / 3,298 | 3,347 / 3,299 | — | +1 minted in the 12 s gap (live drift) |
| events total / suppressions | 161,142 / 34,225 | 161,158 / 34,232 | — | +16 / +7 appended after the sync (~1.3 events/s ledger rate) |

The Harper Tools pack also reports 2,365 open legacy `service_logs` rows —
a separate ledger the spine lane (source and Step Bro alike) deliberately
does not serve.

## Observation B — sample-issue field parity (2026-08-19 ~18:58 UTC)

Eleven sample issues covering the required matrix (one per status column,
closure-proposed, closed, overdue, future-due, many-human-tasks, zero-task,
hottest timeline): ids 80, 370, 576, 859, 2064, 2648, 3332, 3599, 3883, 3884,
3916. Fields compared: status, priority, issue_type, company_id, blocking,
origin, correlation_key, sla_due_at, tasks_total, tasks_open, has_draft,
closure_proposed, event_count.

- **9/11 matched exactly on every field**, including SLA timestamps and
  per-issue task/event aggregates.
- 2/11 (ids 3332, 3916 — deliberately chosen as the most recently updated
  rows) differed only by rows appended after the last sync (+1 task, +3
  events, a new draft event). Both converged to live truth within two delta
  ticks: cause classified as **observation-time drift**, not a mirror defect.

## Observation C — incremental delta path (live)

Consecutive 2-minute delta ticks observed against production, one Management
API request each:

```
service_spine_refresh { mode: 'delta', requests: 1, issues: 5, tasks: 15, links: 1, events: 37, ms: 8379 }
service_spine_refresh { mode: 'delta', requests: 1, issues: 6, tasks: 11, links: 2, events: 45, ms: 9067 }
service_spine_refresh { mode: 'delta', requests: 1, issues: 7, tasks: 13, links: 1, events: 23, ms: 9973 }
```

Rates match the audited growth (~235 issues/day, ~20k events/day).

## Observation D — board/table semantics on the rendered page

At render (counts had grown to 3,879 mirror total during the session):

- Summary tokens count **raw statuses** (Open 2,324); board columns count the
  **folded working state** (OPEN column 1,688). Reconciliation: 2,324 − 636
  open-status issues carrying the closure-proposed overlay = 1,688; the
  Closure review token (727) = 636 (open) + 17 (blocked) + 43
  (waiting_customer) + 31 (waiting_third_party). Closed column 806 = 723
  resolved + 83 cancelled. This is the source's own header-vs-column law.
- Filtered view (`q=endorsement`, `P1`, `queue=human`, `sort=priority`)
  reported "184 of 3,879 issues" with exact per-column filtered totals —
  server-side filtering over the whole mirror (an intentional improvement
  over the source's loaded-set filtering, documented in the design doc).

## Observation E — detail and timeline path

- `GET /api/service-spine/issue/859` (hottest issue: 1,530 events): detail
  head + 4 tasks from the mirror; timeline served newest 500 with
  `totalEvents: 1530`, `truncated: true`.
- Found and fixed during verification: the Management API refuses responses
  past ~1 MB (issue 370's 939 KB page served; 859's 1.34 MB was refused).
  Fix in `src/lib/service-spine/timeline.server.ts`: per-event payloads over
  1,500 chars are clamped in SQL to an honest preview object
  (`payload_clamped: true`, original `chars`, `preview`) — bounding the page
  at ~750 KB worst case while keeping the 500-event cap and the exact window
  total. Degraded state verified before the fix: detail + tasks rendered
  with the fixed timeline-failure copy, no fabricated timeline.
- Error contract verified: non-integer id → 400; unknown id → 404;
  timeline-only failure → 200 with `timelineError` and intact detail.

## Observation F — URL state laws (live server)

- `?priority=P99&q=acme&bogus=1` → 307 to `?q=acme` (invalid values dropped
  on their own fields; `service_spine_filter_dropped { fields: ['priority'] }`
  logged, field names only).
- `?view=table&page=99999` → 307 to `?view=table&page=39` (clamped to the
  live last page).
- Non-canonical param order → one-hop redirect to canonical order.

## Test-gate summary (post-integration, 2026-08-19 ~19:05 UTC)

- `npm test`: 900/900 passed, 80/80 files (live-book spine suites active
  against the synced mirror).
- `npm run typecheck`: clean. `npm run lint`: 0 errors (5 pre-existing
  warnings in non-spine files). `npm run build`: production build passes
  with `/service-spine` dynamic route.

No production rows were written at any point: the refresh leg and timeline
fetch issue SELECT-only statements through the Management API; MCP usage was
read-only throughout.

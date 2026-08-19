# Service Spine — Step Bro design (implementation contract)

Companion to `docs/service-spine/source-audit.md` (the source contract of
record). This document defines what Step Bro builds, where, and why it may
differ from the source. Section owners and file ownership are at the end.

## 1. Scope classification

| Source capability | Classification | Step Bro treatment |
|---|---|---|
| Board (6 columns + verbatim unknown statuses), cards, column counts | required parity | build |
| Header summary counts (issues by status, agent/human tasks, events, suppressed) | required parity | build (whole-mirror, exact) |
| Table mode | required parity (operationally important scan face in source) | build (paged, no "Show all" render storm) |
| Search / priority / type / wave / cohort / queue / sort | required parity | build, **server-side** over the mirror |
| Issue detail: head, tasks, connections (task links), timeline w/ 500-cap + truncation honesty | required parity | build (timeline lazy, on-demand) |
| Company/account navigation | required parity | link to `/accounts/co-{companyId}` when the account exists in the Step Bro book; plain name otherwise |
| SLA due/overdue chips, draft/blocking/closure-proposed pills, human/agent progress | required parity | build |
| Manual refresh + live freshness | required parity | `router.refresh()` + 2-min mirror + 5-min client refresh + LatestDatabaseSync time |
| Closed visibility | parity | Closed column always shown (source has **no** closed toggle) |
| Task assign / complete, issue resolve / cancel | mutation requiring approved contract | **read-only v1** — see §4 |
| Feedback thumbs / retract | source-specific (HCW's feedback ledger) | omit; documented gap |
| Ask Harper drawer | source-specific | omit |
| Account context drawer (transactions/payments/docs) | source-specific (Step Bro already has `/accounts/[id]`) | replaced by company page link |
| Queue "mine" | required parity | build (operator session name/email vs assignee tokens) |
| 12 s polling | source-specific cadence | replaced by Step Bro refresh model (§6) — intentional difference |

## 2. Route, navigation, shell

- Route: **`/service-spine`** — flat section folder `src/app/service-spine/`,
  `export const dynamic = "force-dynamic"`, page renders `<Nav
  active="/service-spine">` + `<main>` per house convention. No layout.tsx,
  no parallel routes.
- Sidebar: one `NavItem` `{ href: "/service-spine", label: "Service Spine" }`
  appended to the **Service** group in `src/components/Nav.tsx`
  `NAV_GROUPS`. Text label only — Step Bro's nav has no icon system
  (intentional difference from the task brief's icon suggestion; documented).
  No `recordCountKey` in v1 (deferrable).
- Header: `.eyebrow` "SERVICE OPERATIONS", `.page-title` "Service Spine",
  one-line purpose, last-database-sync time (spine mirror sync time),
  Refresh button (`router.refresh()`), summary metric tokens, board/table
  switch.
- Detail surface: right-hand drawer imitating
  `src/components/orders/OrderDetailDrawer.tsx` (portal, focus trap, Escape,
  `aria-modal`), opened by the `issue` URL param so deep links and browser
  Back work (improvement over source).

## 3. Data architecture (read path)

Step Bro pages read only the local SQLite mirror (`getDb()`); the Management
API is refresher/enrichment-only. The spine gets its **own refresh leg**,
separate from the book digest machinery, because spine tables have real
watermarks (issues/tasks `updated_at`; events append-only bigint `id`) that
the book's digest hack exists to compensate for.

### 3.1 New SQLite tables (owned by the spine refresher; never touched by book seed wipes)

```
spine_issues      (id INTEGER PK, company_id, company_name, issue_type, goal,
                   status, priority, blocking, origin, correlation_key,
                   sla_due_at, latest_summary, last_communication_summary,
                   resolution_summary, opened_at, updated_at, resolved_at,
                   pending_order INTEGER NULL,  -- 1 pending / 0 active / NULL others-or-unknown
                   search_haystack TEXT)        -- precomputed lowercase haystack (source search law)
spine_tasks       (id INTEGER PK, issue_id, company_id, title, owner_kind,
                   status, assignee, lane_skill, gate_label, sla_due_at,
                   created_at, updated_at, completed_at)
spine_task_links  (id INTEGER PK, task_id, link_kind, link_ref, created_at)
spine_issue_stats (issue_id INTEGER PK, event_count, last_event_at,
                   has_draft INTEGER, closure_proposed INTEGER)
spine_agents      (id TEXT PK, name, email, active INTEGER)
spine_meta        (key TEXT PK, value TEXT)  -- watermarks, totals, sync times
```

Indexes: `spine_issues(status)`, `spine_issues(updated_at DESC, id DESC)`,
`spine_issues(company_id, status)`, `spine_tasks(issue_id)`,
`spine_tasks(owner_kind, status)`, `spine_task_links(task_id)`.

Deliberately **not** mirrored: `tasks.detail`/`draft_ref`/`hta_card_ref`
jsonb (PII, unrendered), `issues.ask_ledger`/`promise_ledger` (unread), and
the 160k-row `issue_events` ledger (see §3.3).

### 3.2 Spine refresh leg — `src/lib/db/service-spine-refresh.ts`

- `scheduleServiceSpineRefresh(db)` called from `getDb()` beside
  `scheduleBookRefresh(db)`; own `Symbol.for` guards, `timer.unref()`,
  2-minute tick, 30-minute full reconcile, backoff on 429 via
  `isRateLimited`/`rateLimitResetMs`, never-wipe failure policy, own status
  file `data/service-spine-refresh-status.local.json` (recording
  lastSyncAt / lastFullAt / lastFailureAt).
- Delta tick (aim **one** Management API request when idle): a single CTE
  statement returning JSON columns —
  - issues changed since `issues_wm` (with `company_name` LEFT JOIN and the
    cohort CASE **verbatim from the source law**, `reads.ts:69–118`),
  - tasks changed since `tasks_wm`,
  - task_links created since `links_wm`,
  - events with `id > events_max_id` as `(id, issue_id, kind, at)` only
    (no payload — keeps event PII out of the mirror entirely),
  - exact events totals `(count(*), count(*) FILTER (WHERE issue_id IS NULL))`.
  Watermarks are read back with a small overlap (2 min) and upserts are
  idempotent; watermarks advance only after the SQLite transaction commits.
- Event delta rows update `spine_issue_stats` incrementally
  (count += n, last_event_at = max, has_draft |= kind='draft_created',
  closure_proposed |= kind='closure_proposed').
- Full reconcile: full `spine_issues`/`spine_tasks`/`spine_task_links`
  pulls, a whole-ledger `GROUP BY issue_id` stats rebuild, exact totals, and
  the `internal_agents` directory (id/name/email/active) → `spine_agents`.
  Rows that disappeared upstream are deleted (scoped to reconcile).
- Cohort staleness: pending/active can change without the issue row
  changing; bounded by the 30-minute reconcile. Documented; acceptable v1.
- `search_haystack` recomputed on every issue upsert using the domain label
  laws (raw + labeled status/type words), so SQLite `LIKE` matches exactly
  what the source haystack matched.

### 3.3 Timeline (on demand, not mirrored)

`src/lib/service-spine/timeline.server.ts` — `getSpineIssueTimeline(issueId)`
follows the `remote_cache` pattern (`company-detail.server.ts`): key
`spine-timeline:v1:{issueId}`, 5-minute TTL, in-flight dedup, persisted in
SQLite `remote_cache`. Fetch = the source `EVENTS_SQL` shape (newest 500 +
`count(*) OVER ()` so a capped page still reports the true total) via
`runSupabaseManagementQuery`. Serve `{ events, totalEvents, truncated,
fetchedAt }`, oldest-first. Operator-driven, one issue at a time — the only
per-request Management API use, sanctioned by the durable-enrichment
precedent.

### 3.4 Read service — `src/lib/db/queries/service-spine.ts`

Synchronous prepared statements against `getDb()` (precedent:
`queries/accounts.ts`). One consistent local snapshot per render — this
**structurally eliminates** the source's mid-walk duplicate/gap class; no
fence needed. All filtering/sorting/counting in SQL.

```ts
listSpineBoard(db, q: SpineListQuery & { columnLimit: number }): SpineBoardResult
listSpineTable(db, q: SpineListQuery & { page: number; pageSize: number }): SpineTableResult
getSpineIssueDetail(db, issueId: number): SpineIssueDetail | null   // head + tasks + links (no timeline)
getSpineSummary(db): SpineSummary                                    // whole-mirror header counts
getSpineFilterOptions(db): SpineFilterOptions                        // whole-mirror derived (improvement over loaded-window)
getSpineSyncStatus(): SpineSyncStatus
```

Board grouping in one query: bucket CASE (terminal → `closed`; else
`closure_proposed` → `closure-proposed`; else status verbatim) +
`ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY <sort>)` ≤ columnLimit +
`COUNT(*) OVER (PARTITION BY bucket)` for exact per-column totals. Unknown
statuses become appended columns (parity law). Deterministic order
everywhere: `updated_at DESC, id DESC` (recency) or `priority ASC,
updated_at DESC, id DESC` (priority — lexicographic, parity).

Queue filtering: `human`/`ai`/`human+ai` via task-count columns;
`mine`/`person:` via assignee match tokens (raw assignee expanded through
`spine_agents` to name/email, per the source token law; port
`viewerNameMatches` semantics from the source's `work-lane-core.ts`).

## 4. Mutation boundary — decision: read-only v1

All four source mutations ride harper-tools gateway doors whose far-side
gates default to held/dry-run, with **no idempotency keys** and a mandatory
no-retry/unknown-outcome discipline. Step Bro has a sanctioned Agent Tools
seam, but Service Spine write plumbing **ships dormant by explicit policy**
(`docs/step-bro-adapters.md`: credentials make ready, never active;
`STEP_BRO_SERVICE_SPINE_ENABLED` defaults off). Therefore:

- v1 renders **no fake write controls**. The issue drawer shows
  assignment/completion state read-only, and a quiet line: task and issue
  actions stay in the Actions workbench for now, with an "Open Actions
  workbench" link to `https://actions-parallel.bigbrother.harperinsure.com/?lane=service-spine`
  (the lane is the deepest authoritative link that exists — the source has
  no per-issue URL).
- The read-only **browsing** section itself is not gated behind
  `STEP_BRO_SERVICE_SPINE_ENABLED`: that flag governs systems that *act*
  (desk-driving, writes). A read-only monitor over mirrored book data is
  the same risk class as Records. Documented intentional interpretation.
- Future mutations (out of scope here) must go through the Agent Tools
  adapter with its idempotency ledger, reproduce the applied/held/refused/
  failed classification grammar and the unknown-outcome lock, never retry,
  and sit behind the activation flag.

## 5. URL state — `src/app/service-spine/spine-filter-state.ts`

Copy of the Records triple (parse / serialize / normalize), same invariants:
URL is the only durable filter store; per-field drop on invalid values;
server-side canonical redirect; fixed param order; defaults omitted.

| Param | Values | Default | Validation |
|---|---|---|---|
| `view` | `board` \| `table` | `board` | else drop |
| `q` | free text | empty | trim, cap 200 chars, strip control chars |
| `priority` | `P0`…`P5`-shaped | none | `/^P\d$/` else drop |
| `type` | issue_type key | none | `/^[a-z0-9_]{1,64}$/` else drop |
| `wave` | `MMDD` | none | `/^\d{4}$/` else drop |
| `cohort` | `pending` \| `active` \| `others` | none | else drop |
| `queue` | `all` \| `mine` \| `human` \| `ai` \| `human+ai` \| `person:<name>` | `all` | person name 1–80 chars else drop |
| `sort` | `recency` \| `priority` | `recency` | else drop |
| `rows` | `100` \| `250` \| `500` \| `1000` | `100` | board per-column cap; else drop (caps crafted full-export params) |
| `page` | integer ≥ 1 | `1` | table mode; clamped to last page server-side |
| `issue` | positive integer | none | opens detail drawer; else drop |

Filters are single-select for parity (the source controls are single-select).
`page` resets when the result-set key changes (Records `resultSetKey`
pattern). Filter state survives drawer open/close, company navigation, and
browser Back/Forward.

## 6. Refresh model

- Server: spine mirror refreshes every 2 minutes (delta) / 30 minutes
  (reconcile) — fresher than the task's 5-minute minimum.
- Client: `SpineLiveRefresh` (copy of `RecordsLiveRefresh`, 5-minute
  visibility-aware `router.refresh()`).
- Manual: header Refresh = `router.refresh()` (re-reads the mirror; per
  house rule it does **not** trigger a Supabase pull).
- Header shows the spine mirror's last sync time; "Awaiting first sync"
  empty state before the first successful pull (never fabricated data —
  house honesty rule).
- No duplicate cards possible across refreshes: every render re-queries one
  consistent snapshot keyed by stable issue id.

## 7. Visual system

Step Bro tokens end-to-end (no source CSS): neutral card bodies, colored
status dots, thin borders, `tabular-nums`, 13 px list rows, `.eyebrow` /
`.page-title` / `.chip` / `.status-*` / `.filter-toolbar` recipes; dark/light
via `data-theme` for free. Semantic mapping:

| Meaning | Token |
|---|---|
| Open | `--success` (dot) |
| Waiting on customer | `--warning` |
| Waiting on third party | `--info` |
| Blocked | `--danger` |
| Closure proposed | neutral + `--success-soft` accent |
| Closed | neutral/muted |
| P0 | `--danger`; P1 `--warning`; P2+ neutral |
| SLA soon (<4 h) | `--warning`; breached `--danger` |

Status and priority always carry text labels (never color-only). Board:
horizontal scroll region, fixed ~320 px columns, bounded column scroll with
simple windowed rendering (no new dependency; ~160 px row estimate, overscan
4 — the source's proven numbers). Responsive: ≥lg full board; below lg the
board scrolls horizontally with visible affordance; table mode is the dense
fallback everywhere. `prefers-reduced-motion` respected.

## 8. Accessibility

Semantic regions (`<main>`, per-column `role="region"` with accessible
name including exact count), cards as single-click keyboard-activatable
targets with the company link as a separate keyboard-activatable element
(no nested buttons — source's own pattern), drawer focus trap + focus
restore to the triggering card, `aria-live="polite"` for count/refresh
updates, `aria-current` nav state (free), visible focus rings in both
themes, 200% zoom tolerated by the horizontal-scroll board + table
fallback.

## 9. Security

- Credentials stay server-side (`SUPABASE_ACCESS_TOKEN` via the refresher;
  nothing new exposed to the browser).
- Clerk + proxy gate covers the new route and API automatically;
  `getSessionOperator()` re-checked in the page and API handlers.
- All query params validated per §5; page sizes capped; `issue` id must be
  a positive integer before any statement.
- SQLite statements prepared/parameterized; no operator text interpolated.
- Timeline payloads render as text (React escaping) with technical values
  folded behind a disclosure; no `dangerouslySetInnerHTML`.
- Telemetry/logs are shape-only (`console.warn("service_spine_*", {...})`
  with counts/durations/categories — never goals, summaries, company names,
  or payloads).

## 10. Observability

Structured `console.warn`/`console.log` events: `service_spine_refresh`
(mode, rows, requests, duration), `service_spine_refresh_failed`
(errorCategory), `service_spine_board_query` (duration ms, filtered count —
dev only), `service_spine_timeline_fetch` (issueId, served, truncated,
cache hit/miss), `service_spine_filter_dropped` (field name only).

## 11. Testing plan

- Unit (vitest, node): domain laws (column fold incl. unknown statuses,
  terminal set, labels, wave, queue matching incl. person/mine tokens,
  SLA state, cohort mapping), filter codec triple (parse/serialize/
  normalize round-trips, per-field drop, canonical order, page clamp).
- Data layer (vitest, node, in-memory SQLite): refresh upsert idempotency
  (overlap re-application), stats incremental vs rebuild equivalence,
  board/table query correctness (one-to-many tasks never duplicate issue
  rows; per-column totals exact; deterministic order; every filter and
  combined filters; search haystack matches the source law), summary count
  rules, reconcile delete semantics.
- Live-book tests (self-skipping when `data/underwriter-desk.db` lacks
  spine tables, per `bookIsSynced` precedent): mirror totals match
  `spine_meta` totals; column buckets sum to mirror total.
- Component (vitest, jsdom): board renders columns/counts from props,
  filter toolbar URL round-trip, drawer open/close/focus restore, live
  refresh timer (fake timers, StrictMode), read-only affordance copy.
- Verification: `npm test`, `npm run typecheck`, `npm run lint`,
  `npm run build` (there is no E2E framework in this repo — documented).
- Reconciliation: dev-only artifact `docs/service-spine/reconciliation.md`
  comparing mirror counts/samples against live SQL (Supabase MCP) and
  harper-tools at one observation time. No live IDs hardcoded into
  permanent tests.

## 12. File ownership

**Lead (done before workers start):** `docs/service-spine/*.md`,
`src/lib/service-spine/domain.ts` (shared domain types + laws — the one
contract both workers import; neither worker edits it without flagging).

**Worker A — data layer.** Owns: `src/lib/db/service-spine-refresh.ts`,
`src/lib/db/queries/service-spine.ts`,
`src/lib/service-spine/timeline.server.ts`, spine DDL in
`src/lib/db/migrate.ts` (additive only), the one-line hook in
`src/lib/db/connection.ts`, `tests/service-spine-domain.test.ts`,
`tests/service-spine-refresh.test.ts`, `tests/service-spine-queries.test.ts`,
`tests/service-spine-live-book.test.ts`.

**Worker B — UI.** Owns: `src/app/service-spine/**` (page, filter state,
provider, toolbar, board, table, cards, drawer, live refresh),
`src/app/api/service-spine/issue/[id]/route.ts` (thin handler over Worker
A's functions), the one `NavItem` in `src/components/Nav.tsx`,
`tests/service-spine-filter-state.test.ts`,
`tests/service-spine-board.test.tsx`, `tests/service-spine-drawer.test.tsx`.

Neither worker edits the other's files. Both read
`node_modules/next/dist/docs/` before route/page work (Next 16.3:
`searchParams` is a Promise; no middleware.ts; no `use cache`; flat ESLint).

## 13. Implementation sequence

1. Lead: domain contract (`domain.ts`) — done before workers launch.
2. Worker A: migrate DDL → refresh leg → queries → timeline → tests.
3. Worker B (parallel): filter codec → page shell/header → board/table →
   drawer → nav entry → tests.
4. Lead: integration pass, full verification (`test`/`typecheck`/`lint`/
   `build`), live reconciliation, screenshots, final report.

# Agent 4 — Service Spine: Performance, Scale, Correctness

Audit of `Tatch-AI/harper-coi-workbench` @ `718064e5dd1d78f02d4d54a3a0a5d8525fac83e4` (read-only checkout at `/tmp/hcw-audit-718064e5`), with live read-only measurements against the production spine store (Supabase MCP `user-supabase`, cross-checked via `user-harper-tools` `service_query`). All observation timestamps are UTC, 2026-08-19.

Sources of truth read for this report: `src/lib/service-spine/{reads,gateway-reads,db}.ts`, `src/components/actions/ServiceSpineBoard.tsx`, `src/components/actions/BoardGrammar.tsx` (virtualizer), `src/app/api/action/service-spine/route.ts`, `src/app/api/active-service/board-extra/route.ts`, `src/lib/service/active-service.ts`, `src/lib/service/bound-policy-sql.ts`, the four pinning tests, `next.config.ts`, `railway.json`, `railway/web.railway.json`, `railway/README.md`.

---

## 1. Live volumes (observed timestamps inline)

### service.issues — 3,855 total @ 17:47:02Z (3,856 by 17:53:00Z; one minted during the audit)

| status | rows | class |
|---|---:|---|
| open | 2,309 | non-terminal |
| blocked | 329 | non-terminal |
| waiting_customer | 243 | non-terminal |
| waiting_third_party | 173 | non-terminal |
| resolved | 718 | terminal |
| cancelled | 83 | terminal |

Non-terminal 3,054 (79%); terminal 801 (21%). The table is append-mostly: closures are not keeping pace with minting.

### service.tasks — 7,616 total @ 17:47:15Z

| owner_kind | open (not done/cancelled) | total | breakdown |
|---|---:|---:|---|
| agent | 1,567 | 4,296 | done 2,232 · waiting 943 · todo 539 · cancelled 497 · in_progress 85 |
| human | 3,272 | 3,320 | todo 3,228 · waiting 43 · done 39 · cancelled 9 · in_progress 1 |

Note the human queue shape: 3,228 of 3,320 human tasks sit in `todo` and only 39 are done — the "human open" figure the header paints is effectively the whole human ledger.

### service.issue_events — 159,882 total @ 17:47:16Z

- Suppressions (`issue_id IS NULL`): 33,870 (21% of the table).
- Issues with ≥1 event: 3,855 (every issue).
- Per-issue distribution @ 17:47:19Z: **avg 32.7 · p50 17 · p95 110 · p99 289 · max 1,527** (issue #859; #1940 has 1,347, #2754 has 733).
- Issues past the 500-event timeline cap (`EVENT_ROW_CAP`): **11**; past 100 events: 212 (@ 17:47:41Z).

### Companies & links @ 17:47:22Z

- Distinct companies with issues: **2,608** (0 issues without a company).
- `service.task_links`: 422 rows.

### Growth (weekly, by `created_at` / `at`) @ 17:47:39Z

| week starting | issues created | events appended |
|---|---:|---:|
| 2026-07-27 | 345 | 5,051 |
| 2026-08-03 | 931 | 12,388 |
| 2026-08-10 | 1,963 | 90,868 |
| 2026-08-17 (≈2.6 days) | 616 | 51,577 |

Run rate: **~235 issues/day (~1,650/week)** and **~20k events/day (~140k/week)**. At this pace the issue ledger doubles in ~5 weeks and the events table (197 MB today) roughly doubles per month (~1.3 KB/event incl. indexes → ~180 MB/week). These rates are the single most important input to every recommendation below.

### Cross-check via harper-tools (`service_query`, 17:49Z)

`run_pack open_issues_by_stage` (pool `prod`, 238 stage/priority rows) is consistent in magnitude with the SQL counts — e.g. spine `cancellation` P1 = 439 open + P2 = 212, `general_request` P1 = 192, `endorsement` P0 = 141. The pack also unions legacy `public.service_logs` rows (e.g. `CANCELLATION_ALERT` 317), which the spine board does **not** serve — the two surfaces intentionally read different books.

### Table sizes (pg_class estimates @ 17:48Z)

`service.issues` 4.2 MB · `service.tasks` 4.5 MB · `service.issue_events` **197 MB** · `service.task_links` 216 KB. Public tables the list query touches: `companies` 256 MB (~76k rows) · `deals_v2` 327 MB (~13.7k rows) · `orders_temp` 13 MB (~12.2k rows).

---

## 2. Pagination model and consistency risks

### The mechanics (verified in `reads.ts` / `ServiceSpineBoard.tsx`)

- **Ordering:** `ORDER BY i.updated_at DESC, i.id DESC` — recency of last touch, id tiebreak (`ISSUES_SQL`, reads.ts:372).
- **Offset paging:** `LIMIT $2 OFFSET $3`, page size `SPINE_ISSUE_PAGE = 500`. No cursor, no snapshot.
- **Stopping rule:** every page (including continuations) re-runs `SELECT status, count(*) FROM service.issues GROUP BY status`; `counted` = the sum; `hasMore = offset + served < counted`. An offset ≥ counted returns nothing without touching the list statement (the "offset wall").
- **Summary aggregates** (task tallies GROUP BY, whole-table event count) run on page 0 only; continuations answer `summary: null` (pinned by `service-spine-paging-performance-receipt.test.tsx`, "spends the whole-ledger aggregates ONCE").
- **The 2,000-item loaded set:** the client auto-walk (`SPINE_AUTO_WALK_PAGES = 4` × 500, one page per 250 ms breath) is a **client fetch budget, not a server cap**. The server pages to the end; past 4 pages the operator presses "Load more" per page. At today's 3,856-row book the walk loads 52% and leaves ~1,856 rows behind 4 manual presses.
- **Keep-fresh:** 12 s interval (`SPINE_REFRESH_MS`), re-reads **page 0 only**, folds it over the held window; pages are folded by id with the earlier (fresher) page winning collisions (pinned by `service-spine-page-fold-and-retry-pin.test.tsx`). The tick also refreshes `counted`. There is no visibility-change handling: a mounted board polls every 12 s even in a hidden tab.
- **Retry/fold:** a failed continuation costs one page; the retry is a manual press at that offset alone; the auto-walk attempts a failed page once and goes quiet (all pinned in the paging-receipt and fold-and-retry tests). Refresh and any detail-panel write re-read the whole window from the top.
- **Gateway fallback** (`SERVICE_WRITEBACK_DATABASE_URL` unset): single 200-row page (`service issue list` rejects limit > 200, takes no offset), `counted` folded from served rows, saturation named on screen (pinned by `service-spine-gateway-list-ceiling.test.ts`). Task tallies are enriched by an N+1 `service issue get` per issue, 16 concurrent — 200 issues = 200 gateway round-trips per board read.
- **Caching:** the spine route (`/api/action/service-spine`) is `force-dynamic`, sets no Cache-Control, and has **no server-side cache — every page request from every viewer hits the DB pool**. (Contrast: the adjacent `board-extra` route carries a 2-minute in-process TTL cache, in-flight dedup, and refresh-generation busting; none of that exists on the spine lane.) No websockets or subscriptions anywhere; polling only.

### Duplicate/gap analysis, tied to the ordering

Offset pages over `updated_at DESC` are read near-simultaneously with no snapshot, so a row touched mid-walk moves to the front of the ordering and shifts everything behind it:

- **Duplicates:** a touched row already served on page N re-appears when page N+1's window slides. Handled: the client folds pages by id (`foldPages`), earlier page wins. Duplicates cannot paint twice (pinned).
- **Gaps:** a not-yet-served row that gets touched jumps *ahead* of the walk; the page that would have served it slides past. **Not structurally prevented.** Recovery is indirect: `counted` keeps "Load more" alive while the fold holds fewer rows than the ledger (pinned: "keeps Load more reachable when the folded rows fall short of the count"), and a press with no new offset re-reads the whole window. The code names this honestly (reads.ts "ponytail" note: *recovery is a retry, not a snapshot*), and the UI shows `SPINE_WALK_NOTE` whenever `counted > 2 × 500` — which at 3,856 rows is **always** today.
- **Inserts during the walk** shift every page by one: same gap class, same recovery.
- **The freshly-touched row is always near the top**, so the 12 s page-0 tick usually recovers it within one tick — provided it lands in the top 500, which "just touched + updated_at DESC" guarantees.

Net: correctness is defended by count-checking and re-reads, at the cost of operator presses and whole-window re-fetches on a book that is now ~8 pages and doubling monthly. This is the strongest argument for keyset + fence in Step Bro (§6).

---

## 3. Query cost — EXPLAIN findings (live, 17:48–17:52Z)

### Page one of the exact board list (`ISSUES_SQL` with `$1=['done','cancelled']`, `LIMIT 500 OFFSET 0`)

`EXPLAIN (ANALYZE, BUFFERS)` result: **528.8 ms, 162,401 shared-buffer hits (~1.27 GB touched, 100% cache — zero disk reads today)**. Plan shape:

- **Seq Scan on `service.issues`** (3,856 rows, 406 buffers) — nothing supports the `(updated_at, id)` ordering.
- Both LATERAL aggregates execute for **all 3,856 issues before the sort**, not the 500 served:
  - tasks aggregate: 3,856 loops over `tasks_issue_idx` → 15,279 buffers;
  - events aggregate: 3,856 loops over `issue_events_issue_at_idx` (~33 rows each) → **127,961 buffers, 79% of the statement's IO**.
- Sort: top-N heapsort, 958 KB, then the `pending_order` CASE runs above the sort for only the 500 output rows (Result node).
- The account-stage EXISTS probes were **hashed subplans built once per statement**, not per row: `deals_v2` seq scan (11,795 rows kept, 2,811 buffers) + `orders_temp` seq scan (331 kept of 12,473, 7,192 buffers incl. two nested hashed `deals_v2` scans). Cheap today, but only because the planner chose hashing — the plain-EXPLAIN estimate for the non-hashed fallback was a 74.8-million-cost per-execution scan, and there is **no index on `deals_v2.company_id`** (only partials conditioned on `deal_stage`/`bound_at` that do not match `boundPolicyDealPredicate`) and **no index at all on `orders_temp.company_id`**.

### Deep offset (skeleton of the same shape, `OFFSET 3500`)

133 ms stripped of the wide columns and CASE — the plan still folds **all 3,856** issues' aggregates and sorts before discarding. **Every offset page costs the whole-book fold**; a full 8-page walk of today's ledger ≈ 8 × ~0.5 s ≈ 4 s of DB time, and the auto-walk portion alone ≈ 2.2 s per board mount.

### The other statements

| statement | when it runs | measured |
|---|---|---|
| `GROUP BY status` count | **every page**, every tick | 8.9 ms, 406 buffers (seq scan) |
| tasks `GROUP BY owner_kind,status` | page 0 only | 12.4 ms, 471 buffers |
| whole-table event count + suppressions | page 0 only | 83.4 ms, 17,235 buffers (parallel index-only) |
| timeline read, hottest issue (#859, 1,527 events, `LIMIT 500` + window aggs) | detail open | **27.4 ms**, 1,494 buffers (backward index scan + incremental sort) — healthy |
| company panel list (`issues_company_open_idx`) | account panel | not separately timed; busiest company holds 10 open issues, index-backed — negligible |

### Steady-state cost model

- One open board ≈ (528.8 + 8.9) ms per 12 s tick ≈ **4.5% duty of one connection**; the pool is `max: 3` with `query_timeout: 10s`.
- One board mount ≈ 4 pages + summaries ≈ **~2.3 s of pool time**; a handful of simultaneous mounts queue on the 3 connections.
- Cost scales with **total issues × avg events per issue**, not page size: issues ~2× per 5 weeks, events/issue also rising (33 avg now). Extrapolated, page-one crosses ~1 s within weeks and the 10 s `query_timeout` within a few months — at which point the lane 503s by design ("failures are named"). Today everything is buffer-cache-resident; the events table's ~180 MB/week growth will eventually make the 128k-buffer LATERAL fold IO-bound on cold cache, which multiplies all of the above.

---

## 4. Index inventory

### Live on the spine schema (pg_indexes @ 17:47:48Z)

| table | index | definition (abridged) | serves |
|---|---|---|---|
| issues | `issues_pkey` | (id) | detail head |
| issues | `issues_company_open_idx` | (company_id) WHERE status ∉ (resolved,cancelled) | account panel |
| issues | `issues_origin_correlation_uq` | (origin, correlation_key) partial | writer dedupe |
| issues | `issues_parent_idx` | (parent_issue_id) partial | — |
| issues | `issues_sla_idx` | (sla_due_at) partial, open only | SLA packs |
| tasks | `tasks_pkey` / `tasks_issue_idx` | (id) / (issue_id) | detail, LATERAL tally |
| tasks | `tasks_company_open_idx` | (company_id) partial open | packs |
| tasks | `tasks_human_open_idx` | (owner_kind,status) partial human-open | packs |
| issue_events | `issue_events_pkey` | (id) | — |
| issue_events | `issue_events_issue_at_idx` | (issue_id, at) | timeline read, LATERAL tally |
| issue_events | `issue_events_company_at_idx` | (company_id, at) | company timelines |
| task_links | pkey, (task_id,link_kind,link_ref) uq, (link_kind,link_ref), (company_id) | | detail links |

**Missing for the board:** an index on `issues (updated_at DESC, id DESC)` — the exact list ordering. Its absence is why every page seq-scans + full-folds + sorts.

**Missing on the public side** (for the account-stage cohort): `deals_v2` has no plain `company_id` index and no index matching `boundPolicyDealPredicate` (`is_deleted` false-or-null AND non-empty `policy_number`); `orders_temp` has only its pkey and one unrelated partial. The hashed-subplan strategy hides this at 500 rows; any per-row or per-company probing pattern (the gateway path's chunked `DISTINCT` lookups, or a future keyset page where hashing stops paying) will feel it.

**Repo migrations:** `migrations/` (team-actions, placements-tasks, prod-sandbox) and `sql/` define **none of the `service.*` schema or its indexes** — the spine's DDL is owned outside this repo (harper-tools/BigBrother side). The workbench is a read-only consumer, and Step Bro will be too: index needs below are documentation for the schema owner, not migrations to ship.

---

## 5. Board rendering

- **Kanban (default view):** 6 declared columns plus verbatim extras. Cards are direct children of `VirtualColumnRows` (TanStack `useVirtualizer`: estimate 160 px, overscan 4, initial viewport 900 px) — the DOM holds roughly **10–15 cards per column** regardless of column size. Pinned by `service-spine-copy-and-render-bounds.test.tsx`: a 600-card column reports `data-virtual-count=600` while the DOM carries <100 rows.
- **Table face:** no virtualizer; bounded to `SPINE_TABLE_PAGE = 100` rows with the bound named on screen — but the "Show all" escape renders **every visible row** (3,856 buttons on a fully-walked, unfiltered board). This is the largest render-storm door on the lane today.
- **Slide-over timeline:** newest `SPINE_TIMELINE_PAGE = 40` painted, "Show all loaded" up to the 500-event read cap; each `EventRow` renders a collapsed `<details>` with `JSON.stringify(payload, null, 2)` — 500 stringified payloads on a hot issue when expanded via show-all, acceptable while collapsed.
- **Memoization:** `columns`, `visible`, and the option lists are `useMemo`'d, but **`SpineCard` is not `React.memo`** and every 12 s tick replaces the `issues` array (new row identities), so every mounted card re-renders per tick — bounded to ~<100 cards by virtualization, so harmless today. `SlaChip` keeps a per-card 60 s interval only when actually counting down (deliberate).
- **Re-render risks as the book grows:** (a) the search input has no debounce — each keystroke runs `issueMatchesSearch` over the full loaded set, building a concatenated haystack string per row (O(n) per keypress, n = 3,856 and doubling); (b) `queueOptions`/`cohortOptions` recompute over the full loaded set on every board state change; (c) table "Show all". All linear-time; none pathological yet.

---

## 6. Count semantics

- **Header figures** (issues + per-status dots, agent/human task tallies, event totals): SQL aggregates over the **whole table** — exact, never capped, computed on page 0 and retained by the board (continuations return `summary: null`; the client keeps page one's copy — pinned).
- **`counted` in the paging receipt:** sum of the `GROUP BY status` counts — exact, recomputed on every page read and every tick (it is the walk's stopping rule).
- **"N issues loaded":** client-side length of the folded page window. **Column counts and the "X of Y issues" filter line:** client-side lengths over the *visible* (filtered, loaded) set — honest about being loaded-set counts; the cap-note names "loaded X of Y" whenever loaded < counted.
- **Per-issue tallies** (`agentOpen/…`, `eventCount`, `lastEventAt`, `hasDraft`, `closureProposed`): exact LATERAL aggregates on the list; on the detail read the window functions run over the whole partition **before** the LIMIT, so a capped timeline still reports the true `eventCount` (pinned).
- **Gateway path exception:** `counted` = rows served (max 200) and the summary is folded from served rows — understated by construction, with the ceiling named in the note.
- Nothing anywhere uses approximate counts. At current scale exact counting is right; the 9 ms status count is the only aggregate paid per page.

---

## 7. Production limits

- **Railway edge** (docs + station threads, checked 2026-08-19): max 15-minute HTTP request duration provided data keeps flowing; requests with no data transfer are closed at 5 minutes; 60 s idle keep-alive between requests (HTTP/1.1); 32 KB header cap. None of these bind a 0.5 s page read; a wedged query is cut by the app long before the edge (client `AbortSignal.timeout(60_000)` on list reads, 20 s on detail reads).
- **Deploy shape** (`railway/web.railway.json`): Dockerfile build, `node server.js` (Next standalone), `/api/healthz` with 300 s health timeout, **1 replica**, restart on failure. Single replica means in-process caches are coherent (relevant to board-extra; the spine route has none) and that all viewers share one Node process for JSON serialization of 382 KB pages.
- **DB pool** (`db.ts`): `max: 3` connections, `connectionTimeoutMillis: 8s`, `query_timeout: 10s`, session-pinned `default_transaction_read_only` (fail-closed). The 3-connection ceiling is the earliest binding limit under concurrent viewers; the 10 s query wall is ~19× today's page-one and shrinking as the book grows.
- **Payload:** one 500-row page measured at **382,384 B raw / 12,666 B gzip**, pinned `< 420 KB raw / < 16 KB gzip` per answer (paging-receipt test; the reverted 2,000-row page measured 1.44 MB / 48.4 KB). A full walk of today's book ≈ 8 answers ≈ 3.0 MB raw / ~101 KB gzip.
- **Next.js:** `output: standalone`; the route is `force-dynamic` GET-only (no body limits in play); the lane is a lazy chunk, off the `/actions` first-load JS budget.

---

## 8. Recommendations for Step Bro

### 8.1 Ordering + keyset pagination (the headline change)

Keep the operator-facing order (`updated_at DESC, id DESC`) but replace offset with **keyset + a first-page fence**, and document the one index that makes it cheap:

```sql
-- Documented index need (schema owner's to create; no migration in Step Bro):
-- CREATE INDEX issues_updated_id_desc_idx ON service.issues (updated_at DESC, id DESC);

-- Page 1 (also mints the fence = now() or max(updated_at) served):
SELECT ... FROM service.issues i ...
ORDER BY i.updated_at DESC, i.id DESC
LIMIT 500;

-- Continuations (cursor = last row of previous page; fence = walk start):
SELECT ... FROM service.issues i
WHERE (i.updated_at, i.id) < ($cursor_updated_at, $cursor_id)
  AND i.updated_at <= $fence
ORDER BY i.updated_at DESC, i.id DESC
LIMIT 500;
```

Verified preconditions on live data (17:53:00Z): `updated_at` has **0 NULLs** across 3,856 rows; 5 duplicate `updated_at` values exist, so the id tiebreak is required and already part of the ordering.

Why each piece matters:

- **The index** turns page one from "fold 3,856 LATERALs, sort, keep 500" into an ordered index scan that stops after 500 rows — the LATERALs then run only for served rows (~87% cost cut today, and the cut grows with the book since cost becomes O(page) instead of O(ledger)).
- **Keyset** eliminates the duplicate class entirely (a touched row moves *above* the cursor, never back into the walk) and makes deep pages cost the same as page one.
- **The fence** eliminates the gap class *within the walk*: rows touched after the walk started get `updated_at > fence` and are excluded from continuations instead of silently shifting them — and those exact rows are what the page-0 keep-fresh tick serves, so they are never lost to the operator. Client-side fold-by-id stays as the belt.

### 8.2 Count design

- Keep the exact `GROUP BY status` count as the stopping rule — 9 ms today, and exactness is what makes "loaded X of Y" honest. Don't fold counts from served pages (the gateway path's known lie).
- Keep whole-ledger summaries on page 0 only (the workbench's receipt pattern is correct; preserve it).
- If polling multiplies viewers, cache the count server-side for one tick (5–12 s TTL, in-process) — it changes ~235×/day, not per request.
- At ~10× volume, a partial index `(status)` or a covering `(status) INCLUDE (id)` keeps it index-only; not needed yet.

### 8.3 Per-row aggregate cost (the 79% line item)

- With keyset (8.1) the events LATERAL runs 500× per page instead of 3,856× — acceptable.
- To make it index-only, document a covering index need: `issue_events (issue_id, at) INCLUDE (kind)` (or `(issue_id, kind, at)`) — today `has_draft`/`closure_proposed` force heap fetches (14,622 on one measured page read).
- The durable fix, if the schema owner will take it: denormalized counters on `service.issues` (`event_count`, `last_event_at`, `has_draft`, `closure_proposed`) maintained by the append-only writer — the timeline never mutates, so counters are trivially exact and the biggest table leaves the list query entirely. Document only; no writes from Step Bro.

### 8.4 Account-stage cohort (pending/active) — take it off the row

Resolve the cohort per *company batch*, not per issue row (the gateway path already does this shape): collect the ≤500 distinct company_ids of the served page, run the two `DISTINCT company_id` membership queries chunked, and join client-side. Document the public-side index needs that make either shape cheap: a partial expression index on `deals_v2 (company_id) WHERE (is_deleted IS NOT TRUE) AND COALESCE(TRIM(policy_number),'') <> ''`, and `orders_temp (company_id)` (partial on the live-pending predicate if the owner prefers). Today the hashed-subplan trick makes the inline CASE survivable; do not rely on the planner keeping that choice as tables grow.

### 8.5 Payload budgets

- Keep the workbench's pins: **≤ 500 rows / ≤ 420 KB raw / ≤ 16 KB gzip per answer**, receipts as flat headers. They are measured, tested numbers — inherit them.
- Budget the *mount*, not just the answer: auto-walk ≈ 4 pages ≈ 1.5 MB raw / ~51 KB gzip today. Prefer **server-side filters** (status, priority, type, company, queue) over walking the whole book to filter client-side — the client-only filter model is *why* the whole ledger must be loaded. With the 8.1 index, `WHERE status = ANY(...)` + keyset stays index-ordered. This is the single biggest payload lever: most operator cuts need one page, not eight.
- Timeline: keep the 500-event read cap and the honest truncation note (11 issues already exceed it); add keyset "load older" on `(at, id) < cursor` using the existing `(issue_id, at)` index instead of show-all-or-nothing.

### 8.6 Virtualization and client advice

- Virtualize every long list including the table face (the workbench virtualizes kanban columns but ships a 100-row-bounded table with a "Show all" that renders 3,856 rows — don't inherit that escape hatch; virtualize instead).
- Inherit the proven bounds: ~160 px row estimate, overscan 4, cards as direct virtualizer children (one card per virtual row), stable keys by issue id.
- `React.memo` the card component and keep row object identity stable across ticks for unchanged rows (compare by `updated_at`) so the 12 s refresh re-renders only rows that moved.
- Debounce the search input (~150 ms) and precompute each row's search haystack once per load, not per keystroke.
- Poll page 0 only (the workbench got this right), pause polling on `document.hidden`, and consider an `updated_at > $last_seen` delta read (same index as 8.1) — usually an empty answer instead of 382 KB every 12 s.

### 8.7 Pool and timeout posture

Inherit read-only session pinning, bounded connect/query timeouts, and named failures. Size the pool above 3 if Step Bro expects more than a few concurrent viewers, and keep the query timeout ≥ ~5× the measured p95 page cost *after* the keyset index lands (today's 10 s wall is ~19× but shrinking monthly under growth; re-measure quarterly against §1's growth table).

---

## Appendix: measurement SQL

All statements were `SELECT`-only against the live store via `user-supabase execute_sql`; EXPLAIN ANALYZE was run only on SELECTs the production app itself executes (or strict subsets). Key statements:

```sql
-- volumes
SELECT now(), status, count(*)::int FROM service.issues GROUP BY status;
SELECT now(), owner_kind, status, count(*)::int FROM service.tasks GROUP BY owner_kind, status;
SELECT now(), count(*), count(*) FILTER (WHERE issue_id IS NULL), count(DISTINCT issue_id) FROM service.issue_events;
WITH per_issue AS (SELECT issue_id, count(*) n FROM service.issue_events WHERE issue_id IS NOT NULL GROUP BY issue_id)
SELECT now(), count(*), round(avg(n),1), percentile_cont(0.5) WITHIN GROUP (ORDER BY n),
       percentile_cont(0.95) WITHIN GROUP (ORDER BY n), percentile_cont(0.99) WITHIN GROUP (ORDER BY n), max(n) FROM per_issue;
SELECT now(), date_trunc('week', created_at)::date, count(*)::int FROM service.issues GROUP BY 2 ORDER BY 2 DESC;
SELECT now(), date_trunc('week', at)::date, count(*)::int FROM service.issue_events GROUP BY 2 ORDER BY 2 DESC;

-- plans (the board's exact ISSUES_SQL with $1=ARRAY['done','cancelled'], $2=500, $3=0 inlined)
EXPLAIN (ANALYZE, BUFFERS, TIMING off, SUMMARY) SELECT i.id, i.company_id, c.company_name, /* …full ISSUES_SELECT column list… */
FROM service.issues i LEFT JOIN public.companies c ON c.id = i.company_id
LEFT JOIN LATERAL (/* tasks tally */) t ON true LEFT JOIN LATERAL (/* events tally */) e ON true
ORDER BY i.updated_at DESC, i.id DESC LIMIT 500 OFFSET 0;   -- 528.8 ms, 162,401 buffers

EXPLAIN (ANALYZE, BUFFERS) SELECT id, kind, payload, actor, at, count(*) OVER (),
  bool_or(kind='draft_created') OVER (), bool_or(kind='closure_proposed') OVER ()
FROM service.issue_events WHERE issue_id = 859 ORDER BY at DESC, id DESC LIMIT 500;  -- 27.4 ms

-- keyset preconditions
SELECT count(*) FILTER (WHERE updated_at IS NULL), count(*),
  (SELECT count(*) FROM (SELECT updated_at FROM service.issues GROUP BY updated_at HAVING count(*)>1) d)
FROM service.issues;  -- 0 nulls / 3,856 / 5 tie values @ 17:53:00Z
```

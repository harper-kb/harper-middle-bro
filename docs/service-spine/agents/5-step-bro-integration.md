# Agent 5 — Step Bro integration & design map for the Service Spine section

Scope: everything a Service Spine section (board of service issues on live Harper
data) must plug into inside this repo, with the exact files to touch, the
precedent files to imitate, and the conventions that must not be violated.
All paths are relative to the repo root. Verified against the installed
Next.js 16.3.0 docs in `node_modules/next/dist/docs/`.

---

## 1. Sixty-second architecture orientation

Step Bro (package name `underwriter-desk`) is a Next.js 16.3.0 / React 19.2.8
App Router app with **no remote app database of its own**. The runtime data
path is:

```
Supabase Postgres (Harper prod)
  └─ Management API SQL endpoint (SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF)
       └─ two-minute refresher  src/lib/db/book-refresh.ts
            ├─ atomic JSON snapshot   data/supabase-book.local.json
            └─ local SQLite mirror    data/underwriter-desk.db (better-sqlite3, WAL)
                 └─ synchronous reads from server components / route handlers
```

Pages are server components with `export const dynamic = "force-dynamic"`,
reading the SQLite mirror synchronously (no fetch waterfalls), plus a
five-minute client-side `router.refresh()` loop for visible tabs. Auth is
Clerk, enforced globally in `src/proxy.ts` (Next 16's replacement for
middleware). `cacheComponents` / PPR / `use cache` are **not** enabled — the
"previous model" caching rules apply.

Service Spine plumbing already exists in dormant form:
`src/lib/desk/spine.ts` (`projectSpineNext`, `SpineProjection`),
`src/lib/desk/service-activation.ts` (`serviceSpineEnabled()` reads
`STEP_BRO_SERVICE_SPINE_ENABLED === "true"`), and the Agent Tools adapter
(`src/lib/adapters/agent-tools/*`). See `docs/step-bro-adapters.md`
("Spine / Agent activation") and `docs/step-bro-credentials.md`: credentials
make things *ready*, never *active*; while dormant, `drivesDesk` stays false.

---

## 2. Integration map — exact files to touch

### 2.1 Sidebar entry

| What | File | Detail |
|---|---|---|
| Nav declaration | `src/components/Nav.tsx` | Add one `NavItem` to `NAV_GROUPS` (declared at line ~59). The natural home is the `service` group (`id: "service"`, label "Service"): `{ href: "/service-spine", label: "Service Spine" }`. Items are plain `{ href, label, recordCountKey?, recordsView? }` — no icon field exists. |
| Optional count badge | `src/app/api/navigation-counts/route.ts` + `src/lib/db/queries/accounts.ts:getBookOrderNavigationCounts` | Badges only render for items with a `recordCountKey`, which must be a key of `RecordsNavigationCountsResponse` (`BookOrderNavigationCounts`). Extending it means extending that query + response type; the nav polls it every 30 s (`RECORD_COUNTS_POLL_MS`). Skip for v1 unless an issue count is a requirement. |

Nav behavior you inherit for free (do not reimplement): active state via
`isActivePath` (exact match or `href + "/"` prefix — a future
`/service-spine/[id]` detail route stays highlighted); `aria-current="page"`;
the presence dot on the active item; group collapse persisted in
localStorage key `desk-nav-collapsed` through `useSyncExternalStore` +
`step-bro-nav-collapse` custom event; `autoExpandOnActive` on the Service
group; the mobile slide-over drawer. There is **no icon system** — labels are
text-only; the only SVGs are inline (chevron, sign-out). Keyboard support is
plain tab order with `focus-visible:ring-2 ring-[var(--accent)]` rings and
`aria-expanded` on group headers.

### 2.2 New route

| What | File to create | Precedent to imitate |
|---|---|---|
| Board page | `src/app/service-spine/page.tsx` | `src/app/all-accounts/page.tsx` (thin async page: `searchParams: Promise<...>` handed to a server component) + `src/app/all-accounts/AccountOrdersPage.tsx` (parse → normalize-redirect → query → clamp → render). For a simpler rail+stage board, `src/app/active-service/page.tsx` + `src/lib/sections/section-shell.tsx:SectionLanePage` is the lighter precedent. |
| Colocated components | `src/app/service-spine/*.tsx` (PascalCase), helpers `*.ts` (kebab-case) | The `src/app/all-accounts/` folder is the convention: route-private client components and pure helper modules live beside `page.tsx`; only cross-section pieces go to `src/components/`. |
| Detail surface | Prefer a drawer over a route: imitate `src/components/orders/OrderDetailDrawer.tsx` (portal, hand-rolled focus trap `focusableElements`, Escape at line ~941, 5-min refresh, Retry-After-aware fetch). If a real route is needed: `src/app/service-spine/[id]/page.tsx` imitating `src/app/accounts/[id]/page.tsx` (`params: Promise<{id}>` awaited via `Promise.all`, `notFound()` guards, optional `loading.tsx`). |
| Page skeleton | Every section page renders its own shell — there is **no per-section `layout.tsx`** anywhere: `<Nav active="/service-spine" operator={operator} />` then `<main className="mx-auto max-w-6xl px-4 py-8">` (Records) or `px-4 py-6 lg:px-8` (lanes), with `eyebrow` + `page-title` header block. `export const dynamic = "force-dynamic"` on the page. |

### 2.3 Read service (data layer)

| What | File to create | Precedent |
|---|---|---|
| Spine read service | `src/lib/db/queries/service-spine.ts` (if reading the SQLite mirror) | `src/lib/db/queries/accounts.ts` — synchronous prepared statements against `getDb()` from `src/lib/db/connection.ts`; page-shaped result objects (`listBookAccountsPage` returns rows + totals + facet-ready aggregates); facet queries with self-exclusion (`listBookAccountCarrierFacet`). Barrel note in `src/lib/db.ts`: *new code should import from `@/lib/db/queries/*` directly.* |
| If Spine data needs new mirrored tables | `src/lib/db/book-refresh.ts` (add a scoped SQL read + `buildBook` fields), `src/lib/supabase-book.server.ts` (snapshot schema + validating parser + `*Present` key-presence flag), `src/lib/db/seed.ts` (SQLite upsert), `src/lib/db/migrate.ts` (schema) | Follow the Service Notes mirror end-to-end: `serviceNotesSql` → `SupabaseBook.serviceNoteEntries` → `noteThreadsPresent` → `replaceAccountServiceNotes`. Never advance digests before the book is published (ordering is load-bearing, see comments in `refreshBook`). |
| If Spine data comes over HTTP from another Harper system | `src/lib/adapters/<system>/*` | `src/lib/adapters/bigbrother/` (`client.ts`, `config.ts`, `lane-adapter.ts`, `lane-registry.ts:loadLaneSnapshot`, `sample.ts`) — `import "server-only"`, credentials checked (`bigBrotherConfigured()`), **labeled sample mode** when unconfigured, `mode: "live"` only when counts reconcile. UI consumes typed shapes (`WorkItem`/`LaneSnapshot` in `src/lib/types.ts`), never raw source rows. |
| Live per-item enrichment with durable cache | — | `src/lib/company-detail.server.ts` (`OVERVIEW_TTL_MS` 5 min, stale-while-revalidate 30 min, persisted `remote_cache` SQLite table, revalidated by the refresher via `selectChangedRemoteCacheTargets`). |

**Where Harper credentials live:** the refresher path needs only
`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` (`.env.local`, gitignored;
injected in dev via the `railway run` wrapper in `package.json:dev`). Reads go
through `runSupabaseManagementQuery` in `src/lib/supabase-management.server.ts`
— the Management API SQL endpoint, **not** a `@supabase/supabase-js` client and
not direct Postgres, so RLS is not part of this app's model; authorization is
Clerk + the proxy gate + `getSessionOperator()`. The Management API quota is
shared account-wide and rate-limits the whole desk — do not add per-request
Supabase reads from pages.

### 2.4 API routes (only if client polling is needed)

Create under `src/app/api/service-spine/.../route.ts`, imitating
`src/app/api/navigation-counts/route.ts`: `export const dynamic =
"force-dynamic"`, `Cache-Control: no-store` header, `getSessionOperator()`
first (401 without), try/catch to a 503 with a structured
`console.warn("snake_case_event", { errorCategory })`, and export the response
type from the route file so clients import it as a type
(`export type RecordsNavigationCountsResponse = ...`).

### 2.5 Wiring that already exists for Service Spine

- `src/lib/desk/service-activation.ts` — `serviceSpineEnabled()`; activation
  states `active` / `ready_off` / `not_configured` surfaced with exact copy in
  `src/lib/desk/spine.ts:projectSpineNext` (`statusLabel`).
- `src/lib/adapters/agent-tools/*` — capability discovery, idempotency ledger,
  dispatch with legacy fallback; every write needs server auth, idempotency
  key, confirmation policy, redacted `ActionReceipt` (see
  `docs/step-bro-adapters.md`).
- Rule from those docs: while dormant the Spine renders projections but
  `drivesDesk` remains false — it cannot reorder the operator queue.

---

## 3. Next.js 16.3.0 gotchas (doc citations from `node_modules/next/dist/docs/`)

1. **`params` / `searchParams` are Promises; sync access is fully removed.**
   Type pages as `searchParams: Promise<Record<string, string | string[] |
   undefined>>` and `await` them (`01-app/02-guides/upgrading/version-16.md`
   § "Async Request APIs (Breaking change)"; also `cookies()`, `headers()`).
   Every page in this repo already does this — copy
   `src/app/accounts/[id]/page.tsx`'s `Promise.all([params, searchParams,
   getSessionOperator()])`.
2. **`middleware.ts` is deprecated → `proxy.ts`.** This repo already has
   `src/proxy.ts` (Clerk). Never add a `middleware.ts`; the proxy runtime is
   Node.js and not configurable (`version-16.md` § "`middleware` to `proxy`";
   `01-app/03-api-reference/03-file-conventions/proxy.md`).
3. **No Cache Components here.** `next.config.ts` does not set
   `cacheComponents`, so the *previous model* applies: `fetch` is **not cached
   by default**, `unstable_cache` still exists, and route segment config
   (`dynamic = "force-dynamic"`) is the house pattern
   (`01-app/02-guides/caching-without-cache-components.md`). Do not add
   `use cache` directives — they require the flag.
4. **`revalidateTag` now requires a second `cacheLife`-profile argument**
   (`revalidateTag('x', 'max')`); single-argument form is a TS error. New
   `updateTag` (Server Actions, read-your-writes) and `refresh` exist
   (`version-16.md` § "Caching APIs"). This repo uses none of them — only
   `revalidatePath` in `src/lib/actions.ts` server actions. Don't introduce
   tag caching for the Spine; the book refresh model supersedes it.
5. **Turbopack is the default bundler for dev and build**; dev output lives in
   `.next/dev` and a lockfile prevents concurrent dev/build instances
   (`version-16.md` § "Turbopack by default", "Concurrent dev and build").
   The dev-Clerk stub relies on `turbopack.resolveAlias` — keep any new
   aliases in that block.
6. **`next lint` is removed; `next build` no longer lints** — `npm run lint`
   invokes flat-config ESLint directly (`version-16.md` § "Removals").
7. **Parallel-route slots require explicit `default.js`** (build failure
   without). Not used in this repo — avoid introducing parallel routes
   (`version-16.md` § "Parallel Routes `default.js` requirement").
8. **`PageProps<'/route'>` type helpers** are available via `next typegen` /
   `.next/types` (included in tsconfig) if you want typed params
   (`03-api-reference/03-file-conventions/page.md`); existing pages type
   props manually — either is acceptable.
9. **AGENTS.md managed block**: `next dev` rewrites the
   `<!-- BEGIN:nextjs-agent-rules -->` block; commit it, don't fight it
   (`version-16.md` § "Set up AI agent docs").
10. Smaller landmines if touched: `next/image` local sources with query
    strings need `images.localPatterns.search`; `minimumCacheTTL` default is
    now 4 h; `images.domains` deprecated for `remotePatterns`
    (`version-16.md` § "`next/image` changes").

---

## 4. Reusable primitives & utilities inventory

### Components (`src/components/`)

| Component | File | What it does |
|---|---|---|
| `Nav` | `Nav.tsx` | Fixed left sidebar + mobile top bar/drawer; section registry `NAV_GROUPS`; presence dot; count badges. Every page renders it with `active`. |
| `DeskStage` | `DeskStage.tsx` | The board shell: left ledger rail (search box, filter tabs, scrollable rows with status dots) + right stage (header + collapsible panels). Client-side selection/search/tab state only; data arrives as props. **Closest existing primitive to an issue board.** |
| `SectionLanePage` / `buildSectionStage` | `src/lib/sections/section-shell.tsx` | WorkItem → DeskStage adapter used by all Service lanes; header carries `Open Account` link to `/accounts/{accountId}`. |
| `DeskSection` | `DeskSection.tsx` | Server-friendly collapsible `<details>` section with title + count chip (`.disclosure` recipe). |
| `LaneModeBanner` | `LaneModeBanner.tsx` | The sample/live honesty banner (mode, reason, counts). Required on any surface that can serve non-live data. |
| `StatusPill` | `StatusPill.tsx` | Label + `.status-{neutral,info,success,warning,danger}` pill. Imitate (mapping table) rather than extend — it's typed to `ThreadStatus`. |
| `KpiStrip` | `src/app/all-accounts/KpiStrip.tsx` | Stat strip with tones (`bound`/`pending`/`lost`), tooltips, and filter-preserving drill-down hrefs. |
| `PaginationControls` | `src/app/all-accounts/PaginationControls.tsx` | URL-state pagination bound to the Records provider. |
| `OrderDetailDrawer` | `orders/OrderDetailDrawer.tsx` | Right-hand drawer: portal, focus trap, Escape close, `aria-modal`, 5-min refresh (`ORDER_DETAIL_REFRESH_MS`), Retry-After-aware retry. The detail-surface precedent. |
| `LocalDateTime` | `LocalDateTime.tsx` | Hydration-safe timestamp rendering. |
| `LatestDatabaseSync` | `LatestDatabaseSync.tsx` | Sidebar "Latest database sync" card — polls `/api/book-refresh-status` every 30 s; states Up to date / Stale (>10 min) / Refresh issue / Awaiting sync. |
| `OperationsStatsBar` | `OperationsStatsBar.tsx` | Top bar; 30 s poll of `/api/operations-metrics`; `aria-live="polite"`; shares the refresh timestamp semantics. |
| `CopyButton`, `CarrierLogo`, `RedAlertBanner`, `ThemeToggle` | same-named files | Clipboard button; carrier logo + theme; global alert banner; dark/light toggle (`step-bro-theme` localStorage + `data-theme`). |

### Filter/board utilities (`src/app/all-accounts/`)

`RecordsFilterProvider.tsx` (`useRecordsFilters`, `useOptionalRecordsFilters`,
`useRecordsFilterLink`), `records-filter-state.ts` (full codec, § 5),
`records-navigation.ts` (return-href round trip), `RecordsLiveRefresh.tsx`
(5-min refresh), `RecordsScrollRestoration.tsx`, `records-telemetry.ts`
(redacted diagnostics → `/api/records-telemetry`), `view-config.ts` (view
registry + capability predicates), `AccountFilterToolbar` / 
`CarrierMultiSelect` / `StateSortSelect` / `AccountSearchField` (URL-driven
controls), `RecordsContextBar` (sticky active-filter summary). These are
Records-scoped modules — a new section **copies the pattern** (and may lift
generic helpers), it does not import Records state.

### Design tokens & CSS recipes (`src/app/globals.css`)

- Tailwind **v4** (`@import "tailwindcss"`, `@theme inline`); fonts via
  `next/font`: `--font-display` (Cormorant Garamond), `--font-body` (Source
  Sans 3), `--font-mono` (IBM Plex Mono).
- Semantic tokens, light in `:root` / dark overrides in
  `:root[data-theme="dark"]`: surfaces `--background --surface
  --surface-raised --surface-subtle --surface-hover`; text `--foreground
  --muted`; lines `--border --border-strong`; brand `--harper-orange
  --accent --accent-soft --accent-ink`; status `--danger --success --warning
  --info` each with `-soft`; source identities `--broker` (+ color-mix-derived
  roles) and IQ on `--info`; note colors `--note-producer --note-service`;
  easing `--acct-ease`; z-scale `--z-records-*`. Legacy aliases still used in
  markup: `--ink --paper --sand --rule --pierre --gold --coral`.
- Theme boot: inline `beforeInteractive` script in `src/app/layout.tsx` sets
  `data-theme` pre-hydration (no flash); `ThemePersistence` syncs it.
- Recipes to reuse: `.eyebrow`, `.page-title`, `.font-display`, `.chip`,
  `.btn-primary`, `.btn-ghost`, `.status-*`, `.disclosure`, `.desk-section`,
  `.filter-toolbar/.filter-select/.filter-clear`, `.records-filter-*`
  (chips/popovers/backdrop), `.trace-*` (rail/stage look DeskStage uses),
  `.account-state-badge--{bound,pending,lost}` (semantic lifecycle colors),
  `.note-preview-*`, `.company-*`, `.order-detail-*`.
- Density/typography conventions: 13px list rows, `text-sm` body,
  `tabular-nums` for every number, tiny uppercase tracked eyebrows
  (`text-[10px] uppercase tracking-[0.14em]`), Title Case empty-state copy.
- Accessibility patterns in use: `sr-only` labels, `aria-live="polite"` for
  async regions (stats bar, payment fallback), `aria-expanded` /
  `aria-current`, hand-rolled focus trap + Escape in dialogs
  (`OrderDetailDrawer`, `CompanySearchModal`, `DailyStatsSnapshotDialog`),
  `focus-visible` rings on every interactive element.
- Responsive: single `lg:` breakpoint gates sidebar vs. mobile bar; content
  columns `mx-auto max-w-6xl px-4` or full-width `px-4 lg:px-8`.

---

## 5. Filter-state pattern (the canonical persistence model)

Background: `records-filter-state-persistence-hardening-prompt.md` (repo root)
specified it; the implementation lives in `src/app/all-accounts/` and is the
**mandatory pattern for any new filterable section**. The URL is the durable
state; nothing filter-shaped goes to localStorage.

Core module `src/app/all-accounts/records-filter-state.ts`:

- `RecordsFilterState` — one shape read/written by every surface (rows, KPI
  strip, controls, sticky summary, pagination, sidebar, detail round trip).
  Includes `passthrough` for params the section does not own.
- `parseRecordsFilterState(view, params)` — the **only** request→state door;
  `serializeRecordsFilterState(state)` — the **only** state→URL door, emitting
  params in fixed `RECORDS_FILTER_PARAM_ORDER`, omitting defaults (a clean
  view is its bare path); `normalizeRecordsFilterState` — the **only** place
  deciding which filters may coexist (dependent filters cleared field-by-field).
- The load-bearing invariant: *an unrecognised value is dropped on its own
  field, never by resetting the model* — a stale key, repeated param,
  hand-typed junk, or out-of-range page each costs exactly that field.
- Field codecs are owned by their domain modules and round-tripped for
  dedupe/sort/cap: `src/lib/carrier-filter.ts`, `src/lib/location-state.ts`,
  `src/lib/iq-stage.ts`, `src/lib/broker-gate.ts`, `src/lib/account-sort.ts`,
  `src/lib/account-source.ts`, `src/lib/order-reporting.ts`.
- Helpers: `updateRecordsFilters` (merge patch; auto page-reset when the
  result set changed — `resultSetKey`), `withRecordsView` (view switch keeps
  every filter the destination supports; capability predicates in
  `view-config.ts:supportsSourcePipelineFilters/supportsDateRange`),
  `clampRecordsPage`, `clearRecordsFilters` (intentional reset keeps
  `passthrough`), `recordsFilterHref`, `isCanonicalRecordsQuery` +
  `rawRecordsQuery`, `readRecordsParam`/`readRecordsListParam` (collapse the
  `string | string[]` runtime shape).

Server side (`AccountOrdersPage.tsx`): parse once → `redirect()` to the
canonical URL when `!isCanonicalRecordsQuery` (settles in one hop because
parsing is idempotent) → query → `clampRecordsPage` + redirect if live data
shrank under the page → render inside `RecordsFilterProvider state={state}`.

Client side (`RecordsFilterProvider.tsx`): a `useSyncExternalStore`-backed
`RecordsFilterStore` holds "latest requested state" so rapid changes compose
(carrier click at 0 ms + debounced search at 200 ms → one URL with both);
server payloads are accepted, ignored as stale, or promoted as Back/Forward
(popstate marks history navigation); navigation via `useTransition` +
`router.push` (deliberate changes) / `router.replace` (typing), always
`{ scroll: false }`. `useRecordsFilterLink` keeps real-link semantics
(prefetch/middle-click) while plain clicks navigate from the latest state.

Back/forward & round trip (`records-navigation.ts`): account links carry
`?recordsReturn=<canonical records URL>`; `parseRecordsReturnHref` validates
it as untrusted input (app-relative only, Records paths only, re-serialized
canonically — open-redirect proof); `recordsNavigationHrefs` gives the
sidebar per-view hrefs that preserve context from detail pages.

Scroll (`RecordsScrollRestoration.tsx`): sessionStorage under an FNV-1a hash
of the canonical href, `{y, at}` only, 30-min TTL.

Telemetry (`records-telemetry.ts`): shape-only redacted events
(`recordsStateHash`, field lists, query *length* — never values) reported on
init/normalize/clamp/transition to `/api/records-telemetry`.

For Service Spine: create `src/app/service-spine/spine-filter-state.ts` (+
provider) with the same parse/serialize/normalize triple, param order, and
per-field drop invariant; reuse the domain codecs where the axes overlap
(carrier, location state, sort) and add Spine-owned axes (issue status,
severity, assignee…) as new codec modules following the same
`parseX/serializeX` shape. Tests exist to copy:
`tests/records-filter-state.test.ts`, `tests/records-filter-races.test.tsx`,
`tests/records-navigation.test.tsx`.

---

## 6. Refresh model ("five-minute refresh" and everything under it)

Two independent layers plus status surfaces — no ISR, no `revalidate`
exports, no cache tags:

**Server, every 2 minutes** — `src/lib/db/book-refresh.ts`:
`scheduleBookRefresh(db)` (called from `getDb()` in
`src/lib/db/connection.ts`, so any DB touch keeps the book current;
idempotent per process via `Symbol.for("stepbro.bookRefreshScheduled")`;
`timer.unref()`). `REFRESH_INTERVAL_MS = 2 * 60 * 1000`. Each tick is a
digest-sweep delta (`src/lib/db/book-digest.ts` — Harper has no `updated_at`,
so short hashes per order/company decide what to refetch);
`FULL_RECONCILE_INTERVAL_MS = 30 * 60 * 1000` forces a whole-book pull (clock
persisted on disk so restarts don't spend quota). Failure policy: never wipe;
rate-limited ticks wait out the reported quota window
(`rateLimitResetMs`), other failures keep the last good book. Serial queries,
never parallel (six concurrent statements tripped the shared 429). The
historical five-minute whole-book pull is what the two-minute delta replaced
(see the header comment) — the "five-minute" number the task mentions now
lives on the **client** side.

**Client, every 5 minutes** —
`src/app/all-accounts/RecordsLiveRefresh.tsx`:
`RECORDS_LIVE_REFRESH_MS = 5 * 60_000`; visible tabs call `router.refresh()`
(re-runs the RSC payload; URL-owned filters untouched), hidden tabs defer and
catch up on visibilitychange. Mount one of these (or a copy) in the Spine
page. Same 5-minute constant on detail surfaces:
`ORDER_DETAIL_REFRESH_MS` (`OrderDetailDrawer.tsx`),
`COMPANY_OVERVIEW_REFRESH_MS` (`CompanyDetailOverview.tsx`), and the server
TTL `OVERVIEW_TTL_MS` in `company-detail.server.ts`.

**Last-refreshed indicators** — `src/lib/db/book-refresh-status.ts`
(`readBookRefreshStatus` / `recordBookRefreshSuccess` / 
`recordBookRefreshFailure` → `data/book-refresh-status.local.json`), exposed
by `src/app/api/book-refresh-status/route.ts`, rendered by
`LatestDatabaseSync` (sidebar; 30 s poll; `STALE_AFTER_MS = 10 min`) and
`OperationsStatsBar`. The Records empty state even names the cadence: "the
two-minute refresh will fill this in."

**Manual refresh affordances** — none per-section for the book. `POST
/api/book/sync` (operator-gated) re-syncs the legacy Harper path;
`refreshCompanyServiceNotes` is a write-through used after a note POST so the
author reads their own write. A Spine section should *not* add a manual
book-refresh button; if it has its own writes, follow the write-through
pattern.

---

## 7. Company navigation

Canonical company detail route: **`/accounts/[id]`** with the stable ID
`co-{companies.id}` (Supabase `public.companies.id`), e.g. `/accounts/co-917669`.
Built by `accountDetailHref` (`src/app/all-accounts/records-navigation.ts`)
or plain `` `/accounts/${accountId}` `` (see `section-shell.tsx`'s "Open
Account"). The page 404s (`notFound()`) unless the operator session resolves
AND the id matches `^co-(\d+)$` AND `getAccountDetail(id)` finds it in the
local book (`docs/company-detail-data.md` documents this contract). Order
grain is `order-{orders_temp.id}` with `harperOrderId` numeric — issue cards
that reference an order should carry both `accountId` and `harperOrderId`
(the drawer needs `companyId` + `orderId`). Only append `?recordsReturn=` if
you implement a validated equivalent; otherwise omit it.

---

## 8. Testing conventions

- Runner: **Vitest 4** (`npm test` = `vitest run`); config `vitest.config.ts`:
  environment **node** by default, includes `tests/**/*.test.{ts,tsx}`
  (flat directory, kebab-case names), `testTimeout: 10_000`, aliases
  `@/*`→`src/*` and `server-only`→`test/stubs/server-only.ts` (empty stub so
  server modules unit-test directly).
- Component tests: `// @vitest-environment jsdom` pragma at the top, then
  `@testing-library/react` + `@testing-library/user-event`;
  `vi.mock("next/navigation", ...)` for router; `vi.useFakeTimers()` for
  polling components; `StrictMode` render to catch effect leaks
  (`tests/records-live-refresh.test.tsx` is the template).
- Data-layer tests, two flavors: pure query/codec tests
  (`tests/records-filter-state.test.ts`, `tests/carrier-filter.test.ts`) and
  **live-book integration tests** that open `data/underwriter-desk.db`
  read-only and `describe.skip` themselves when the book isn't synced
  (`tests/accounts-carrier-live.test.ts:bookIsSynced` — count > 100 guard).
- Shared test fixtures as `tests/*-test-utils.tsx`
  (`records-filter-test-utils.tsx` wraps `RecordsFilterProvider`).
- `test/` (singular) holds only stubs. `scripts/` holds ~80 one-off
  check/stress scripts (`*-check.ts`, `coi-stress.ts`…) — knip entry points,
  not part of `npm test`. There is **no E2E framework and no
  production-build test script**; verification is `npm test`, `npm run
  typecheck`, `npm run lint`, `npm run build`.

---

## 9. Everything else a new section must respect

- **Auth**: `src/proxy.ts` (Clerk `clerkMiddleware` under the Next 16 proxy
  convention) protects every non-public route including `/api/*` (401/403
  JSON for APIs, redirect for pages) and requires a **verified
  @harperinsure.com** primary email (`isAllowedOperatorEmail`,
  `src/lib/session/allowed-email.ts`). New routes are covered automatically.
  Inside handlers/pages, still call `getSessionOperator()`
  (`src/lib/session/session.ts`) — defense in depth and the operator object.
- **Dev stubs**: `DEV_NO_AUTH=1` + non-production aliases `@clerk/nextjs` →
  `dev-clerk-stub.tsx` / `dev-clerk-server-stub.ts` via
  `turbopack.resolveAlias` (`next.config.ts`); `getSessionOperator` returns
  the first seeded operator. Keep new code compatible (no direct Clerk client
  calls in page paths).
- **Env conventions**: server-only vars read via `process.env` inside
  server modules; documented in `docs/step-bro-credentials.md` /
  `docs/step-bro-adapters.md`. Spine flag `STEP_BRO_SERVICE_SPINE_ENABLED`
  ("true" only, defaults off — never default it on). `.env.local` gitignored.
- **Lint**: `eslint.config.mjs` — flat config,
  `eslint-config-next/core-web-vitals` + `/typescript`, no custom rule
  relaxations (the only ignores are the vendored PDF template files). Code
  compiles under `strict` TS; `npm run typecheck` must pass.
- **knip**: `knip.json` — `exports` rule off, project = `src/**`,
  `scripts/**`, `test/**`, root `*.ts(x)`; new script entries belong in
  `entry` if not reachable.
- **Path alias**: only `@/*` → `./src/*` (tsconfig `paths`); mirrored in
  vitest config. No other aliases.
- **`serverExternalPackages: ["better-sqlite3"]`** in `next.config.ts` — any
  new native dep needs the same treatment.
- **Naming/exports**: named exports everywhere except Next-required defaults
  (`page.tsx`, `layout.tsx`, `proxy.ts`); PascalCase component files,
  kebab-case modules; `.server.ts` suffix or `import "server-only"` for
  server-only modules; structured `console.warn("snake_case_event", {...})`
  logging with `errorCategory`, never raw errors with payloads.
- **Money**: integer cents (`decimalToCents`) and six-decimal micros
  (`decimalToMicros`) until final display rounding; `Intl.NumberFormat` at
  the edge. Never float arithmetic on money.
- **Honesty rules** (repo-wide, from `docs/step-bro-credentials.md`): never
  unlabeled or fabricated live numbers; sample mode is labeled
  (`LaneModeBanner`); "blank beats wrong" for unknown values ("No status",
  "Gate unavailable", "—").

---

## 10. Explicit DO-NOT list

1. **Do not store filter state anywhere but the URL.** No `useState`-owned
   filters, no localStorage/sessionStorage filters, no `useSearchParams`
   ad-hoc parsing. Parse/serialize/normalize through one module (§ 5).
   localStorage is only for UI chrome (theme, nav collapse); sessionStorage
   only for scroll positions.
2. **Do not reset the whole filter model on a bad param** — drop the field.
   And never "fix" a non-canonical URL client-side; the server redirect owns
   normalization.
3. **Do not query Supabase (Management API or otherwise) from page renders or
   client code.** Pages read the local SQLite mirror synchronously. The
   Management API is for the refresher and durable-cached enrichment only —
   its quota is shared and rate-limits the whole desk. Never call HWS/BB
   product routes from the browser (`docs/step-bro-adapters.md` § Browser rule).
4. **Do not copy BigBrother SQL into Step Bro** — reads go through
   `src/lib/adapters/bigbrother/*` typed seams (`WorkItem`/`LaneSnapshot`),
   or through the book snapshot.
5. **Do not fabricate lifecycle states or numbers.** Unknown → skip or label
   ("No status"); policy numbers only from bound deals; unreconciled counts
   stay in labeled Sample Mode.
6. **Do not add `use cache`, `cacheComponents`, ISR `revalidate` exports, or
   `revalidateTag`** — the repo's freshness model is force-dynamic + 2-min
   server refresh + 5-min client refresh. (If you ever did use
   `revalidateTag`, Next 16 requires the 2-arg form — § 3.4.)
7. **Do not create `middleware.ts`**, a second proxy, or per-section auth —
   `src/proxy.ts` + `getSessionOperator()` is the whole story.
8. **Do not add nested/section `layout.tsx` or parallel routes** — sections
   are flat folders whose `page.tsx` renders `<Nav>` + `<main>` directly.
9. **Do not import server modules into client components** — the
   `server-only` marker throws; keep client components leaf-level and pass
   plain props from the server page.
10. **Do not introduce an icon library, new fonts, hardcoded hex colors, or a
    second styling system** — inline SVG, the three `next/font` families, and
    the CSS custom-property tokens (dark mode comes free via
    `data-theme`).
11. **Do not put PII/instrument data in snapshots, telemetry, or logs** —
    telemetry is shape-only (counts, hashes, lengths); payment instruments
    and hosted URLs never leave the server (`docs/company-detail-data.md`).
12. **Do not add manual whole-book refresh buttons or extra polling loops** —
    reuse the existing cadences (30 s status polls, 5-min refresh); hidden
    tabs must not poll (`RecordsLiveRefresh` visibility guard is the norm).
13. **Do not activate Service Spine by default** — `ready_off` until
    `STEP_BRO_SERVICE_SPINE_ENABLED === "true"`; while dormant the projection
    may render but must not drive the desk (`drivesDesk: false`).
14. **Do not edit the AGENTS.md managed block, commit `.env.local` or
    `data/*.local.json`/`data/underwriter-desk.db`,** or fight the `next dev`
    regenerated files.
15. **Do not use default exports for non-route modules, `next/legacy/image`,
    `images.domains`, or `npx next lint`** (removed in 16).

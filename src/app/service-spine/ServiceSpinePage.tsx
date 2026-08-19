import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { getDb } from "@/lib/db/connection";
import { readSpineRefreshStatus } from "@/lib/db/service-spine-refresh";
import {
  getSpineFilterOptions,
  getSpineSummary,
  listSpineBoard,
  listSpineTable,
} from "@/lib/db/queries/service-spine";
import {
  SPINE_TABLE_PAGE_SIZE,
  SPINE_QUEUE_ALL,
  type SpineBoardResult,
  type SpineFilterOptions,
  type SpineListQuery,
  type SpineSummary,
  type SpineTableResult,
} from "@/lib/service-spine/domain";
import { getSessionOperator } from "@/lib/session/session";
import { SpineBoard } from "./SpineBoard";
import { SpineFilterProvider } from "./SpineFilterProvider";
import { SpineFilterToolbar } from "./SpineFilterToolbar";
import { SpineIssueDrawer } from "./SpineIssueDrawer";
import { SpineLiveRefresh, SpineRefreshButton } from "./SpineLiveRefresh";
import { ServiceSpineHeader } from "./ServiceSpineHeader";
import {
  ServiceHealthSummary,
  type SpineOperationalCounts,
} from "./SpineSummaryStrip";
import { SpineTable } from "./SpineTable";
import {
  droppedSpineParams,
  isCanonicalSpineQuery,
  parseSpineFilterState,
  spineFilterHref,
  type SpineSearchParams,
} from "./spine-filter-state";

/**
 * The Service Spine section (read-only v1): parse → canonical redirect →
 * one consistent mirror snapshot → header, summary strip, toolbar, the board
 * or table face, and the drawer mount. All reads hit the local SQLite mirror;
 * the only per-request Management API use is the drawer's timeline, behind
 * the API route.
 */
export async function ServiceSpinePage({
  searchParams,
}: {
  searchParams: Promise<SpineSearchParams>;
}) {
  const params = await searchParams;
  // One parse for the whole page: counts, controls, faces and every outbound
  // link read this one state.
  const state = parseSpineFilterState(params);
  if (!isCanonicalSpineQuery(state, params)) {
    // The request spelled its own state some other way — each invalid value
    // was already dropped on its own field; this only rewrites the URL to
    // match the state that survived. Field names only, never values.
    const dropped = droppedSpineParams(state, params);
    if (dropped.length > 0) {
      console.warn("service_spine_filter_dropped", { fields: dropped });
    }
    redirect(spineFilterHref(state));
  }

  const operator = await getSessionOperator();
  // Touching the local database also starts the idempotent two-minute mirror
  // refresher. Do this even before the first successful sync so a direct visit
  // cannot wait forever for some other section to open the database first.
  const db = getDb();
  const sync = readSpineRefreshStatus();
  const awaitingFirstSync = sync.lastSyncAt === null;

  let summary: SpineSummary | null = null;
  let options: SpineFilterOptions | null = null;
  let board: SpineBoardResult | null = null;
  let table: SpineTableResult | null = null;
  let healthCounts: SpineOperationalCounts | null = null;
  let readError = false;

  if (!awaitingFirstSync) {
    const listQuery: SpineListQuery = {
      search: state.q,
      priority: state.priority,
      issueType: state.type,
      wave: state.wave,
      cohort: state.cohort,
      queue: state.queue,
      viewer: {
        name: operator?.displayName ?? null,
        email: operator?.email ?? null,
      },
      sort: state.sort,
    };
    try {
      summary = getSpineSummary(db);
      options = getSpineFilterOptions(db);
      // The health cards are whole-book operational queues, not raw statuses
      // and not affected by the current workspace filters. This reuses the
      // canonical board fold with a one-row payload; no business rule is
      // duplicated in the presentation layer.
      const healthBoard = listSpineBoard(db, {
        ...listQuery,
        search: "",
        priority: null,
        issueType: null,
        wave: null,
        cohort: null,
        queue: SPINE_QUEUE_ALL,
        sort: "recency",
        columnLimit: 1,
      });
      const count = (id: string) =>
        healthBoard.columns.find((column) => column.id === id)?.total ?? 0;
      healthCounts = {
        open: count("open"),
        blocked: count("blocked"),
        waitingCustomer: count("waiting_customer"),
        waitingThirdParty: count("waiting_third_party"),
        closureReview: count("closure-proposed"),
      };

      if (state.view === "table") {
        table = listSpineTable(db, {
          ...listQuery,
          page: state.page,
          pageSize: SPINE_TABLE_PAGE_SIZE,
        });
        const pageCount = Math.max(1, table.pageCount);
        if (state.page > pageCount) {
          redirect(spineFilterHref({ ...state, page: pageCount }));
        }
      } else {
        board = listSpineBoard(db, { ...listQuery, columnLimit: state.rows });
      }
    } catch (cause) {
      readError = true;
      console.warn("service_spine_page_read_failed", {
        errorCategory:
          cause instanceof Error ? cause.name : "unknown_spine_read_error",
      });
    }
  }

  const filteredTotal = board?.filteredTotal ?? table?.filteredTotal ?? 0;
  const mirrorTotal = board?.mirrorTotal ?? table?.mirrorTotal ?? 0;
  const loadedTotal =
    board?.columns.reduce((total, column) => total + column.rows.length, 0) ??
    table?.rows.length ??
    0;
  // One clock for every SLA chip and relative time on the page — server
  // render and hydration agree, and the 5-minute refresh re-reads it.
  const nowMs = new Date().getTime();

  return (
    <SpineFilterProvider state={state}>
      <Nav active="/service-spine" operator={operator} />
      <SpineLiveRefresh />
      <main className="spine-page px-3 py-5 sm:px-4 lg:px-6 xl:px-8">
        <ServiceSpineHeader sync={sync} />

        {awaitingFirstSync ? (
          <div className="surface-card mt-5 px-6 py-10 text-center">
            <p className="text-sm font-semibold text-[var(--ink)]">
              Awaiting first sync
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
              The spine mirror has not completed its first pull yet. Issues
              appear here within about two minutes of the first successful
              sync — nothing is shown until it is real.
            </p>
            <div className="mt-4 flex justify-center">
              <SpineRefreshButton />
            </div>
          </div>
        ) : readError ||
          summary === null ||
          options === null ||
          healthCounts === null ? (
          <div
            role="alert"
            className="surface-card mt-5 px-6 py-8 text-center"
          >
            <p className="text-sm font-semibold text-[var(--ink)]">
              Service Spine is temporarily unavailable
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
              The last good mirror remains intact. Refresh this view to try
              the local read again.
            </p>
            <div className="mt-4 flex justify-center">
              <SpineRefreshButton />
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4">
              <ServiceHealthSummary
                summary={summary}
                counts={healthCounts}
              />
            </div>
            <div className="mt-3">
              <SpineFilterToolbar
                options={options}
                filteredTotal={filteredTotal}
                mirrorTotal={mirrorTotal}
                loadedTotal={loadedTotal}
              />
            </div>
            <div className="mt-3">
              {board ? (
                <SpineBoard
                  result={board}
                  rowsCap={state.rows}
                  nowMs={nowMs}
                />
              ) : table ? (
                <SpineTable result={table} nowMs={nowMs} />
              ) : null}
            </div>
          </>
        )}

        <SpineIssueDrawer />
      </main>
    </SpineFilterProvider>
  );
}

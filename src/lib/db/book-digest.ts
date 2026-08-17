import type Database from "better-sqlite3";
import { runSupabaseManagementQuery } from "../supabase-management.server";

/**
 * Change detection for the incremental book refresh.
 *
 * Harper carries no `updated_at` on `orders_temp`, `deals_v2`,
 * `service_note_entries` or `service_workbench_gate_overrides` — verified
 * against the live schema, where only `companies` has one. A watermark is
 * therefore not an option: a deal moving `sold -> lost` changes what the
 * accounts view shows and stamps nothing, so a `WHERE updated_at > last_tick`
 * refresh would serve a stale Pending order indefinitely.
 *
 * Instead every tick asks Harper for one short hash per eligible order and per
 * book company, covering every field the book persists. Comparing hashes needs
 * no timestamps: a row whose hash matches is provably unchanged, a row whose
 * hash differs is refetched in full, and a row missing from the sweep has left
 * the book. Measured against the live book: 22,094 rows, 1.15 MB, ~1.4s — a
 * thirtieth of the 22 MB the full-book pull moves.
 *
 * Two derivations deliberately sit outside the digest because they live in
 * directory tables rather than on the order: the carrier/wholesaler display
 * names resolved through `insurance_carriers` / `general_agents`, and the
 * producer and note-author names resolved through `producers` /
 * `internal_agents`. A rename there changes the rendered card without changing
 * any order, so it is picked up by the periodic full reconcile rather than by
 * the tick.
 */

export type BookDigestKind = "order" | "company";

export interface BookDigestRow {
  kind: BookDigestKind;
  /** Harper's numeric id as text — `orders_temp.id` or `companies.id`. */
  id: string;
  digest: string;
}

export interface BookDelta {
  /** Eligible orders that are new or whose content changed. */
  changedOrderIds: number[];
  /** Orders that were in the book and are no longer eligible. */
  departedOrderIds: number[];
  changedCompanyIds: number[];
  departedCompanyIds: number[];
}

/**
 * Book eligibility, character for character the same rule the full refresh
 * applies: a non-test company's non-deleted order carrying at least one
 * non-deleted deal in a recognized lifecycle stage. If this drifts from
 * `ORDERS_SQL`, ids would churn in and out of the book on every tick.
 */
const ELIGIBLE_ORDERS_CTE = `
eligible_orders AS (
  SELECT ot.id, ot.company_id
  FROM public.orders_temp ot
  JOIN public.companies c
    ON c.id = ot.company_id AND COALESCE(c.is_testing_user, false) = false
  WHERE COALESCE(ot.is_deleted, false) = false
    AND EXISTS (
      SELECT 1 FROM public.deals_v2 d
      WHERE d.order_number = ot.id
        AND COALESCE(d.is_deleted, false) = false
        AND d.deal_stage IN ('bound', 'sold', 'confirmed', 'paid', 'lost')
    )
)`;

/**
 * 48 bits of hash per row. Change detection is per id, not across the book, so
 * a missed change needs a collision on that one row against its own previous
 * value — while the full digest would add ~450KB to every tick.
 */
const DIGEST_WIDTH = 12;

/**
 * One request, both grains, discriminated by `kind`: the Management API
 * returns a single array per statement, and this must not cost two calls
 * against a quota the whole desk shares.
 *
 * The order digest folds in the order row, every non-deleted deal (ordered by
 * id so the aggregate is deterministic), the newest gate override and the
 * latest visible service note — plus the company's visible note count, which
 * is what the collapsed row renders, so a note added to one order correctly
 * invalidates its siblings.
 *
 * The company digest additionally folds in the company-wide visible note
 * count and newest note id across *all* the company's notes, not just those
 * on book-eligible orders: the mirrored Service Note thread is account-scoped
 * and shows entries anchored to non-book orders too, so a note landing on one
 * of those must still flag the company for a notes refetch.
 *
 * It also covers the company-page overview mirror: address, city, postal
 * code, stored timezone, the assigned-producer slug, and contact names
 * alongside the contact keys. Producer *renames* live in the producers
 * directory outside the digest and are picked up by the periodic full
 * reconcile, same as carrier display names.
 */
export const BOOK_SWEEP_SQL = `
WITH ${ELIGIBLE_ORDERS_CTE},
deal_digest AS (
  SELECT d.order_number AS id,
         string_agg(
           concat_ws('|', d.id, d.deal_stage, d.carrier, d.ai_carrier,
                     d.wholesaler, d.ai_wholesaler, d.premium, d.policy_number,
                     d.is_instant_quote, COALESCE(d.ai_bound_at, d.bound_at),
                     d.effective_date, d.expiration_date),
           ';' ORDER BY d.id
         ) AS text
  FROM public.deals_v2 d
  WHERE d.order_number IN (SELECT id FROM eligible_orders)
    AND COALESCE(d.is_deleted, false) = false
  GROUP BY d.order_number
),
gate_digest AS (
  SELECT DISTINCT ON (g.order_id)
    g.order_id AS id, concat_ws('|', g.current_gate, g.created_at) AS text
  FROM public.service_workbench_gate_overrides g
  WHERE g.order_id IN (SELECT id FROM eligible_orders)
  ORDER BY g.order_id, g.created_at DESC, g.id DESC
),
note_rows AS (
  SELECT e.id, e.order_id, e.body, e.created_at,
         e.author_internal_agent_id,
         COUNT(*) OVER (PARTITION BY e.company_id) AS note_count,
         ROW_NUMBER() OVER (
           PARTITION BY e.order_id ORDER BY e.created_at DESC NULLS LAST, e.id DESC
         ) AS rn
  FROM public.service_note_entries e
  WHERE e.deleted_at IS NULL
    AND e.order_id IN (SELECT id FROM eligible_orders)
),
note_digest AS (
  SELECT order_id AS id,
         concat_ws('|', id, created_at, author_internal_agent_id,
                   md5(COALESCE(body, '')), note_count) AS text
  FROM note_rows WHERE rn = 1
)
SELECT 'order' AS kind, o.id::text AS id,
  substr(md5(concat_ws('|',
    ot.company_id, ot.created_at, ot.ordered_date, ot.payment_type,
    ot.pfa_quote_number, md5(COALESCE(ot.order_documents::text, '')),
    md5(COALESCE(ot.taxes::text, '')), md5(COALESCE(ot.fees::text, '')),
    ot.total_premium, ot.commission_revenue, ot.harper_service_fee,
    ot.total_revenue, ot.initial_payment_date,
    md5(COALESCE(ot.producer_notes, '')), ot.producer_notes_updated_at,
    ot.producer_notes_updated_by, ot.producer, ot.tag,
    dd.text, gd.text, nd.text
  )), 1, ${DIGEST_WIDTH}) AS digest
FROM eligible_orders o
JOIN public.orders_temp ot ON ot.id = o.id
LEFT JOIN deal_digest dd ON dd.id = o.id
LEFT JOIN gate_digest gd ON gd.id = o.id
LEFT JOIN note_digest nd ON nd.id = o.id

UNION ALL

SELECT 'company', c.id::text,
  substr(md5(concat_ws('|',
    c.company_name, c.company_industry, c.company_state, c.general_stage::text,
    lower(TRIM(COALESCE(c.company_primary_email, ''))),
    regexp_replace(COALESCE(c.company_primary_phone, ''), '[^0-9]', '', 'g'),
    c.company_street_address_1, c.company_street_address_2, c.company_city,
    c.company_postal_code, c.company_timezone, c.producer_assigned,
    (
      SELECT string_agg(
        concat_ws('|', TRIM(COALESCE(cc.contact_first_name, '')),
                  TRIM(COALESCE(cc.contact_last_name, '')),
                  lower(TRIM(COALESCE(cc.contact_primary_email, ''))),
                  regexp_replace(COALESCE(cc.contact_primary_phone, ''), '[^0-9]', '', 'g')),
        ';' ORDER BY cc.id
      )
      FROM public.companies_contacts cc WHERE cc.company_id = c.id
    ),
    (
      SELECT concat_ws('|', COUNT(*), MAX(e.id))
      FROM public.service_note_entries e
      WHERE e.company_id = c.id AND e.deleted_at IS NULL
    )
  )), 1, ${DIGEST_WIDTH})
FROM public.companies c
WHERE c.id IN (SELECT DISTINCT company_id FROM eligible_orders)`;

function digestKey(kind: BookDigestKind, id: string): string {
  return `${kind}:${id}`;
}

/** One sweep of Harper's current book state. */
export async function fetchBookDigests(): Promise<BookDigestRow[]> {
  const rows = await runSupabaseManagementQuery<{
    kind: unknown;
    id: unknown;
    digest: unknown;
  }>(BOOK_SWEEP_SQL);
  return rows.flatMap((row) => {
    const kind = row.kind === "order" || row.kind === "company" ? row.kind : null;
    const id = String(row.id ?? "").trim();
    const digest = String(row.digest ?? "").trim();
    if (!kind || !id || !digest) return [];
    return [{ kind, id, digest }];
  });
}

/**
 * The stored digest for one order, or null when the sweep has not covered it
 * (clean instance, or the order is not in the book). Point lookup on the
 * primary key — cheap enough for request paths, which use it as the cache
 * validity token for order-detail payloads: a matching digest proves the
 * order's book-visible content has not changed since the payload was
 * fetched.
 */
export function readOrderDigest(
  db: Database.Database,
  orderId: number,
): string | null {
  const row = db
    .prepare(
      `SELECT digest FROM book_sync_digests WHERE kind = 'order' AND id = ?`,
    )
    .get(String(orderId)) as { digest: string } | undefined;
  return row?.digest ?? null;
}

export function readBookDigests(db: Database.Database): Map<string, string> {
  const rows = db
    .prepare(`SELECT kind, id, digest FROM book_sync_digests`)
    .all() as { kind: string; id: string; digest: string }[];
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(digestKey(row.kind as BookDigestKind, row.id), row.digest);
  }
  return map;
}

/**
 * Record the sweep as the new local truth. Replaced wholesale rather than
 * upserted: the sweep is the complete eligible set, so a row it does not
 * report has left the book and its digest must not survive to make the next
 * tick think the row is still known.
 *
 * Written only after the book it describes has been merged and synced — a
 * digest stored ahead of its payload would make the next tick believe it
 * already holds data it never fetched.
 */
export function writeBookDigests(
  db: Database.Database,
  rows: readonly BookDigestRow[],
): void {
  const insert = db.prepare(
    `INSERT INTO book_sync_digests (kind, id, digest)
     VALUES (@kind, @id, @digest)`,
  );
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM book_sync_digests`).run();
    for (const row of rows) insert.run(row);
  });
  tx();
}

function numericId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * What changed between the stored digests and this sweep. Pure — the fetch and
 * the database live on either side of it so the decision itself is testable.
 */
export function diffBookDigests(
  local: ReadonlyMap<string, string>,
  remote: readonly BookDigestRow[],
): BookDelta {
  const changedOrderIds: number[] = [];
  const changedCompanyIds: number[] = [];
  const seen = new Set<string>();

  for (const row of remote) {
    const key = digestKey(row.kind, row.id);
    seen.add(key);
    if (local.get(key) === row.digest) continue;
    const id = numericId(row.id);
    if (id === null) continue;
    if (row.kind === "order") changedOrderIds.push(id);
    else changedCompanyIds.push(id);
  }

  const departedOrderIds: number[] = [];
  const departedCompanyIds: number[] = [];
  for (const key of local.keys()) {
    if (seen.has(key)) continue;
    const separator = key.indexOf(":");
    if (separator === -1) continue;
    const kind = key.slice(0, separator);
    const id = numericId(key.slice(separator + 1));
    if (id === null) continue;
    if (kind === "order") departedOrderIds.push(id);
    else if (kind === "company") departedCompanyIds.push(id);
  }

  return {
    changedOrderIds,
    departedOrderIds,
    changedCompanyIds,
    departedCompanyIds,
  };
}

export function isEmptyDelta(delta: BookDelta): boolean {
  return (
    delta.changedOrderIds.length === 0 &&
    delta.departedOrderIds.length === 0 &&
    delta.changedCompanyIds.length === 0 &&
    delta.departedCompanyIds.length === 0
  );
}

export function describeDelta(delta: BookDelta): string {
  return (
    `${delta.changedOrderIds.length} order(s) changed, ` +
    `${delta.departedOrderIds.length} departed, ` +
    `${delta.changedCompanyIds.length} company(ies) changed, ` +
    `${delta.departedCompanyIds.length} departed`
  );
}

import Link from "next/link";
import { DeskSection } from "@/components/DeskSection";
import { Nav } from "@/components/Nav";
import { ExportCsvButton, OwnerFilter } from "./QueueControls";
import { TicketQueue } from "./TicketQueue";
import { getRequestType } from "@/lib/catalog";
import { listOperators, listTickets } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import {
  AGE_BUCKETS,
  ageBucket,
  ageBucketLabel,
  ageDays,
  matchesOwner,
  parseQueueQuery,
  premiumOnFileCents,
  queueHref,
  sortTickets,
  statusRollup as buildStatusRollup,
  typeRollup as buildTypeRollup,
  type QueueQuery,
} from "@/lib/queue";
import { getSessionOperator } from "@/lib/session";
import { ticketStatusLabel } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [params, operator] = await Promise.all([
    searchParams,
    getSessionOperator(),
  ]);
  const query = parseQueueQuery(params);

  const operators = listOperators();
  const operatorsById = Object.fromEntries(
    operators.map((o) => [o.id, o.displayName]),
  );

  // Base set: open tickets scoped by owner + search. The rollup cards read
  // this set so each card row shows what applying that filter would yield.
  const base = listTickets({ openOnly: true, q: query.q }).filter((t) =>
    matchesOwner(t, query.owner, operator?.id ?? null),
  );

  // Table set: base narrowed by the dimension filters, then sorted.
  const narrowed = base.filter(
    (t) =>
      (!query.type || t.requestType === query.type) &&
      (!query.status || t.status === query.status) &&
      (!query.age || ageBucket(t.createdAt) === query.age),
  );
  const tickets = sortTickets(narrowed, query.sort, query.dir, operatorsById);

  const typeRollup = buildTypeRollup(base).slice(0, 3);
  const statusRollup = buildStatusRollup(base);
  const ageRollup = AGE_BUCKETS.map((b) => {
    const bucket = base.filter((t) => ageBucket(t.createdAt) === b.id);
    return {
      key: b.id,
      count: bucket.length,
      premiumCents: bucket.reduce((n, t) => n + premiumOnFileCents(t), 0),
    };
  });

  const ownerChipLabel =
    query.owner === "me"
      ? "Mine"
      : query.owner === "unclaimed"
        ? "Unclaimed"
        : query.owner === "claimed"
          ? "Claimed"
          : query.owner
            ? (operatorsById[query.owner] ?? "Unknown")
            : null;

  const chips: { label: string; clearHref: string }[] = [];
  if (ownerChipLabel) {
    chips.push({
      label: `Owner: ${ownerChipLabel}`,
      clearHref: queueHref({ ...query, owner: undefined }),
    });
  }
  if (query.type) {
    chips.push({
      label: `Type: ${getRequestType(query.type).label}`,
      clearHref: queueHref({ ...query, type: undefined }),
    });
  }
  if (query.status) {
    chips.push({
      label: `Status: ${ticketStatusLabel(query.status)}`,
      clearHref: queueHref({ ...query, status: undefined }),
    });
  }
  if (query.age) {
    chips.push({
      label: `Age: ${ageBucketLabel(query.age)}`,
      clearHref: queueHref({ ...query, age: undefined }),
    });
  }
  if (query.q) {
    chips.push({
      label: `Search: ${query.q}`,
      clearHref: queueHref({ ...query, q: undefined }),
    });
  }

  const csvHeaders = [
    "SR",
    "Account",
    "Type",
    "Status",
    "Age (Days)",
    "Owner",
    "Premium On File",
    "Created At",
    "Subject",
  ];
  const csvRows = tickets.map((t) => [
    t.srNumber,
    t.account.name,
    getRequestType(t.requestType).label,
    ticketStatusLabel(t.status),
    ageDays(t.createdAt).toFixed(1),
    t.operatorId ? (operatorsById[t.operatorId] ?? "Assigned") : "Unclaimed",
    (premiumOnFileCents(t) / 100).toFixed(2),
    t.createdAt,
    t.subject,
  ]);

  return (
    <>
      <Nav active="/queue" operator={operator} />
      <main className="mx-auto max-w-[1200px] px-4 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Service Requests</p>
            <Link href="/samples/queue" className="chip mt-1.5 transition hover:border-[var(--coral)] hover:text-[var(--coral)]">Preview New Layout</Link>
            <h1 className="page-title mt-1 text-3xl text-[var(--ink)]">
              Ticket Queue
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
              Every open request in one ledger. Claim a Service Request (SR)
              when you have capacity.
            </p>
          </div>
          <Link href="/tickets/new" className="btn-primary px-5 py-2">
            New Ticket
          </Link>
        </div>

        <DeskSection
          title="Rollups"
          summary={`${base.length} Open`}
          action={
            <Link
              href="/oversight"
              className="text-xs text-[var(--muted)] underline hover:text-[var(--ink)]"
            >
              Metrics On Oversight
            </Link>
          }
        >
        <div className="grid gap-3 md:grid-cols-3">
          <RollupCard
            title="Request Type"
            rows={typeRollup.map((r) => ({
              key: r.key,
              label: getRequestType(r.key).label,
              count: r.count,
              premiumCents: r.premiumCents,
              href: queueHref({
                ...query,
                type: query.type === r.key ? undefined : r.key,
              }),
              active: query.type === r.key,
            }))}
          />
          <RollupCard
            title="Ticket Status"
            rows={statusRollup.map((r) => ({
              key: r.key,
              label: ticketStatusLabel(r.key),
              count: r.count,
              premiumCents: r.premiumCents,
              href: queueHref({
                ...query,
                status: query.status === r.key ? undefined : r.key,
              }),
              active: query.status === r.key,
            }))}
          />
          <RollupCard
            title="Age"
            rows={ageRollup.map((r) => ({
              key: r.key,
              label: ageBucketLabel(r.key),
              count: r.count,
              premiumCents: r.premiumCents,
              href: queueHref({
                ...query,
                age: query.age === r.key ? undefined : r.key,
              }),
              active: query.age === r.key,
            }))}
          />
        </div>
        <p className="mt-3 text-[11px] text-[var(--muted)]">
          Amounts in parentheses are annual premium on file for the linked
          policies — not invoiced or billed amounts.
        </p>
        </DeskSection>

        <div className="mb-4 mt-5 flex flex-wrap items-center gap-2">
          <span className="chip">Filters {chips.length}</span>
          {chips.map((chip) => (
            <Link
              key={chip.label}
              href={chip.clearHref}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-[var(--ink)] ring-1 ring-[var(--rule)] transition hover:ring-[var(--coral)]"
              title="Remove Filter"
            >
              {chip.label}
              <span className="text-[var(--muted)]" aria-hidden>
                ×
              </span>
            </Link>
          ))}
          {chips.length > 0 && (
            <Link
              href="/queue"
              className="text-xs font-medium text-[var(--muted)] underline hover:text-[var(--ink)]"
            >
              Reset
            </Link>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <OwnerFilter
              operators={operators.map((o) => ({
                id: o.id,
                name: o.displayName,
              }))}
              query={query}
              signedIn={Boolean(operator)}
            />
            <ExportCsvButton
              filename="ticket-queue.csv"
              headers={csvHeaders}
              rows={csvRows}
            />
          </div>
        </div>

        <form action="/queue" className="mb-4 flex flex-wrap gap-2">
          {hiddenParams(query).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <input
            name="q"
            defaultValue={query.q ?? ""}
            placeholder="Search SR-10042 or company name…"
            className="field max-w-md"
          />
          <button type="submit" className="btn-ghost text-xs">
            Search
          </button>
        </form>

        <TicketQueue
          tickets={tickets}
          operator={operator}
          operatorsById={operatorsById}
          query={query}
          filtered={chips.length > 0}
        />
      </main>
    </>
  );
}

/** Non-search params carried through the search form as hidden inputs. */
function hiddenParams(query: QueueQuery): [string, string][] {
  const entries: [string, string | undefined][] = [
    ["owner", query.owner],
    ["type", query.type],
    ["status", query.status],
    ["age", query.age],
    ["sort", query.sort === "age" && query.dir === "desc" ? undefined : query.sort],
    ["dir", query.sort === "age" && query.dir === "desc" ? undefined : query.dir],
  ];
  return entries.filter((e): e is [string, string] => e[1] != null);
}

function RollupCard({
  title,
  rows,
}: {
  title: string;
  rows: {
    key: string;
    label: string;
    count: number;
    premiumCents: number;
    href: string;
    active: boolean;
  }[];
}) {
  return (
    <div className="surface-card px-4 py-3.5">
      <p className="eyebrow">{title}</p>
      <ul className="mt-2.5 space-y-0.5">
        {rows.length === 0 && (
          <li className="py-1 text-xs text-[var(--muted)]">Nothing Open</li>
        )}
        {rows.map((row) => (
          <li key={row.key}>
            <Link
              href={row.href}
              className={`flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition ${
                row.active
                  ? "bg-[color-mix(in_srgb,var(--gold)_18%,transparent)] font-semibold text-[var(--ink)]"
                  : "text-[var(--ink)] hover:bg-[var(--sand)]"
              }`}
            >
              <span className="truncate">{row.label}</span>
              <span className="flex shrink-0 items-baseline gap-3">
                <span className="font-mono text-xs tabular-nums text-[var(--muted)]">
                  ({formatMoney(row.premiumCents)})
                </span>
                <span className="w-8 text-right font-mono text-xs font-semibold tabular-nums text-[var(--ink)]">
                  {row.count}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

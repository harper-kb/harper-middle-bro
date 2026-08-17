"use client";

import Link from "next/link";
import { ORDER_SOURCE_LABELS } from "@/lib/account-source";
import { AccountSourceIdentity } from "@/components/SourceIdentity";
import type { CompanySearchResult } from "@/lib/db/queries/company-search";
import type { BookOrderBindStatus } from "@/lib/supabase-book.server";
import {
  COMPANY_SEARCH_MIN_QUERY,
  type CompanySearchController,
} from "./use-company-search";

/**
 * The result list shared by the inline dropdown and the centered palette.
 *
 * `variant` changes density and how much metadata is spelled out — the palette
 * has room to label each field, the bar dropdown does not — but both read the
 * same controller, so the rows, the ordering and the highlighted option are
 * always identical for a given query.
 */
export type CompanySearchVariant = "inline" | "modal";

const STATUS_LABELS: Record<BookOrderBindStatus, string> = {
  bound: "Bound",
  pending: "Pending",
  lost: "Lost",
};

/**
 * Green Bound, Harper-orange Pending, muted-red Lost. Every badge also carries
 * its label, so the state is never conveyed by colour alone.
 */
const STATUS_STYLES: Record<BookOrderBindStatus, string> = {
  bound:
    "border-[color-mix(in_srgb,var(--success)_36%,var(--rule))] bg-[color-mix(in_srgb,var(--success)_13%,var(--surface-raised))] text-[color-mix(in_srgb,var(--success)_74%,var(--foreground))]",
  pending:
    "border-orange-400/50 bg-orange-100/75 text-orange-800 dark:border-orange-400/40 dark:bg-orange-400/10 dark:text-orange-300",
  lost: "border-[color-mix(in_srgb,var(--danger)_32%,var(--rule))] bg-[color-mix(in_srgb,var(--danger)_10%,var(--surface-raised))] text-[color-mix(in_srgb,var(--danger)_68%,var(--foreground))]",
};

/** "Kinsale Ins Co" for one value, "2 carriers" for several. */
function summarize(values: readonly string[], plural: string): string | null {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  return `${values.length} ${plural}`;
}

/** Decorative only: values stay adjacent in DOM order for assistive tech. */
export function MetadataDivider() {
  return (
    <span
      aria-hidden="true"
      data-search-metadata-divider
      className="h-3 w-px shrink-0 self-center bg-[color-mix(in_srgb,var(--border-strong)_62%,transparent)]"
    />
  );
}

function MetadataItem({
  divided,
  children,
}: {
  divided: boolean;
  children: React.ReactNode;
}) {
  return (
    // The divider and the value are one flex item, so a value can wrap as a
    // unit without leaving a standalone separator behind.
    <span
      className={`inline-flex min-w-0 items-center gap-2 ${
        divided ? "ml-2" : ""
      }`}
    >
      {divided ? <MetadataDivider /> : null}
      {children}
    </span>
  );
}

function Field({
  label,
  value,
  title,
  variant,
  children,
}: {
  label: string;
  value: string;
  title: string;
  variant: CompanySearchVariant;
  /** Replaces the muted text value — used by Channel for the source identity. */
  children?: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={`flex min-w-0 items-center gap-1 ${
        variant === "modal" ? "max-w-[14rem]" : "max-w-[11rem]"
      }`}
    >
      {variant === "modal" ? (
        <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-[color-mix(in_srgb,var(--muted)_75%,transparent)]">
          {label}
        </span>
      ) : (
        <span className="sr-only">{label}: </span>
      )}
      {children ?? (
        <span className="truncate text-[11px] tabular-nums text-[var(--muted)]">
          {value}
        </span>
      )}
    </span>
  );
}

function ResultRow({
  result,
  active,
  optionId,
  variant,
  onNavigate,
  onHover,
}: {
  result: CompanySearchResult;
  active: boolean;
  optionId: string;
  variant: CompanySearchVariant;
  onNavigate: () => void;
  onHover: () => void;
}) {
  const modal = variant === "modal";
  const producer = summarize(result.producerNames, "producers");
  const carrier = summarize(result.carrierNames, "carriers");
  const source = result.source ? ORDER_SOURCE_LABELS[result.source] : null;
  const metadata: Array<{ key: string; value: React.ReactNode }> = [];

  if (result.source && source) {
    metadata.push({
      key: "source",
      value: (
        <Field
          variant={variant}
          label="Channel"
          value={source}
          title={`${source} source across ${result.orderCount} ${
            result.orderCount === 1 ? "order" : "orders"
          }`}
        >
          <AccountSourceIdentity source={result.source} />
        </Field>
      ),
    });
  }
  if (producer) {
    metadata.push({
      key: "producer",
      value: (
        <Field
          variant={variant}
          label="Producer"
          value={producer}
          title={`Producer${result.producerNames.length === 1 ? "" : "s"}: ${result.producerNames.join(", ")}`}
        />
      ),
    });
  }
  if (carrier) {
    metadata.push({
      key: "carrier",
      value: (
        <Field
          variant={variant}
          label="Carrier"
          value={carrier}
          title={`Carrier${result.carrierNames.length === 1 ? "" : "s"}: ${result.carrierNames.join(", ")}`}
        />
      ),
    });
  }
  return (
    // The option is the list item, so the listbox owns it directly. The link
    // inside is out of the tab order — focus stays in the combobox — but keeps
    // the row a real link for pointer, touch and open-in-new-tab.
    <li
      id={optionId}
      role="option"
      aria-selected={active}
      className={`border-b border-[var(--rule)] last:border-b-0 ${
        active ? "bg-[var(--sand)]" : ""
      }`}
    >
      <Link
        tabIndex={-1}
        href={`/accounts/${result.id}`}
        onClick={onNavigate}
        onMouseMove={onHover}
        className={`flex flex-col ${modal ? "gap-1.5 px-4 py-2.5" : "gap-1 px-3 py-2"}`}
      >
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          <span
            data-search-company-heading
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            <span
              title={result.name}
              className={`min-w-0 flex-1 truncate font-semibold text-[var(--ink)] ${
                modal ? "text-[14px]" : "text-[13px]"
              }`}
            >
              {result.name}
            </span>
            {result.statuses.length > 0 ? (
              <span
                data-search-statuses
                className="flex shrink-0 items-center gap-1"
              >
                <span className="sr-only">Status: </span>
                {result.statuses.map((status) => (
                  <span
                    key={status}
                    className={`rounded border px-1.5 py-px text-[10px] font-semibold leading-[1.35] ${STATUS_STYLES[status]}`}
                  >
                    {STATUS_LABELS[status]}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">
            {result.state}
          </span>
        </span>

        {metadata.length > 0 ? (
          <span className="flex flex-wrap items-center gap-y-1">
            {metadata.map((item, index) => (
              <MetadataItem key={item.key} divided={index > 0}>
                {item.value}
              </MetadataItem>
            ))}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function Message({
  children,
  detail,
  variant,
}: {
  children: React.ReactNode;
  detail?: string;
  variant: CompanySearchVariant;
}) {
  return (
    <div
      className={`text-center ${variant === "modal" ? "px-6 py-7" : "px-3 py-6"}`}
    >
      <p className="text-[12px] text-[var(--muted)]">{children}</p>
      {detail ? (
        <p className="mt-1 text-[11px] text-[color-mix(in_srgb,var(--muted)_70%,transparent)]">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

export function CompanySearchResults({
  controller,
  variant,
}: {
  controller: CompanySearchController;
  variant: CompanySearchVariant;
}) {
  const { view, results, activeIndex } = controller;

  if (view.status === "idle") {
    return (
      <Message
        variant={variant}
        detail={`Type at least ${COMPANY_SEARCH_MIN_QUERY} characters.`}
      >
        Search by company name, customer email, or phone number.
      </Message>
    );
  }
  if (view.status === "loading") {
    return <Message variant={variant}>Searching…</Message>;
  }
  if (view.status === "error") {
    return (
      <Message
        variant={variant}
        detail="The last successful sync is still in place."
      >
        Search is temporarily unavailable.
      </Message>
    );
  }
  if (results.length === 0) {
    return (
      <Message
        variant={variant}
        detail="Company and DBA names, customer emails and phone numbers were all checked."
      >
        No companies match “{controller.query.trim()}”.
      </Message>
    );
  }

  return (
    <ul
      id={controller.listboxId}
      role="listbox"
      aria-label="Company results"
    >
      {results.map((result, index) => (
        <ResultRow
          key={result.id}
          result={result}
          variant={variant}
          active={index === activeIndex}
          optionId={controller.optionId(index)}
          onNavigate={controller.handleResultClick}
          onHover={() => controller.highlight(index)}
        />
      ))}
    </ul>
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded border border-[var(--rule)] bg-[var(--surface-subtle)] px-1 py-px text-[10px] font-semibold leading-[1.3] text-[var(--muted)]">
        {keys}
      </kbd>
      {label}
    </span>
  );
}

/**
 * Shared footer: what the keyboard does, and the match count tied to the sync
 * the results came from. The palette keeps its footer at all times so the
 * shortcuts stay discoverable and the surface has a settled bottom edge; the
 * bar dropdown is too compact to spend a row on hints.
 */
export function CompanySearchFooter({
  controller,
  variant,
}: {
  controller: CompanySearchController;
  variant: CompanySearchVariant;
}) {
  const { view, results, lastSuccessfulSyncAt } = controller;
  const hasResults = view.status === "ready" && results.length > 0;
  if (variant === "inline" && !hasResults) return null;

  const synced = lastSuccessfulSyncAt
    ? `synced ${new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(lastSuccessfulSyncAt))}`
    : null;
  const count = hasResults
    ? results.length === 1
      ? "1 match"
      : `${results.length} matches`
    : null;
  const status = [count, synced].filter(Boolean).join(" · ");

  return (
    <div
      className={`flex items-center justify-between gap-3 border-t border-[var(--rule)] bg-[color-mix(in_srgb,var(--surface-subtle)_35%,transparent)] py-1.5 text-[10px] text-[var(--muted)] ${
        variant === "modal" ? "px-4" : "px-3"
      }`}
    >
      {variant === "modal" ? (
        <span className="flex items-center gap-3">
          <Hint keys="↑↓" label="Navigate" />
          <Hint keys="↵" label="Open" />
          <Hint keys="Esc" label="Close" />
        </span>
      ) : (
        <span />
      )}
      <span className="truncate tabular-nums">{status}</span>
    </div>
  );
}

export function CompanySearchIcon({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      className={className}
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.2 10.2 3 3" />
    </svg>
  );
}

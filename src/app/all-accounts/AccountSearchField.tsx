"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/**
 * The Accounts search field.
 *
 * Borrowed from the global company search: same shell, icon, focus treatment
 * and clear button. Nothing else is borrowed — there is no dropdown, no preview
 * and no result menu. Typing filters the account list underneath, which is the
 * whole of what this control does.
 *
 * The filtering itself still happens where it always did: the query is written
 * to `q` and the server re-runs the view's own query with every active filter
 * applied, so a search covers the entire book rather than the page on screen.
 * Keystrokes are debounced and land with `replace`, so typing costs neither a
 * request per character nor a history entry per character — Back still steps out
 * to wherever the operator came from.
 */

const DEBOUNCE_MS = 200;

export function accountsHref(
  basePath: string,
  preservedQuery: string,
  search: string,
): string {
  const params = new URLSearchParams(preservedQuery);
  if (search) params.set("q", search);
  const query = params.toString();
  return `${basePath}${query ? `?${query}` : ""}`;
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]"
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.2 10.2 3 3" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      className="h-2.5 w-2.5"
    >
      <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

export function AccountSearchField({
  basePath,
  currentParams,
  committedQuery,
  resultCount,
}: {
  basePath: string;
  /** Every active URL param, so filtering never drops the view's filters. */
  currentParams: Record<string, string | undefined>;
  /** The `q` currently applied to the list. */
  committedQuery: string;
  /** Accounts the current query and filters match, for the polite announcement. */
  resultCount: number;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(committedQuery);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // The last query this field asked the URL for. Distinguishing "our own commit
  // coming back" from "the query changed underneath us" is what lets Back,
  // Clear filters and a view switch reset the box without a keystroke landing
  // mid-navigation being thrown away.
  const requested = useRef(committedQuery);

  useEffect(() => {
    if (committedQuery === requested.current) return;
    requested.current = committedQuery;
    setDraft(committedQuery);
  }, [committedQuery]);

  // Every active param except the query and the page — a new query is a new
  // result set, so it always starts at page 1. Kept as a string so the debounce
  // below re-arms when a filter changes mid-typing instead of committing against
  // the filters that were active a moment ago.
  const preservedParams = Object.entries(currentParams).filter(
    (entry): entry is [string, string] =>
      Boolean(entry[1]) && entry[0] !== "q" && entry[0] !== "page",
  );
  const preservedQuery = new URLSearchParams(preservedParams).toString();

  // Live, but not once per character.
  useEffect(() => {
    const next = draft.trim();
    if (next === requested.current) return;
    const timer = window.setTimeout(() => {
      requested.current = next;
      startTransition(() => {
        router.replace(accountsHref(basePath, preservedQuery, next), {
          scroll: false,
        });
      });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, basePath, preservedQuery, router, startTransition]);

  const trimmed = draft.trim();

  return (
    <form
      action={basePath}
      method="get"
      className="flex min-w-0 flex-wrap items-center gap-2"
      onSubmit={(event) => {
        // Enter is just "don't wait for the debounce"; the field is already live.
        event.preventDefault();
        if (trimmed === requested.current) return;
        requested.current = trimmed;
        startTransition(() => {
          router.replace(accountsHref(basePath, preservedQuery, trimmed), {
            scroll: false,
          });
        });
      }}
    >
      {/* The filters ride along when the form is submitted without JavaScript. */}
      {preservedParams.map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <div
        className={`flex h-9 w-72 items-center gap-2 rounded-lg border bg-[var(--surface-raised)] px-3 transition-[border-color,box-shadow] duration-150 ease-out focus-within:border-[color-mix(in_srgb,var(--accent)_38%,var(--rule))] focus-within:shadow-[0_0_0_3px_var(--accent-soft)] ${
          draft
            ? "border-[color-mix(in_srgb,var(--accent)_24%,var(--rule))]"
            : "border-[var(--rule)] hover:border-[var(--border-strong)]"
        }`}
      >
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          name="q"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !draft) return;
            event.preventDefault();
            setDraft("");
          }}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search by account name or DBA…"
          aria-label="Search accounts in this view by name or DBA"
          className="account-search-field min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] placeholder:text-[var(--muted)]"
        />
        {pending ? (
          <span
            aria-hidden="true"
            className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-[color-mix(in_srgb,var(--border-strong)_45%,transparent)] border-t-[var(--accent)] motion-reduce:hidden"
          />
        ) : null}
        {draft ? (
          <button
            type="button"
            aria-label="Clear account search"
            onClick={() => {
              setDraft("");
              inputRef.current?.focus();
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <ClearIcon />
          </button>
        ) : null}
      </div>

      {/* The list header carries the count visually; this is the same fact for
          anyone who cannot see the rows reflow. */}
      <p role="status" className="sr-only">
        {trimmed
          ? pending
            ? "Filtering accounts"
            : `${resultCount.toLocaleString()} ${
                resultCount === 1 ? "account" : "accounts"
              } match ${trimmed}`
          : ""}
      </p>
    </form>
  );
}

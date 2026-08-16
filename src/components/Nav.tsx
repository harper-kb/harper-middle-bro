"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";
import {
  Show,
  SignInButton,
  SignOutButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import {
  APP_VERSION,
  RELEASE_STAGE,
  SERVICE_MAILBOX,
  SHORT_NAME,
} from "@/lib/brand";
import type { Operator } from "@/lib/types";
import { useIdlePresence, type Presence } from "@/lib/use-presence";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LatestDatabaseSync } from "@/components/LatestDatabaseSync";
import { OperationsStatsBar } from "@/components/OperationsStatsBar";

/** Left sidebar navigation: account views | service | Manager. */

type NavItem = { href: string; label: string };

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
  /** Force the group open while one of its routes is active. */
  autoExpandOnActive?: boolean;
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "accounts",
    label: "Accounts",
    items: [
      { href: "/all-accounts", label: "All Accounts" },
      { href: "/pending-orders", label: "Pending Orders" },
      { href: "/bound-orders", label: "Bound Orders" },
      { href: "/lost-orders", label: "Lost Orders" },
    ],
    autoExpandOnActive: true,
  },
  {
    id: "service",
    label: "Service",
    items: [
      { href: "/coi", label: "COI Studio" },
      { href: "/docusign-board", label: "DocuSign Board" },
      { href: "/iq-bind-orders", label: "IQ Bind Bench" },
      { href: "/subjectivities", label: "Subjectivities" },
      { href: "/binder-checkout", label: "Binder Checkout" },
      { href: "/communications", label: "Inbox" },
      { href: "/pending-cancels", label: "Pending Cancellations" },
    ],
    autoExpandOnActive: true,
  },
  {
    id: "manager",
    label: "Manager",
    items: [
      { href: "/manager", label: "Manager" },
      { href: "/manager/kpis", label: "KPIs" },
      { href: "/manager/qa", label: "QA" },
      { href: "/certificates", label: "Certificates" },
      { href: "/oversight", label: "Oversight" },
      { href: "/agent-watch", label: "Agent Watch" },
      { href: "/trace", label: "Trace" },
    ],
  },
];

const COLLAPSE_STORAGE_KEY = "desk-nav-collapsed";

const EMPTY_COLLAPSE: Record<string, boolean> = {};
const NAV_COLLAPSE_EVENT = "step-bro-nav-collapse";

/**
 * useSyncExternalStore compares snapshots by identity, so parsing on every
 * read would loop forever. Re-parse only when the stored string changes.
 */
let cachedRaw: string | null = null;
let cachedCollapse: Record<string, boolean> = EMPTY_COLLAPSE;

function readNavCollapse(): Record<string, boolean> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
  } catch {
    // Ignore unreadable storage — default expansion is fine.
  }
  if (raw === cachedRaw) return cachedCollapse;
  cachedRaw = raw;
  cachedCollapse = EMPTY_COLLAPSE;
  if (raw) {
    try {
      cachedCollapse = JSON.parse(raw) as Record<string, boolean>;
    } catch {
      // Corrupt value — fall back to everything expanded.
    }
  }
  return cachedCollapse;
}

function subscribeNavCollapse(onStoreChange: () => void): () => void {
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener(NAV_COLLAPSE_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(NAV_COLLAPSE_EVENT, handler);
  };
}

function emitNavCollapse(): void {
  window.dispatchEvent(new Event(NAV_COLLAPSE_EVENT));
}


function isActivePath(path: string, href: string): boolean {
  return path === href || (href !== "/" && path.startsWith(`${href}/`));
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3 w-3 shrink-0 transition-transform duration-150 ${
        open ? "" : "-rotate-90"
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The active-tab dot doubles as a live presence indicator: emerald while
 * the operator is at the desk, amber once input goes quiet. Same dot sits
 * by the operator name in the account rail.
 */
function PresenceDot({ presence }: { presence: Presence }) {
  const label = presence === "active" ? "Active" : "Idle";
  return (
    <span
      className={`presence-dot h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
        presence === "active" ? "presence-dot-active" : "presence-dot-idle"
      }`}
      title={label}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}

function itemClass(active: boolean): string {
  return `flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] active:bg-[var(--sand)] ${
    active
      ? "bg-[var(--accent-soft)] font-semibold text-[var(--ink)] shadow-[inset_2px_0_0_var(--accent)]"
      : "font-medium text-[var(--muted)] hover:bg-[var(--sand)] hover:text-[var(--ink)]"
  }`;
}

function NavSections({
  path,
  presence,
  collapsed,
  onToggle,
  onNavigate,
}: {
  path: string;
  presence: Presence;
  collapsed: Record<string, boolean>;
  onToggle: (id: string) => void;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-4">
      {NAV_GROUPS.map((group) => {
        const open =
          !collapsed[group.id] ||
          (group.autoExpandOnActive === true &&
            group.items.some((item) => isActivePath(path, item.href)));
        return (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => onToggle(group.id)}
              className="flex w-full items-center justify-between rounded px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)] transition hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-expanded={open}
            >
              {group.label}
              <Chevron open={open} />
            </button>
            {open && (
              <ul className="mt-1 space-y-0.5">
                {group.items.map((item) => {
                  const active = isActivePath(path, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        className={itemClass(active)}
                      >
                        {active && <PresenceDot presence={presence} />}
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Wordmark: the Harper logo and product name on one line, then whoever is at
 * this desk. `email` is omitted on the compact mobile bar.
 */
function BrandBlock({
  email,
  compact = false,
}: {
  email?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Link href="/all-accounts" className="flex min-w-0 items-center gap-2">
          <Image
            src="/harper-wordmark.png"
            alt="Harper"
            width={596}
            height={152}
            priority
            className="h-4 w-auto shrink-0"
          />
          <span className="truncate text-sm font-semibold tracking-[-0.02em] text-[var(--ink)]">
            {SHORT_NAME}
          </span>
        </Link>
        <span className="rounded-full border border-[color-mix(in_srgb,var(--harper-orange)_35%,transparent)] bg-[var(--accent-soft)] px-1.5 py-px text-[7px] font-semibold uppercase tracking-[0.12em] text-[var(--harper-orange)]">
          {RELEASE_STAGE}
        </span>
      </div>
    );
  }

  return (
    <div className="min-w-0 rounded-xl border border-[var(--rule)] bg-[var(--surface-raised)] p-3 shadow-sm">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Link href="/all-accounts" className="flex min-w-0 items-center gap-2">
          <Image
            src="/harper-wordmark.png"
            alt="Harper"
            width={596}
            height={152}
            priority
            className="h-[1.05rem] w-auto shrink-0"
          />
          <span className="truncate text-[15px] font-semibold tracking-[-0.025em] text-[var(--ink)]">
            {SHORT_NAME}
          </span>
        </Link>
        <div className="shrink-0">
          <ThemeToggle compact />
        </div>
      </div>

      <p
        className="mt-2 truncate text-[9px] uppercase tracking-[0.13em] text-[var(--muted)]"
        title={email}
      >
        {email ?? SERVICE_MAILBOX}
      </p>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-[var(--rule)] pt-3">
        <LatestDatabaseSync />
        <div className="flex shrink-0 flex-col items-center justify-center gap-1">
          <span className="rounded-full border border-[color-mix(in_srgb,var(--harper-orange)_35%,transparent)] bg-[var(--accent-soft)] px-1.5 py-px text-[7px] font-semibold uppercase leading-none tracking-[0.12em] text-[var(--harper-orange)]">
            {RELEASE_STAGE}
          </span>
          <span className="text-[9px] tabular-nums tracking-[0.06em] text-[var(--muted)]">
            v{APP_VERSION}
          </span>
        </div>
      </div>
    </div>
  );
}

function AccountRail({
  operator,
  presence,
  onNavigate,
}: {
  operator?: Operator | null;
  presence: Presence;
  onNavigate?: () => void;
}) {
  return (
    <div className="border-t border-[var(--rule)] px-3 py-3">
      <Show when="signed-out">
        <div className="flex items-center gap-2">
          <SignInButton mode="modal">
            <button type="button" className="btn-ghost flex-1 text-xs">
              Sign In
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button type="button" className="btn-primary flex-1 px-3 py-1.5 text-xs">
              Sign Up
            </button>
          </SignUpButton>
        </div>
      </Show>
      <Show when="signed-in">
        <div className="flex items-center gap-2.5">
          <UserButton
            appearance={{ elements: { avatarBox: "h-8 w-8" } }}
          />
          <Link
            href="/me"
            onClick={onNavigate}
            className="min-w-0 flex-1"
            title={operator?.email}
          >
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ink)]">
              <span className="truncate">
                {operator?.displayName ?? "Desk Operator"}
              </span>
              <PresenceDot presence={presence} />
            </p>
            <p className="truncate text-[11px] text-[var(--muted)]">
              {operator?.title ?? "Profile"}
            </p>
          </Link>
          <SignOutButton redirectUrl="/sign-in">
            <button
              type="button"
              aria-label="Sign out"
              title="Sign out"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--sand)] hover:text-[var(--ink)]"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                className="h-4 w-4"
              >
                <path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10" />
                <path d="m15 8 4 4-4 4M9 12h10" />
              </svg>
            </button>
          </SignOutButton>
        </div>
      </Show>
    </div>
  );
}

export function Nav({
  active,
  operator,
}: {
  active: string;
  operator?: Operator | null;
}) {
  const pathname = usePathname();
  const path = pathname ?? active;
  const presence = useIdlePresence();

  const collapsed = useSyncExternalStore(
    subscribeNavCollapse,
    readNavCollapse,
    () => EMPTY_COLLAPSE,
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggle = useCallback((id: string) => {
    const prev = readNavCollapse();
    const next = { ...prev, [id]: !prev[id] };
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage full / private mode — still notify listeners for this session.
    }
    emitNavCollapse();
  }, []);

  const brand = <BrandBlock compact />;

  return (
    <>
      {/* Desktop: fixed left sidebar. The .desk-sidebar class drives the
          body padding rule in globals.css — pages never change. */}
      <aside className="desk-sidebar fixed inset-y-0 left-0 z-40 hidden w-[16.5rem] flex-col border-r border-[var(--rule)] bg-[var(--paper)] lg:flex">
        <div className="p-3 pb-2">
          <BrandBlock email={operator?.email ?? SERVICE_MAILBOX} />
        </div>
        <div className="desk-nav-scroll min-h-0 flex-1 overflow-y-auto px-2.5 py-4">
          <NavSections
            path={path}
            presence={presence}
            collapsed={collapsed}
            onToggle={toggle}
          />
        </div>
        <AccountRail operator={operator} presence={presence} />
      </aside>

      <div className="desk-sticky-header sticky top-0 z-30 hidden border-b border-[var(--rule)] lg:block">
        <OperationsStatsBar />
      </div>

      {/* Below lg: sticky top bar + slide-over drawer. */}
      <header className="desk-sticky-header sticky top-0 z-40 border-b border-[var(--rule)] bg-[var(--paper)]/95 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          {brand}
          <div className="flex items-center gap-2">
            <Show when="signed-in">
              <UserButton appearance={{ elements: { avatarBox: "h-7 w-7" } }} />
            </Show>
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="btn-ghost px-3 py-1.5 text-xs"
              aria-label="Open navigation"
            >
              Menu
            </button>
          </div>
        </div>
        <div className="border-t border-[var(--rule)]">
          <OperationsStatsBar />
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--overlay)]"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[17rem] flex-col border-r border-[var(--rule)] bg-[var(--paper)] shadow-2xl">
            <div className="flex items-start justify-between gap-2 p-3 pb-2">
              <div className="min-w-0 flex-1">
                <BrandBlock email={operator?.email ?? SERVICE_MAILBOX} />
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-full px-2 py-1 text-sm text-[var(--muted)] hover:bg-[var(--sand)]"
                aria-label="Close navigation"
              >
                ✕
              </button>
            </div>
            <div className="desk-nav-scroll min-h-0 flex-1 overflow-y-auto px-2.5 py-4">
              <NavSections
                path={path}
                presence={presence}
                collapsed={collapsed}
                onToggle={toggle}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
            <AccountRail
              operator={operator}
              presence={presence}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}

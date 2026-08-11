"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";
import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import {
  APP_VERSION,
  RELEASE_STAGE,
  SERVICE_MAILBOX,
  SHORT_NAME,
} from "@/lib/brand";
import { SERVICE_LANE_HREFS, SERVICE_LANE_IDS, SERVICE_LANE_LABELS } from "@/lib/types";
import type { Operator } from "@/lib/types";
import { useIdlePresence, type Presence } from "@/lib/use-presence";

/**
 * Left sidebar navigation. Step Bro product contract:
 * Desk | All Tickets | seven sections | Manager.
 */

type NavItem = { href: string; label: string };

const NAV_GROUPS: { id: string; label: string; items: NavItem[] }[] = [
  {
    id: "desk",
    label: "Desk",
    items: [{ href: "/desk", label: "Desk" }],
  },
  {
    id: "all-tickets",
    label: "All Tickets",
    items: [{ href: "/all-tickets", label: "All Tickets" }],
  },
  {
    id: "sections",
    label: "Sections",
    items: SERVICE_LANE_IDS.map((id) => ({
      href: SERVICE_LANE_HREFS[id],
      label: SERVICE_LANE_LABELS[id],
    })),
  },
  {
    id: "manager",
    label: "Manager",
    items: [
      { href: "/manager", label: "Manager" },
      { href: "/manager/kpis", label: "KPIs" },
      { href: "/manager/qa", label: "QA" },
      { href: "/accounts", label: "Accounts" },
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
  return `flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] active:bg-[var(--sand)] ${
    active
      ? "bg-[color-mix(in_srgb,var(--gold)_18%,transparent)] font-semibold text-[var(--ink)]"
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
    <nav className="flex flex-col gap-5">
      <Link
        href="/"
        onClick={onNavigate}
        className={itemClass(path === "/")}
      >
        Sandbox
      </Link>

      {NAV_GROUPS.map((group) => {
        const open = !collapsed[group.id];
        return (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => onToggle(group.id)}
              className="flex w-full items-center justify-between rounded px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)] transition hover:text-[var(--ink)]"
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
function BrandBlock({ email }: { email?: string }) {
  return (
    // Two rows, two columns: identity flush left, status flush right. The
    // status column sizes to the pill and centres the version under it, so the
    // pair reads as one stack instead of two right-ragged strings.
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-1.5">
      <Link href="/" className="flex min-w-0 items-baseline gap-2">
        {/* Optical alignment against the tightly-cropped PNG. Vertically: its
            baseline is at 77.6% of the height and the "p" descender fills the
            rest, but flexbox baselines an image by its bottom edge — so drop
            it by that descender share. Horizontally: the "H" stem starts 5.4%
            in, behind a thin swash, so pull that 5.4% (~3.5px at this height)
            into the margin to line the stem up with the email below. */}
        <Image
          src="/harper-wordmark.png"
          alt="Harper"
          width={596}
          height={152}
          priority
          className="-ml-[3.5px] h-[1.05rem] w-auto shrink-0 translate-y-[22.4%]"
        />
        <span className="truncate font-display text-lg font-semibold leading-none tracking-tight text-[var(--ink)]">
          {SHORT_NAME}
        </span>
      </Link>
      <span className="justify-self-center rounded-full border border-[color-mix(in_srgb,var(--harper-orange)_40%,transparent)] bg-[color-mix(in_srgb,var(--harper-orange)_10%,transparent)] px-1.5 py-[0.5px] text-[8px] font-semibold uppercase leading-[1.6] tracking-[0.12em] text-[var(--harper-orange)]">
        {RELEASE_STAGE}
      </span>

      {email ? (
        <span
          className="truncate text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]"
          title={email}
        >
          {email}
        </span>
      ) : (
        <span />
      )}
      <span className="justify-self-center text-[10px] tabular-nums tracking-[0.06em] text-[var(--muted)]">
        v{APP_VERSION}
      </span>
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

  const brand = <BrandBlock />;

  return (
    <>
      {/* Desktop: fixed left sidebar. The .desk-sidebar class drives the
          body padding rule in globals.css — pages never change. */}
      <aside className="desk-sidebar fixed inset-y-0 left-0 z-40 hidden w-[16.5rem] flex-col border-r border-[var(--rule)] bg-[var(--paper)] lg:flex">
        <div className="border-b border-[var(--rule)] px-4 py-4">
          <BrandBlock email={operator?.email ?? SERVICE_MAILBOX} />
        </div>
        <div className="flex-1 overflow-y-auto px-2.5 py-4">
          <NavSections
            path={path}
            presence={presence}
            collapsed={collapsed}
            onToggle={toggle}
          />
        </div>
        <AccountRail operator={operator} presence={presence} />
      </aside>

      {/* Below lg: sticky top bar + slide-over drawer. */}
      <header className="sticky top-0 z-40 border-b border-[var(--rule)] bg-[var(--paper)]/95 backdrop-blur lg:hidden">
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
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--ink)]/35"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[17rem] flex-col border-r border-[var(--rule)] bg-[var(--paper)] shadow-2xl">
            <div className="flex items-start justify-between border-b border-[var(--rule)] px-4 py-4">
              <BrandBlock email={operator?.email ?? SERVICE_MAILBOX} />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-full px-2 py-1 text-sm text-[var(--muted)] hover:bg-[var(--sand)]"
                aria-label="Close navigation"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2.5 py-4">
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

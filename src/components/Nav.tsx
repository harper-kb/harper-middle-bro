"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { CarrierLogo } from "@/components/CarrierLogo";
import { SERVICE_MAILBOX } from "@/lib/brand";
import { CARRIER_INTEL, carrierSlug } from "@/lib/carriers";
import type { Operator } from "@/lib/types";
import { useIdlePresence, type Presence } from "@/lib/use-presence";

/**
 * Left sidebar navigation (Ascend-style groups) that keeps the old top-bar
 * contract: pages render `<Nav active=… operator=… />` followed by a sibling
 * `<main>`. The sidebar is fixed; a `body:has(.desk-sidebar)` rule in
 * globals.css pads the body on lg+ so no page file needs layout edits.
 * Below lg it degrades to a sticky top bar with a slide-over drawer.
 */

type NavItem = { href: string; label: string };

const NAV_GROUPS: { id: string; label: string; items: NavItem[] }[] = [
  {
    id: "desk",
    label: "Desk",
    items: [
      { href: "/my-day", label: "My Day" },
      { href: "/queue", label: "Ticket Queue" },
      { href: "/pending", label: "Pending" },
      { href: "/ai-desk", label: "AI Desk" },
      { href: "/comms", label: "Comms" },
      { href: "/threads", label: "Threads" },
    ],
  },
  {
    id: "records",
    label: "Records",
    items: [
      { href: "/accounts", label: "Accounts" },
      { href: "/certificates", label: "Certificates" },
      { href: "/contacts", label: "Contacts" },
      { href: "/glossary", label: "Glossary" },
    ],
  },
  {
    id: "oversight",
    label: "Oversight",
    items: [
      { href: "/manager", label: "Manager" },
      { href: "/oversight", label: "Oversight" },
      { href: "/agent-watch", label: "Agent Watch" },
      { href: "/trace", label: "Trace" },
    ],
  },
];

const COLLAPSE_STORAGE_KEY = "desk-nav-collapsed";

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
  const carriersActive = path.startsWith("/carriers");
  const carriersOpen = collapsed.carriers === undefined
    ? carriersActive
    : !collapsed.carriers;

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

                {group.id === "records" && (
                  <li>
                    <button
                      type="button"
                      onClick={() => onToggle("carriers")}
                      className={`w-full justify-between ${itemClass(carriersActive)}`}
                      aria-expanded={carriersOpen}
                    >
                      <span className="flex items-center gap-2">
                        {carriersActive && <PresenceDot presence={presence} />}
                        Carriers
                      </span>
                      <Chevron open={carriersOpen} />
                    </button>
                    {carriersOpen && (
                      <ul className="ml-3.5 mt-1 space-y-0.5 border-l border-[var(--rule)] pl-2.5">
                        {CARRIER_INTEL.map((carrier) => {
                          const slug = carrierSlug(carrier.name);
                          const active = path === `/carriers/${slug}`;
                          return (
                            <li key={slug}>
                              <Link
                                href={`/carriers/${slug}`}
                                onClick={onNavigate}
                                className={itemClass(active)}
                              >
                                <CarrierLogo name={carrier.name} size={18} />
                                <span className="truncate">{carrier.name}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                )}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
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

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (raw) {
        setCollapsed((prev) => ({ ...prev, ...(JSON.parse(raw) as Record<string, boolean>) }));
      }
    } catch {
      // Ignore unreadable storage — default expansion is fine.
    }
  }, []);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const current =
        id === "carriers" && prev[id] === undefined
          ? path.startsWith("/carriers")
          : !prev[id];
      const next = { ...prev, [id]: current };
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage full / private mode — collapse still works for the session.
      }
      return next;
    });
  }

  const brand = (
    <div className="flex items-baseline gap-2">
      <Link href="/" className="font-display text-xl font-semibold tracking-tight">
        <span className="text-[var(--harper-orange)]">Harper</span>{" "}
        {/* nowrap so a tight header breaks between the words, never inside them */}
        <span className="whitespace-nowrap text-[var(--ink)]">Middle Bro</span>
      </Link>
    </div>
  );

  return (
    <>
      {/* Desktop: fixed left sidebar. The .desk-sidebar class drives the
          body padding rule in globals.css — pages never change. */}
      <aside className="desk-sidebar fixed inset-y-0 left-0 z-40 hidden w-[16.5rem] flex-col border-r border-[var(--rule)] bg-[var(--paper)] lg:flex">
        <div className="border-b border-[var(--rule)] px-4 py-4">
          {brand}
          <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
            {SERVICE_MAILBOX}
          </p>
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
            <div className="flex items-center justify-between border-b border-[var(--rule)] px-4 py-4">
              {brand}
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

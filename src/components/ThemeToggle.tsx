"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "step-bro-theme";
const THEME_EVENT = "step-bro-theme-change";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyDocumentTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function preferredTheme(): Theme {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage unavailable means system preference remains authoritative.
  }
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function restorePreferredTheme(): void {
  const preferred = preferredTheme();
  if (
    currentTheme() !== preferred ||
    document.documentElement.style.colorScheme !== preferred
  ) {
    applyDocumentTheme(preferred);
  }
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === STORAGE_KEY &&
      (event.newValue === "light" || event.newValue === "dark")
    ) {
      applyDocumentTheme(event.newValue);
      onChange();
    }
  };
  const handleSystemChange = () => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage unavailable means system preference remains authoritative.
    }
    if (stored !== "light" && stored !== "dark") {
      applyDocumentTheme(media.matches ? "dark" : "light");
      onChange();
    }
  };
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  media.addEventListener("change", handleSystemChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
    media.removeEventListener("change", handleSystemChange);
  };
}

/**
 * Keep the imperative theme attribute stable when React reconciles the root
 * document during navigation, hydration, or a back/forward cache restore.
 */
export function ThemePersistence() {
  const pathname = usePathname();

  useEffect(() => {
    restorePreferredTheme();
  }, [pathname]);

  useEffect(() => {
    const restore = () => restorePreferredTheme();
    const observer = new MutationObserver(restore);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });
    window.addEventListener("pageshow", restore);
    return () => {
      observer.disconnect();
      window.removeEventListener("pageshow", restore);
    };
  }, []);

  return null;
}

function setTheme(theme: Theme): void {
  applyDocumentTheme(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing/storage failures should not block the local toggle.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light");
  const nextTheme = theme === "dark" ? "light" : "dark";

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setTheme(nextTheme)}
        aria-label={`Switch to ${nextTheme} mode`}
        title={`Switch to ${nextTheme} mode`}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--rule)] bg-[var(--surface-subtle)] text-[var(--muted)] transition hover:border-[var(--accent)]/45 hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <span className="theme-light-only">
          <SunIcon />
        </span>
        <span className="theme-dark-only">
          <MoonIcon />
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme)}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
      className="group flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium text-[var(--muted)] transition hover:bg-[var(--sand)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <span className="flex items-center gap-2">
        <span className="theme-light-only">
          <SunIcon />
        </span>
        <span className="theme-dark-only">
          <MoonIcon />
        </span>
        Appearance
      </span>
      <span className="rounded-full border border-[var(--rule)] bg-[var(--surface-raised)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink)]">
        <span className="theme-light-only">Light</span>
        <span className="theme-dark-only">Dark</span>
      </span>
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="h-4 w-4"
    >
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v2M12 19.5v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M2.5 12h2M19.5 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="h-4 w-4"
    >
      <path d="M20 15.2A8.2 8.2 0 0 1 8.8 4 8.2 8.2 0 1 0 20 15.2Z" />
    </svg>
  );
}

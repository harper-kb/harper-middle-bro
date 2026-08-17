"use client";

import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { bigBrotherCompanyOrdersUrl } from "@/lib/big-brother";

/**
 * Everything the handoff needs, resolved by the caller from the shared account
 * / order view model. No lookup happens when the dialog opens.
 */
export type BindHandoffTarget = {
  /** `orders_temp.id` — stable, used for identity and observability only. */
  orderId: number;
  /** Display label, e.g. `Order #13070`. */
  orderLabel: string;
  accountName: string;
  /** `companies.id`, already validated by the caller. Null disables handoff. */
  bigBrotherCompanyId: string | null;
};

type InertElement = HTMLElement & { inert: boolean };

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true",
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      className="bind-handoff-external-icon"
    >
      <path
        d="M6.5 3.25h-2.5a.75.75 0 0 0-.75.75v8a.75.75 0 0 0 .75.75h8a.75.75 0 0 0 .75-.75v-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.75 3.25h3v3M12.5 3.5 7.75 8.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Read-only handoff to Big Brother. Step Bro cannot write a bind, so this
 * dialog explains that and links out; it never mutates an order, and Step Bro
 * shows the result only after the normal live read picks up Big Brother's
 * write.
 */
export function BindHandoffDialog({
  target,
  onClose,
}: {
  target: BindHandoffTarget;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLAnchorElement>(null);

  const href = useMemo(
    () => bigBrotherCompanyOrdersUrl(target.bigBrotherCompanyId),
    [target.bigBrotherCompanyId],
  );

  // The id is carried on the view model, so an absent link means the record has
  // no Big Brother route key — not a failed query. There is nothing to retry.
  useEffect(() => {
    if (href) return;
    console.warn("bind_handoff_company_link_unavailable", {
      orderId: target.orderId,
      hasCompanyId: target.bigBrotherCompanyId !== null,
    });
  }, [href, target.bigBrotherCompanyId, target.orderId]);

  // Subdue the whole application: sidebar, top bar, rows, drawers and any
  // later-portalled popover all go inert behind one backdrop.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const subdued = new Map<
      InertElement,
      { hadInert: boolean; ariaHidden: string | null }
    >();
    const subdue = (node: Element) => {
      if (!(node instanceof HTMLElement) || node === dialog) return;
      // The idle brand screen outranks this dialog: if it takes over while the
      // handoff is open it stays interactive and subdues this layer instead.
      if (node.hasAttribute("data-idle-brand-overlay")) return;
      const element = node as InertElement;
      if (subdued.has(element)) return;
      subdued.set(element, {
        hadInert: element.hasAttribute("inert"),
        ariaHidden: element.getAttribute("aria-hidden"),
      });
      element.inert = true;
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    };

    for (const child of document.body.children) subdue(child);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) subdue(node);
        }
      }
    });
    observer.observe(document.body, { childList: true });

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    // If a drawer already owns the lock, leave its inline state alone.
    const ownsBodyLock = previousOverflow !== "hidden";
    const clientWidth = document.documentElement.clientWidth;
    const scrollbar = clientWidth > 0 ? window.innerWidth - clientWidth : 0;
    if (ownsBodyLock) {
      document.body.style.overflow = "hidden";
      if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
    }

    return () => {
      observer.disconnect();
      for (const [element, previous] of subdued) {
        element.inert = previous.hadInert;
        if (previous.hadInert) element.setAttribute("inert", "");
        else element.removeAttribute("inert");
        if (previous.ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", previous.ariaHidden);
      }
      if (ownsBodyLock) {
        document.body.style.overflow = previousOverflow;
        document.body.style.paddingRight = previousPaddingRight;
      }
    };
  }, []);

  // Open on the action the operator came for, falling back to Cancel when the
  // handoff is unavailable.
  useEffect(() => {
    const initial = confirmRef.current ?? cancelRef.current;
    initial?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const items = focusableElements(dialog);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={dialogRef}
      className="bind-handoff-backdrop fixed inset-0 z-[150] flex items-center justify-center p-4"
      data-bind-handoff-backdrop
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="bind-handoff-panel w-full max-w-md rounded-2xl border border-[var(--rule)] bg-[var(--surface-raised)] p-6 shadow-2xl"
      >
        <p className="eyebrow">Bind Policy</p>
        <h2
          id={titleId}
          className="mt-2 text-lg font-semibold leading-snug text-[var(--ink)]"
        >
          Binding in Step Bro is coming soon
        </h2>
        <p
          id={descriptionId}
          className="mt-2 text-sm leading-relaxed text-[var(--muted)]"
        >
          Step Bro is currently read-only for this action. Continue in Big
          Brother to bind this order — it opens in a new tab, and Step Bro
          updates on its own once the bind lands.
        </p>

        <p className="bind-handoff-context mt-4">
          <span className="font-semibold text-[var(--ink)]">
            {target.orderLabel}
          </span>
          <span aria-hidden="true"> · </span>
          <span>{target.accountName}</span>
        </p>

        {href === null ? (
          <p className="bind-handoff-unavailable mt-4" role="status">
            <svg
              aria-hidden="true"
              focusable="false"
              viewBox="0 0 16 16"
              className="bind-handoff-unavailable-icon"
            >
              <circle
                cx="8"
                cy="8"
                r="6.25"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M8 4.75v3.75M8 11.05v.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            Big Brother company link unavailable. Open this company from Big
            Brother directly to bind.
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="btn-ghost px-3.5 py-2 text-xs"
          >
            Cancel
          </button>
          {href === null ? (
            <button
              type="button"
              disabled
              className="bind-handoff-action"
              aria-describedby={descriptionId}
            >
              Bind in Big Brother
              <ExternalLinkIcon />
            </button>
          ) : (
            <a
              ref={confirmRef}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="bind-handoff-action"
              aria-label={`Open ${target.accountName} in Big Brother to bind policy (opens in a new tab)`}
            >
              Bind in Big Brother
              <ExternalLinkIcon />
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

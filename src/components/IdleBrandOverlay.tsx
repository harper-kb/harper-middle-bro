"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export const IDLE_BRAND_TIMEOUT_MS = 60_000;
export const IDLE_BRAND_EXIT_MS = 220;
export const IDLE_BRAND_CONTINUOUS_THROTTLE_MS = 1_000;
export const IDLE_BRAND_POINTER_DISTANCE_PX = 8;

const OPEN_IDLE_BRAND_OVERLAY_EVENT =
  "step-bro:open-idle-brand-overlay";
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

type IdleBrandOverlayOpenDetail = {
  trigger: HTMLElement | null;
};

type InertElement = HTMLElement & { inert: boolean };

function focusWithoutScrolling(element: HTMLElement | null): void {
  if (!element) return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function isSafeFocusTarget(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element?.isConnected &&
      !element.closest("[inert]") &&
      element.getAttribute("aria-hidden") !== "true" &&
      !("disabled" in element && element.disabled),
  );
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      !element.closest('[aria-hidden="true"],[inert]'),
  );
}

/** Opens the one global brand screen and records the exact manual trigger. */
export function openIdleBrandOverlay(trigger: HTMLElement | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<IdleBrandOverlayOpenDetail>(
      OPEN_IDLE_BRAND_OVERLAY_EVENT,
      { detail: { trigger } },
    ),
  );
}

export function BrandOverlayTrigger({
  brand,
  className = "",
  children,
}: {
  brand: "harper" | "step-bro";
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label="Open Harper and Step Bro brand screen"
      title="Open Harper and Step Bro brand screen"
      data-brand-overlay-trigger={brand}
      className={`brand-overlay-trigger ${className}`}
      onClick={(event) => openIdleBrandOverlay(event.currentTarget)}
    >
      {children}
    </button>
  );
}

/**
 * One authenticated-shell idle timer and one top-level portal. It deliberately
 * does not wrap page content, so opening the brand screen cannot remount or
 * reset route, filter, drawer, form, or scroll state.
 */
export function IdleBrandOverlay() {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const openRef = useRef(false);
  const closingRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const restoreToRef = useRef<HTMLElement | null>(null);
  const restoreAfterCloseRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const fallbackRef = useRef<HTMLSpanElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const beginOpen = useCallback(
    (manualTrigger: HTMLElement | null) => {
      if (openRef.current || document.hidden) return;
      // A focused task dialog owns the modal layer. The next interaction after
      // it closes re-arms this idle timer, avoiding two dialogs and competing
      // focus traps while still keeping the brand screen globally available.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        clearIdleTimer();
        return;
      }

      clearIdleTimer();
      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      restoreToRef.current =
        manualTrigger?.isConnected === true
          ? manualTrigger
          : active === document.body || active === document.documentElement
            ? null
            : active;
      openRef.current = true;
      closingRef.current = false;
      setClosing(false);
      setVisible(true);
    },
    [clearIdleTimer],
  );

  const armIdleTimer = useCallback(() => {
    clearIdleTimer();
    if (openRef.current || document.hidden) return;
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      beginOpen(null);
    }, IDLE_BRAND_TIMEOUT_MS);
  }, [beginOpen, clearIdleTimer]);

  const restoreFocus = useCallback(() => {
    const preferred = restoreToRef.current;
    restoreToRef.current = null;
    focusWithoutScrolling(
      isSafeFocusTarget(preferred) ? preferred : fallbackRef.current,
    );
  }, []);

  const closeOverlay = useCallback(() => {
    if (!openRef.current || closingRef.current) return;

    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      restoreAfterCloseRef.current = true;
      openRef.current = false;
      closingRef.current = false;
      setVisible(false);
      setClosing(false);
      armIdleTimer();
    }, IDLE_BRAND_EXIT_MS);
  }, [armIdleTimer]);

  // The timer and all qualifying activity live here, above route content.
  useEffect(() => {
    let lastContinuousActivityAt = Number.NEGATIVE_INFINITY;
    let lastContactActivityAt = Number.NEGATIVE_INFINITY;
    let lastPointerPoint: { x: number; y: number } | null = null;

    const activity = () => {
      if (openRef.current || document.hidden) return;
      armIdleTimer();
    };

    const contactActivity = () => {
      const now = Date.now();
      // Touch browsers can emit touchstart and pointerdown for one contact.
      if (now - lastContactActivityAt < 120) return;
      lastContactActivityAt = now;
      activity();
    };

    const continuousActivity = () => {
      const now = Date.now();
      if (
        now - lastContinuousActivityAt <
        IDLE_BRAND_CONTINUOUS_THROTTLE_MS
      ) {
        return;
      }
      lastContinuousActivityAt = now;
      activity();
    };

    const onPointerDown = (event: PointerEvent) => {
      lastPointerPoint = { x: event.clientX, y: event.clientY };
      contactActivity();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (openRef.current || document.hidden) return;
      const point = { x: event.clientX, y: event.clientY };
      if (!lastPointerPoint) {
        lastPointerPoint = point;
        const movementX = Number.isFinite(event.movementX)
          ? event.movementX
          : 0;
        const movementY = Number.isFinite(event.movementY)
          ? event.movementY
          : 0;
        if (
          Math.hypot(movementX, movementY) < IDLE_BRAND_POINTER_DISTANCE_PX
        ) {
          return;
        }
      } else if (
        Math.hypot(
          point.x - lastPointerPoint.x,
          point.y - lastPointerPoint.y,
        ) < IDLE_BRAND_POINTER_DISTANCE_PX
      ) {
        return;
      }

      const previouslyAcceptedAt = lastContinuousActivityAt;
      continuousActivity();
      if (lastContinuousActivityAt !== previouslyAcceptedAt) {
        lastPointerPoint = point;
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        clearIdleTimer();
        return;
      }
      armIdleTimer();
    };

    const onManualOpen = (event: Event) => {
      const detail = (event as CustomEvent<IdleBrandOverlayOpenDetail>).detail;
      beginOpen(detail?.trigger ?? null);
    };

    const passiveCapture: AddEventListenerOptions = {
      capture: true,
      passive: true,
    };
    window.addEventListener("pointerdown", onPointerDown, passiveCapture);
    window.addEventListener("pointermove", onPointerMove, passiveCapture);
    window.addEventListener("touchstart", contactActivity, passiveCapture);
    window.addEventListener("scroll", continuousActivity, passiveCapture);
    window.addEventListener("keydown", activity, true);
    window.addEventListener("input", activity, true);
    document.addEventListener("focusin", activity, true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener(OPEN_IDLE_BRAND_OVERLAY_EVENT, onManualOpen);
    armIdleTimer();

    return () => {
      clearIdleTimer();
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("touchstart", contactActivity, true);
      window.removeEventListener("scroll", continuousActivity, true);
      window.removeEventListener("keydown", activity, true);
      window.removeEventListener("input", activity, true);
      document.removeEventListener("focusin", activity, true);
      document.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
      );
      window.removeEventListener(
        OPEN_IDLE_BRAND_OVERLAY_EVENT,
        onManualOpen,
      );
    };
  }, [armIdleTimer, beginOpen, clearIdleTimer]);

  // Do not allow a closing animation timer to outlive sign-out or unmount.
  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  // Make every existing or newly portalled application layer inert while the
  // brand screen is present, including drawers and popovers above page content.
  useEffect(() => {
    if (!visible) return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const hidden = new Map<
      InertElement,
      { hadInert: boolean; ariaHidden: string | null }
    >();
    const subdue = (node: Element) => {
      if (!(node instanceof HTMLElement) || node === overlay) return;
      const element = node as InertElement;
      if (hidden.has(element)) return;
      hidden.set(element, {
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
    // If a drawer already owns the body lock, leave its inline state alone.
    // The html class keeps the viewport locked even if that drawer closes
    // programmatically underneath this overlay.
    const ownsBodyLock = previousOverflow !== "hidden";
    const clientWidth = document.documentElement.clientWidth;
    const scrollbar = clientWidth > 0 ? window.innerWidth - clientWidth : 0;
    if (ownsBodyLock) {
      document.body.style.overflow = "hidden";
      if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
    }
    document.documentElement.classList.add("idle-brand-overlay-open");
    focusWithoutScrolling(backRef.current);

    return () => {
      observer.disconnect();
      for (const [element, previous] of hidden) {
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
      document.documentElement.classList.remove("idle-brand-overlay-open");

      if (restoreAfterCloseRef.current) {
        restoreAfterCloseRef.current = false;
        queueMicrotask(restoreFocus);
      }
    };
  }, [restoreFocus, visible]);

  // Escape and Tab belong to this top-most dialog even if a drawer or palette
  // remains mounted underneath it.
  useEffect(() => {
    if (!visible) return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeOverlay();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const items = focusableElements(overlay);
        const target = event.shiftKey ? items.at(-1) : items[0];
        focusWithoutScrolling(target ?? overlay);
        return;
      }
      if (!overlay.contains(event.target as Node)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        focusWithoutScrolling(backRef.current);
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!overlay.contains(event.target as Node)) {
        focusWithoutScrolling(backRef.current);
      }
    };
    const stopBackgroundShortcuts = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Tab") {
        event.stopPropagation();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    overlay.addEventListener("keydown", stopBackgroundShortcuts);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      overlay.removeEventListener("keydown", stopBackgroundShortcuts);
    };
  }, [closeOverlay, visible]);

  const portal =
    visible && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={overlayRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            tabIndex={-1}
            data-idle-brand-overlay
            data-state={closing ? "closing" : "open"}
            className={`idle-brand-overlay fixed inset-0 z-[200] flex min-h-screen min-h-dvh items-center justify-center overflow-y-auto ${
              closing ? "idle-brand-overlay--closing" : ""
            }`}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) event.preventDefault();
            }}
          >
            <div className="idle-brand-composition">
              <h1 id={titleId} className="sr-only">
                Harper Step Bro
              </h1>

              <div className="idle-brand-lockup" aria-hidden="true">
                <Image
                  src="/harper-wordmark.png"
                  alt=""
                  width={596}
                  height={152}
                  loading="eager"
                  draggable={false}
                  className="idle-brand-harper-logo"
                />
                <span className="step-bro-wordmark idle-brand-step-logo" />
              </div>

              <p
                id={descriptionId}
                className="page-title idle-brand-tagline"
              >
                Built for Service, By Service.
              </p>

              <button
                ref={backRef}
                type="button"
                className="idle-brand-back"
                onClick={closeOverlay}
              >
                Back
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <span
        ref={fallbackRef}
        tabIndex={-1}
        className="sr-only"
        data-idle-brand-focus-fallback
      >
        Step Bro application
      </span>
      {portal}
    </>
  );
}

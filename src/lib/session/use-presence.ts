"use client";

import { useEffect, useState } from "react";

/**
 * Operator presence: green while the desk sees activity, amber once idle.
 *
 * Listens for mousemove / keydown / pointerdown / scroll plus tab
 * visibility. Any activity flips back to "active" immediately; the idle
 * timer only re-arms at most once per ACTIVITY_THROTTLE_MS so a busy
 * mouse never thrashes state or timers. Hiding the tab reads as idle
 * right away — an unwatched desk is not a worked desk.
 */

/** No input for this long ⇒ the operator reads as idle. */
const IDLE_AFTER_MS = 60_000;

/** Activity events only re-arm the idle timer this often. */
const ACTIVITY_THROTTLE_MS = 1_500;

export type Presence = "active" | "idle";

export function useIdlePresence(): Presence {
  const [presence, setPresence] = useState<Presence>("active");

  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let lastArmedAt = 0;

    const goIdle = () => setPresence("idle");

    const armIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(goIdle, IDLE_AFTER_MS);
      lastArmedAt = Date.now();
    };

    const onActivity = () => {
      // Flip to green immediately; only the timer reset is throttled.
      setPresence("active");
      if (Date.now() - lastArmedAt >= ACTIVITY_THROTTLE_MS) {
        armIdleTimer();
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        clearTimeout(idleTimer);
        goIdle();
      } else {
        setPresence("active");
        armIdleTimer();
      }
    };

    const activityEvents = [
      "mousemove",
      "keydown",
      "pointerdown",
      "scroll",
    ] as const;

    for (const event of activityEvents) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    armIdleTimer();

    return () => {
      clearTimeout(idleTimer);
      for (const event of activityEvents) {
        window.removeEventListener(event, onActivity);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return presence;
}

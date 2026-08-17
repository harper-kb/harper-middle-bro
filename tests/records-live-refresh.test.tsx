// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const { RECORDS_LIVE_REFRESH_MS, RecordsLiveRefresh } = await import(
  "@/app/all-accounts/RecordsLiveRefresh"
);

let visibility: DocumentVisibilityState;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-17T09:00:00.000Z"));
  refresh.mockReset();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Records five-minute live refresh", () => {
  it("refreshes the current route without a navigation timer leak", () => {
    const view = render(
      <StrictMode>
        <RecordsLiveRefresh />
      </StrictMode>,
    );
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(RECORDS_LIVE_REFRESH_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("defers hidden-tab work and catches up when the tab becomes visible", () => {
    render(<RecordsLiveRefresh />);
    visibility = "hidden";
    act(() => {
      vi.advanceTimersByTime(RECORDS_LIVE_REFRESH_MS);
    });
    expect(refresh).not.toHaveBeenCalled();

    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

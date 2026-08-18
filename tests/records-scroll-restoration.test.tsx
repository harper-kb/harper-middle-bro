// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RecordsScrollRestoration,
  rememberRecordsScroll,
} from "@/app/all-accounts/RecordsScrollRestoration";
import { parseRecordsFilterState } from "@/app/all-accounts/records-filter-state";

const state = parseRecordsFilterState("pending", {
  source: "broker",
  brokerGate: "G4",
  q: "private search",
  page: "3",
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Records scroll restoration", () => {
  it("stores only a scroll number under a redacted state hash", () => {
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 640,
    });
    rememberRecordsScroll(state);

    const entries = Object.entries(window.sessionStorage);
    expect(entries).toHaveLength(1);
    expect(entries[0]![0]).toMatch(/^records-scroll:[0-9a-f]{8}$/);
    expect(entries[0]![1]).not.toContain("private search");
    expect(JSON.parse(entries[0]![1])).toMatchObject({ y: 640 });
  });

  it("restores once and clamps to the available document height", () => {
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 900,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 700,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 200,
    });
    rememberRecordsScroll(state);

    const scrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    render(<RecordsScrollRestoration state={state} />);

    expect(scrollTo).toHaveBeenCalledWith({ top: 500 });
    expect(window.sessionStorage.length).toBe(0);
  });
});

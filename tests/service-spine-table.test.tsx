// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpineFilterProvider } from "@/app/service-spine/SpineFilterProvider";
import { SpineTable } from "@/app/service-spine/SpineTable";
import { defaultSpineFilterState } from "@/app/service-spine/spine-filter-state";
import type {
  SpineIssueCard,
  SpineTableResult,
} from "@/lib/service-spine/domain";

const navigation = vi.hoisted(() => ({
  pushes: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => navigation.pushes.push(href),
    replace: () => {},
    refresh: () => {},
  }),
}));

const NOW = Date.parse("2026-08-19T12:00:00.000Z");

function issue(): SpineIssueCard {
  return {
    id: 859,
    companyId: 21089,
    accountId: "co-21089",
    companyName: "S.m. Ellis Mechanical",
    issueType: "general_request",
    goal: "Resolve the ghost workers compensation application.",
    status: "open",
    priority: "P0",
    blocking: "blocking",
    origin: "ai",
    correlationKey: "spine-prod-20260730:1971712",
    wave: "0730",
    slaDueAt: "2026-08-19T10:00:00.000Z",
    latestSummary: null,
    openedAt: "2026-08-18T12:00:00.000Z",
    updatedAt: "2026-08-19T11:56:00.000Z",
    resolvedAt: null,
    agentOpen: 0,
    agentTotal: 2,
    humanOpen: 2,
    humanTotal: 2,
    openHumanAssignees: ["Dana Reyes"],
    openHumanAssigneeNames: ["Dana Reyes"],
    eventCount: 1530,
    lastEventAt: "2026-08-19T11:56:00.000Z",
    hasDraft: true,
    closureProposed: false,
    pendingOrder: false,
    column: "open",
  };
}

function result(): SpineTableResult {
  return {
    rows: [issue()],
    filteredTotal: 150,
    mirrorTotal: 3879,
    page: 1,
    pageCount: 2,
    pageSize: 100,
  };
}

function renderTable() {
  return render(
    <SpineFilterProvider
      state={{ ...defaultSpineFilterState(), view: "table" }}
    >
      <SpineTable result={result()} nowMs={NOW} />
    </SpineFilterProvider>,
  );
}

beforeEach(() => {
  navigation.pushes.length = 0;
});

afterEach(cleanup);

describe("SpineTable", () => {
  it("uses the seven-column scan hierarchy and the shared issue model", () => {
    renderTable();
    for (const heading of [
      "Priority",
      "Company",
      "Issue",
      "Queue",
      "SLA",
      "Task progress",
      "Updated",
    ]) {
      expect(screen.getByRole("columnheader", { name: heading })).toBeTruthy();
    }
    expect(
      screen
        .getByRole("row", { name: /open issue #859/i })
        .classList.contains("interactive-record-surface"),
    ).toBe(true);
    expect(screen.getAllByLabelText("Priority P0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("S.m. Ellis Mechanical").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Blocking").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("SLA breached 2h 0m ago").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByLabelText(
        "Agent tasks: 0 open of 2. Human tasks: 2 open of 2.",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("opens a row with mouse or keyboard and isolates the company link", () => {
    renderTable();
    const row = screen.getByRole("row", {
      name: /open issue #859/i,
    });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(navigation.pushes).toEqual(["/service-spine?view=table&issue=859"]);

    navigation.pushes.length = 0;
    const companyLinks = screen.getAllByRole("link", {
      name: "S.m. Ellis Mechanical",
    });
    fireEvent.click(companyLinks[0]!);
    expect(navigation.pushes).toEqual([]);
  });

  it("keeps table pagination in canonical URL state", () => {
    renderTable();
    fireEvent.click(screen.getByRole("link", { name: "Go to page 2" }));
    expect(navigation.pushes).toEqual(["/service-spine?view=table&page=2"]);
  });
});

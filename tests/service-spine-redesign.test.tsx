// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceSpineHeader } from "@/app/service-spine/ServiceSpineHeader";
import { SpineFilterProvider } from "@/app/service-spine/SpineFilterProvider";
import { SpineFilterToolbar } from "@/app/service-spine/SpineFilterToolbar";
import {
  ServiceHealthSummary,
  type SpineOperationalCounts,
} from "@/app/service-spine/SpineSummaryStrip";
import {
  defaultSpineFilterState,
  type SpineFilterState,
} from "@/app/service-spine/spine-filter-state";
import type {
  SpineFilterOptions,
  SpineSummary,
} from "@/lib/service-spine/domain";

const navigation = vi.hoisted(() => ({
  pushes: [] as string[],
  replaces: [] as string[],
  refreshes: 0,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => navigation.pushes.push(href),
    replace: (href: string) => navigation.replaces.push(href),
    refresh: () => {
      navigation.refreshes += 1;
    },
  }),
}));

class IntersectionObserverStub {
  observe() {}
  disconnect() {}
}

const OPTIONS: SpineFilterOptions = {
  priorities: ["P0", "P1", "P2", "P3"],
  issueTypes: ["endorsement", "policy_delivery"],
  waves: ["0730", "0731"],
  people: [{ label: "Dana Reyes", n: 12 }],
};

function renderToolbar(
  state: SpineFilterState = defaultSpineFilterState(),
) {
  return render(
    <SpineFilterProvider state={state}>
      <SpineFilterToolbar
        options={OPTIONS}
        filteredTotal={184}
        mirrorTotal={3879}
        loadedTotal={100}
      />
    </SpineFilterProvider>,
  );
}

beforeEach(() => {
  navigation.pushes.length = 0;
  navigation.replaces.length = 0;
  navigation.refreshes = 0;
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ServiceHealthSummary", () => {
  it("prioritizes operational queues and progressively discloses diagnostics", () => {
    const summary: SpineSummary = {
      issuesByStatus: [
        { status: "open", n: 2324 },
        { status: "resolved", n: 723 },
        { status: "cancelled", n: 83 },
      ],
      issuesTotal: 3879,
      closureProposedOpen: 727,
      agentTasks: { open: 1591, total: 4342 },
      humanTasks: { open: 3299, total: 3347 },
      events: { total: 161247, suppressions: 34256 },
    };
    const counts: SpineOperationalCounts = {
      open: 1688,
      blocked: 332,
      waitingCustomer: 243,
      waitingThirdParty: 174,
      closureReview: 727,
    };
    render(<ServiceHealthSummary summary={summary} counts={counts} />);

    expect(screen.getByText("Operational health")).toBeTruthy();
    expect(screen.getByText("1,688")).toBeTruthy();
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText("Waiting on customer")).toBeTruthy();
    expect(screen.getByText("Closure review")).toBeTruthy();

    const workload = screen.getByText("Workload").closest("details");
    expect(workload?.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByText("Workload"));
    expect(workload?.hasAttribute("open")).toBe(true);
    expect(screen.getByText("1,591 open of 4,342")).toBeTruthy();
    expect(screen.getByText("3,299 open of 3,347")).toBeTruthy();

    // System-scale diagnostics stay behind the secondary disclosure.
    const disclosure = screen.getByText("System activity").closest("details");
    expect(disclosure?.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByText("System activity"));
    expect(disclosure?.hasAttribute("open")).toBe(true);
    expect(screen.getByText("161,247")).toBeTruthy();
    expect(screen.getByText("34,256")).toBeTruthy();
  });

  it("keeps zero and large queue counts readable in compact tiles", () => {
    const summary: SpineSummary = {
      issuesByStatus: [],
      issuesTotal: 123456,
      closureProposedOpen: 0,
      agentTasks: { open: 0, total: 0 },
      humanTasks: { open: 0, total: 0 },
      events: { total: 0, suppressions: 0 },
    };
    render(
      <ServiceHealthSummary
        summary={summary}
        counts={{
          open: 123456,
          blocked: 0,
          waitingCustomer: 0,
          waitingThirdParty: 0,
          closureReview: 0,
        }}
      />,
    );
    expect(screen.getAllByText("123,456").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(4);
    for (const tile of document.querySelectorAll(".spine-queue-metric")) {
      expect(tile.textContent?.trim().length).toBeGreaterThan(1);
    }
  });
});

describe("ServiceSpineHeader", () => {
  it("keeps title, freshness, and refresh in one compact hierarchy", () => {
    render(
      <ServiceSpineHeader
        sync={{
          lastSyncAt: "2026-08-19T19:02:00.000Z",
          lastFullSyncAt: "2026-08-19T18:56:00.000Z",
          lastFailureAt: null,
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Service Spine" })).toBeTruthy();
    expect(screen.getByText("Live service issues across the book.")).toBeTruthy();
    expect(screen.getByText("Updated")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /refresh service spine/i }));
    expect(navigation.refreshes).toBe(1);
  });
});

describe("SpineFilterToolbar", () => {
  it("keeps default filters collapsed and exposes them in one popover", () => {
    renderToolbar();
    expect(screen.getByRole("button", { name: "Filters" })).toBeTruthy();
    expect(screen.queryByLabelText("Priority")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeTruthy();
    const backdrop = document.querySelector("[data-records-filter-backdrop]");
    expect(backdrop?.classList.contains("records-filter-focus-backdrop")).toBe(
      true,
    );
    expect(
      screen
        .getByLabelText("Service Spine workspace controls")
        .classList.contains("records-filter-control--open"),
    ).toBe(true);
    expect(screen.getByLabelText("Priority")).toBeTruthy();
    expect(screen.getByLabelText("Issue type")).toBeTruthy();
    expect(screen.getByLabelText("Queue")).toBeTruthy();
    expect(screen.getByText("184 matching · 100 loaded")).toBeTruthy();
    expect(navigation.pushes).toEqual([]);
    expect(navigation.replaces).toEqual([]);
  });

  it("dismisses through the shared backdrop or Escape and restores trigger focus", async () => {
    renderToolbar();
    const trigger = screen.getByRole("button", { name: "Filters" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    const backdrop = document.querySelector(
      "[data-records-filter-backdrop]",
    ) as HTMLElement;
    fireEvent.pointerDown(backdrop);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("does not stack filters over an open issue drawer", () => {
    renderToolbar({ ...defaultSpineFilterState(), issue: 42 });
    const trigger = screen.getByRole("button", { name: "Filters" });
    expect(trigger).toHaveProperty("disabled", true);
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
  });

  it("shows removable active chips and preserves unrelated filters", async () => {
    renderToolbar({
      ...defaultSpineFilterState(),
      priority: "P0",
      type: "endorsement",
      queue: "human",
    });
    expect(screen.getByRole("button", { name: "Filters (3)" })).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove P0 filter" }),
    );
    await waitFor(() => expect(navigation.pushes).toHaveLength(1));
    expect(navigation.pushes[0]).toContain("type=endorsement");
    expect(navigation.pushes[0]).toContain("queue=human");
    expect(navigation.pushes[0]).not.toContain("priority=");
  });

  it("clears search without resetting another active filter", async () => {
    renderToolbar({
      ...defaultSpineFilterState(),
      q: "endorsement",
      priority: "P1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear issue search" }));
    await waitFor(() => expect(navigation.replaces).toHaveLength(1));
    expect(navigation.replaces[0]).toBe("/service-spine?priority=P1");
  });

  it("keeps view and sort next to the controls they affect", () => {
    renderToolbar();
    expect(screen.getByRole("radio", { name: "Board" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Table" })).toBeTruthy();
    expect(screen.getByLabelText("Sort issues")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Table" }));
    expect(navigation.pushes).toEqual(["/service-spine?view=table"]);
  });
});

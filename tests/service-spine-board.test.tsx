// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpineBoard } from "@/app/service-spine/SpineBoard";
import { SpineCard } from "@/app/service-spine/SpineCard";
import { SpineFilterProvider } from "@/app/service-spine/SpineFilterProvider";
import { SpinePriorityBadge } from "@/app/service-spine/spine-visuals";
import { defaultSpineFilterState } from "@/app/service-spine/spine-filter-state";
import type {
  SpineBoardColumn,
  SpineBoardResult,
  SpineIssueCard as SpineIssueCardModel,
} from "@/lib/service-spine/domain";

const navigation = vi.hoisted(() => ({
  pushes: [] as string[],
  replaces: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => navigation.pushes.push(href),
    replace: (href: string) => navigation.replaces.push(href),
    refresh: () => {},
  }),
}));

const NOW_MS = Date.parse("2026-08-19T12:00:00.000Z");

function issueCard(
  overrides: Partial<SpineIssueCardModel> = {},
): SpineIssueCardModel {
  return {
    id: 3412,
    companyId: 917669,
    accountId: "co-917669",
    companyName: "365 Business Solutions, LLC",
    issueType: "policy_delivery",
    goal: "Deliver the bound GL policy documents to the insured.",
    status: "open",
    priority: "P1",
    blocking: null,
    origin: "ai",
    correlationKey: "spine-prod-20260731:pd:3412",
    wave: "0731",
    slaDueAt: null,
    latestSummary: null,
    openedAt: "2026-08-18T12:00:00.000Z",
    updatedAt: "2026-08-19T11:00:00.000Z",
    resolvedAt: null,
    agentOpen: 1,
    agentTotal: 2,
    humanOpen: 0,
    humanTotal: 1,
    openHumanAssignees: [],
    openHumanAssigneeNames: [],
    eventCount: 12,
    lastEventAt: "2026-08-19T11:56:00.000Z",
    hasDraft: false,
    closureProposed: false,
    pendingOrder: null,
    column: "open",
    ...overrides,
  };
}

function column(
  id: string,
  label: string,
  total: number,
  rows: SpineIssueCardModel[],
): SpineBoardColumn {
  return { id, label, total, rows };
}

function boardResult(columns: SpineBoardColumn[]): SpineBoardResult {
  const filteredTotal = columns.reduce((sum, entry) => sum + entry.total, 0);
  return { columns, filteredTotal, mirrorTotal: filteredTotal };
}

function renderBoard(
  result: SpineBoardResult,
  rowsCap = 100,
  selectedIssue: number | null = null,
) {
  return render(
    <SpineFilterProvider
      state={{ ...defaultSpineFilterState(), issue: selectedIssue }}
    >
      <SpineBoard result={result} rowsCap={rowsCap} nowMs={NOW_MS} />
    </SpineFilterProvider>,
  );
}

beforeEach(() => {
  navigation.pushes.length = 0;
  navigation.replaces.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("SpineBoard", () => {
  it("renders every column from props with its exact total, unknown statuses appended", () => {
    renderBoard(
      boardResult([
        column("open", "Open", 120, [issueCard()]),
        column("waiting_customer", "Waiting on customer", 1, [
          issueCard({ id: 2, status: "waiting_customer" }),
        ]),
        column("closed", "Closed", 7, [
          issueCard({ id: 3, status: "resolved" }),
        ]),
        // The parity law: an unknown status becomes its own appended column.
        column("paused", "paused", 1, [issueCard({ id: 4, status: "paused" })]),
      ]),
    );

    expect(
      screen.getByRole("region", { name: "Open — 120 issues" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Waiting on customer — 1 issue" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Closed — 7 issues" }),
    ).toBeTruthy();

    const regions = screen.getAllByRole("region");
    expect(regions).toHaveLength(4);
    expect(regions[3]!.getAttribute("aria-label")).toBe("paused — 1 issue");
  });

  it("names the capped window and loads more by bumping the rows step", () => {
    renderBoard(
      boardResult([
        column(
          "open",
          "Open",
          120,
          [1, 2, 3, 4].map((id) => issueCard({ id })),
        ),
      ]),
      100,
    );

    const region = screen.getByRole("region", { name: "Open — 120 issues" });
    expect(within(region).getByText("4 loaded of 120")).toBeTruthy();

    fireEvent.click(
      within(region).getByRole("button", { name: /load more open issues/i }),
    );
    expect(navigation.pushes).toEqual(["/service-spine?rows=250"]);
  });

  it("hides Load more at the last rows step but keeps the honest window line", () => {
    renderBoard(
      boardResult([column("open", "Open", 2000, [issueCard()])]),
      1000,
    );
    const region = screen.getByRole("region", { name: "Open — 2,000 issues" });
    expect(within(region).getByText("1 loaded of 2,000")).toBeTruthy();
    expect(
      within(region).queryByRole("button", { name: /load more/i }),
    ).toBeNull();
  });

  it("shows the empty state for a column with no issues", () => {
    renderBoard(boardResult([column("blocked", "Blocked", 0, [])]));
    const region = screen.getByRole("region", { name: "Blocked — 0 issues" });
    expect(within(region).getByText("No matching issues")).toBeTruthy();
  });

  it("opens the drawer through the issue URL param when a card is activated", () => {
    renderBoard(boardResult([column("open", "Open", 1, [issueCard()])]));
    fireEvent.click(
      screen.getByRole("button", { name: /open issue #3412/i }),
    );
    expect(navigation.pushes).toEqual(["/service-spine?issue=3412"]);
  });

  it("uses the shared Records surface and softens siblings only while one issue is open", () => {
    renderBoard(
      boardResult([
        column("open", "Open", 2, [issueCard({ id: 1 }), issueCard({ id: 2 })]),
      ]),
      100,
      1,
    );
    const selected = document.querySelector("[data-spine-card='1']");
    const sibling = document.querySelector("[data-spine-card='2']");
    expect(selected?.classList.contains("interactive-record-surface")).toBe(true);
    expect(
      selected?.classList.contains("interactive-record-surface--selected"),
    ).toBe(true);
    expect(
      sibling?.classList.contains("interactive-record-surface--deemphasized"),
    ).toBe(true);
  });
});

describe("SpineCard", () => {
  it("keeps P0–P3 labels explicit and accessible", () => {
    render(
      <>
        {["P0", "P1", "P2", "P3"].map((priority) => (
          <SpinePriorityBadge key={priority} priority={priority} />
        ))}
      </>,
    );
    for (const priority of ["P0", "P1", "P2", "P3"]) {
      expect(screen.getByLabelText(`Priority ${priority}`)).toBeTruthy();
    }
  });

  it("renders the redesigned operational scan hierarchy", () => {
    render(
      <SpineCard
        issue={issueCard({
          slaDueAt: "2026-08-19T14:30:00.000Z",
          blocking: "blocking",
          hasDraft: true,
          closureProposed: true,
          pendingOrder: true,
        })}
        nowMs={NOW_MS}
        onOpen={() => {}}
      />,
    );

    // Company link resolves to the Step Bro account page.
    const link = screen.getByRole("link", {
      name: "365 Business Solutions, LLC",
    });
    expect(link.getAttribute("href")).toBe("/accounts/co-917669");

    expect(screen.getByText("Pending orders")).toBeTruthy();
    expect(screen.getByText((text) => text.includes("#3412"))).toBeTruthy();
    expect(screen.getByLabelText("Priority P1")).toBeTruthy();
    expect(screen.getByText("policy delivery")).toBeTruthy();
    expect(screen.getByText((text) => text.includes("0731"))).toBeTruthy();
    expect(screen.getByText("Blocking")).toBeTruthy();
    expect(
      screen.getByText(
        "Deliver the bound GL policy documents to the insured.",
      ),
    ).toBeTruthy();
    // 2.5 h out: inside the 4 h "soon" window.
    expect(screen.getByText("SLA due in 2h 30m")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    // Closure is already communicated by its board column; it no longer
    // competes with urgency and task progress as another card badge.
    expect(screen.queryByText("closure proposed")).toBeNull();
    expect(
      screen.getByLabelText(
        "Agent tasks: 1 open of 2. Human tasks: 0 open of 1.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Updated 1h 0m ago")).toBeTruthy();
  });

  it("marks a breached SLA in the past tense", () => {
    render(
      <SpineCard
        issue={issueCard({ slaDueAt: "2026-08-19T09:00:00.000Z" })}
        nowMs={NOW_MS}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("SLA breached 3h 0m ago")).toBeTruthy();
  });

  it("suppresses the SLA chip and closure pill on terminal issues", () => {
    render(
      <SpineCard
        issue={issueCard({
          status: "resolved",
          slaDueAt: "2026-08-19T14:30:00.000Z",
          closureProposed: true,
        })}
        nowMs={NOW_MS}
        onOpen={() => {}}
      />,
    );
    expect(screen.queryByText(/SLA/)).toBeNull();
    expect(screen.queryByText("closure proposed")).toBeNull();
  });

  it("distinguishes healthy, soon, breached, and missing SLA states", () => {
    const { rerender } = render(
      <SpineCard
        issue={issueCard({ slaDueAt: "2026-08-21T12:00:00.000Z" })}
        nowMs={NOW_MS}
        onOpen={() => {}}
      />,
    );
    expect(document.querySelector("[data-sla-state='due']")).toBeTruthy();

    rerender(
      <SpineCard
        issue={issueCard({ slaDueAt: "2026-08-19T14:00:00.000Z" })}
        nowMs={NOW_MS}
        onOpen={() => {}}
      />,
    );
    expect(document.querySelector("[data-sla-state='soon']")).toBeTruthy();

    rerender(
      <SpineCard
        issue={issueCard({ slaDueAt: "2026-08-19T09:00:00.000Z" })}
        nowMs={NOW_MS}
        onOpen={() => {}}
      />,
    );
    expect(document.querySelector("[data-sla-state='breached']")).toBeTruthy();

    rerender(
      <SpineCard
        issue={issueCard({ slaDueAt: null })}
        nowMs={NOW_MS}
        onOpen={() => {}}
      />,
    );
    expect(document.querySelector("[data-sla-state]")).toBeNull();
  });

  it("labels the zero-task edge case instead of showing an unexplained ratio", () => {
    render(
      <SpineCard
        issue={issueCard({
          agentOpen: 0,
          agentTotal: 0,
          humanOpen: 0,
          humanTotal: 0,
        })}
        nowMs={NOW_MS}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("No tasks")).toBeTruthy();
  });

  it("renders a plain company name when the account is not in the book", () => {
    render(
      <SpineCard
        issue={issueCard({ accountId: null })}
        nowMs={NOW_MS}
        onOpen={() => {}}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("365 Business Solutions, LLC")).toBeTruthy();
  });

  it("activates through click on the card's single button target", () => {
    const onOpen = vi.fn();
    render(<SpineCard issue={issueCard()} nowMs={NOW_MS} onOpen={onOpen} />);

    const trigger = screen.getByRole("button", { name: /open issue #3412/i });
    fireEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledWith(3412);

    // The company link is a sibling activatable element, never nested inside
    // the card button.
    const link = screen.getByRole("link", {
      name: "365 Business Solutions, LLC",
    });
    expect(trigger.contains(link)).toBe(false);
    expect(link.contains(trigger)).toBe(false);

    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("marks the open issue with a restrained selected state", () => {
    render(
      <SpineCard
        issue={issueCard()}
        nowMs={NOW_MS}
        onOpen={() => {}}
        selected
      />,
    );
    expect(
      screen.getByRole("button", { name: /open issue #3412/i }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      document.querySelector("[data-spine-card='3412']")?.getAttribute(
        "data-selected",
      ),
    ).toBe("true");
    expect(
      document
        .querySelector("[data-spine-card='3412']")
        ?.classList.contains("interactive-record-surface--selected"),
    ).toBe(true);
  });
});

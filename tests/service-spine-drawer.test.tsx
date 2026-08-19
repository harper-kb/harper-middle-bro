// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIONS_WORKBENCH_URL,
  SpineIssueDrawer,
  SPINE_TIMELINE_TRUNCATION_COPY,
  splitSpinePayload,
} from "@/app/service-spine/SpineIssueDrawer";
import { SpineFilterProvider } from "@/app/service-spine/SpineFilterProvider";
import { defaultSpineFilterState } from "@/app/service-spine/spine-filter-state";
import type {
  SpineIssueDetail,
  SpineTimeline,
  SpineTimelineEvent,
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

const GOAL = "Deliver the bound GL policy documents to the insured.";

function issueDetail(): SpineIssueDetail {
  return {
    issue: {
      id: 4242,
      companyId: 917669,
      accountId: "co-917669",
      companyName: "365 Business Solutions, LLC",
      issueType: "policy_delivery",
      goal: GOAL,
      status: "open",
      priority: "P1",
      blocking: "blocking",
      origin: "ai",
      correlationKey: "spine-prod-20260731:pd:4242",
      wave: "0731",
      slaDueAt: null,
      latestSummary: "Carrier promised documents by Friday.",
      openedAt: "2026-08-18T12:00:00.000Z",
      updatedAt: "2026-08-19T11:00:00.000Z",
      resolvedAt: null,
      agentOpen: 1,
      agentTotal: 2,
      humanOpen: 1,
      humanTotal: 1,
      openHumanAssignees: ["Dana Reyes"],
      openHumanAssigneeNames: ["Dana Reyes"],
      eventCount: 45,
      lastEventAt: "2026-08-19T11:56:00.000Z",
      hasDraft: true,
      closureProposed: false,
      pendingOrder: true,
      column: "open",
      lastCommunicationSummary: "Emailed the carrier contact on Monday.",
      resolutionSummary: null,
    },
    tasks: [
      {
        id: 9001,
        issueId: 4242,
        title: "Chase carrier for policy docs",
        ownerKind: "human",
        status: "in_progress",
        assignee: "42",
        assigneeLabel: "Dana Reyes",
        laneSkill: "carrier_chase",
        gateLabel: "Gate B",
        slaDueAt: null,
        createdAt: "2026-08-18T15:00:00.000Z",
        completedAt: null,
      },
      {
        id: 9002,
        issueId: 4242,
        title: "Draft delivery email",
        ownerKind: "agent",
        status: "done",
        assignee: null,
        assigneeLabel: null,
        laneSkill: null,
        gateLabel: null,
        slaDueAt: null,
        createdAt: "2026-08-18T15:05:00.000Z",
        completedAt: "2026-08-18T16:00:00.000Z",
      },
    ],
    taskLinks: [
      {
        id: 501,
        taskId: 9001,
        taskTitle: "Chase carrier for policy docs",
        linkKind: "blocked_by_task",
        linkRef: "svc:task:8999",
        createdAt: "2026-08-18T15:10:00.000Z",
      },
    ],
  };
}

/** 45 events oldest-first: a unique opener, comments, a unique newest kind. */
function timelineEvents(): SpineTimelineEvent[] {
  const events: SpineTimelineEvent[] = [];
  for (let id = 1; id <= 45; id += 1) {
    const kind =
      id === 1 ? "issue_opened" : id === 45 ? "closure_proposed" : "comment";
    events.push({
      id,
      kind,
      payload:
        id === 45
          ? { note: "Proposing closure — delivery confirmed.", task_id: 9001 }
          : id === 44
            ? "Left a voicemail for the insured."
            : null,
      actor: id % 2 === 0 ? "spine-agent" : null,
      at: `2026-08-19T10:${String(id).padStart(2, "0")}:00.000Z`,
    });
  }
  return events;
}

function timeline(overrides: Partial<SpineTimeline> = {}): SpineTimeline {
  return {
    events: timelineEvents(),
    totalEvents: 45,
    truncated: false,
    fetchedAt: "2026-08-19T12:00:00.000Z",
    ...overrides,
  };
}

type ApiBody = SpineIssueDetail & {
  timeline: SpineTimeline | null;
  timelineError: string | null;
};

function apiBody(overrides: Partial<ApiBody> = {}): ApiBody {
  return {
    ...issueDetail(),
    timeline: timeline(),
    timelineError: null,
    ...overrides,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function renderDrawer(issue: number | null = 4242) {
  return render(
    <SpineFilterProvider state={{ ...defaultSpineFilterState(), issue }}>
      <button type="button" data-spine-issue-trigger="4242">
        board card stand-in
      </button>
      <SpineIssueDrawer />
    </SpineFilterProvider>,
  );
}

beforeEach(() => {
  navigation.pushes.length = 0;
  navigation.replaces.length = 0;
  fetchMock = vi.fn(async () => json(apiBody()));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SpineIssueDrawer", () => {
  it("stays closed while the issue param is unset", () => {
    renderDrawer(null);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens from the issue param and fetches that issue's detail", async () => {
    renderDrawer();
    const dialog = await screen.findByRole("dialog");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/service-spine/issue/4242",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
    await screen.findByText(GOAL);
    expect(within(dialog).getByText("365 Business Solutions, LLC")).toBeTruthy();
    expect(within(dialog).getByText("Issue #4242")).toBeTruthy();
    // Head facts from the mirror row.
    expect(within(dialog).getByText("Pending orders")).toBeTruthy();
    expect(within(dialog).getByText("policy delivery")).toBeTruthy();
    expect(within(dialog).getByText("Wave 0731")).toBeTruthy();
    expect(within(dialog).getByText("Blocking issue")).toBeTruthy();
    expect(
      within(dialog).getByText("Carrier promised documents by Friday."),
    ).toBeTruthy();
    expect(
      within(dialog).getByText("Emailed the carrier contact on Monday."),
    ).toBeTruthy();
    // resolutionSummary is null — its box must not render.
    expect(within(dialog).queryByText("Resolution")).toBeNull();
  });

  it("renders overview-first tabs with read-only task and connection facts", async () => {
    renderDrawer();
    const dialog = await screen.findByRole("dialog");
    await screen.findByText(GOAL);

    expect(
      within(dialog).getByRole("tab", { name: "Overview" }).getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    expect(
      within(dialog).getByRole("tab", { name: "Timeline (45)" }),
    ).toBeTruthy();
    const tasksTab = within(dialog).getByRole("tab", { name: "Tasks (2)" });
    expect(
      within(dialog).getByRole("tab", { name: "Connections (2)" }),
    ).toBeTruthy();

    fireEvent.click(tasksTab);
    expect(
      within(dialog).getByText("Chase carrier for policy docs"),
    ).toBeTruthy();
    expect(within(dialog).getByText("Gate B")).toBeTruthy();
    expect(within(dialog).getByText("carrier_chase")).toBeTruthy();
    expect(within(dialog).getByText("Dana Reyes")).toBeTruthy();
    expect(within(dialog).getByText("in progress")).toBeTruthy();
    // Read-only v1: assignment and completion are facts, never controls.
    expect(
      within(dialog).queryByRole("button", {
        name: /assign|complete|resolve|cancel/i,
      }),
    ).toBeNull();

    fireEvent.click(
      within(dialog).getByRole("tab", { name: "Connections (2)" }),
    );
    expect(
      within(dialog).getByRole("link", { name: /Company account/i }),
    ).toBeTruthy();
    expect(within(dialog).getByText("blocked by task")).toBeTruthy();
    expect(within(dialog).getByText("svc:task:8999")).toBeTruthy();
    expect(
      within(dialog).getByText("From Chase carrier for policy docs"),
    ).toBeTruthy();
  });

  it("progressively renders the newest timeline events", async () => {
    renderDrawer();
    const dialog = await screen.findByRole("dialog");
    await screen.findByText(GOAL);
    fireEvent.click(
      within(dialog).getByRole("tab", { name: "Timeline (45)" }),
    );

    // 45 loaded, initial page at 20: the newest paints, the oldest waits.
    expect(within(dialog).getByText("closure proposed")).toBeTruthy();
    expect(within(dialog).queryByText("issue opened")).toBeNull();
    expect(
      within(dialog).getByText((text) =>
        text.includes("20 shown · 45 loaded · 45 total"),
      ),
    ).toBeTruthy();

    // Short human payload strings render inline; ids stay behind the fold.
    expect(
      within(dialog).getByText("Left a voicemail for the insured."),
    ).toBeTruthy();
    expect(
      within(dialog).getByText("Proposing closure — delivery confirmed."),
    ).toBeTruthy();
    expect(within(dialog).getAllByText("Raw payload").length).toBeGreaterThan(0);

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Show 20 older events" }),
    );
    expect(within(dialog).queryByText("issue opened")).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Show 5 older events" }),
    );
    expect(within(dialog).getByText("issue opened")).toBeTruthy();
  });

  it("names the 500-cap truncation without hiding the loaded window", async () => {
    fetchMock.mockResolvedValue(
      json(apiBody({ timeline: timeline({ totalEvents: 600, truncated: true }) })),
    );
    renderDrawer();
    const dialog = await screen.findByRole("dialog");
    await screen.findByText(GOAL);
    fireEvent.click(
      within(dialog).getByRole("tab", { name: "Timeline (600)" }),
    );

    expect(
      within(dialog).getByText(
        (text) =>
          text.includes("Showing the newest 45 of 600 events.") &&
          text.includes(SPINE_TIMELINE_TRUNCATION_COPY),
      ),
    ).toBeTruthy();
  });

  it("shows an honest compact state when summaries are missing", async () => {
    const detail = issueDetail();
    detail.issue.latestSummary = null;
    detail.issue.lastCommunicationSummary = null;
    fetchMock.mockResolvedValue(
      json({ ...detail, timeline: timeline(), timelineError: null }),
    );
    renderDrawer();
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(
        "No latest summary or communication is on record yet.",
      ),
    ).toBeTruthy();
  });

  it("filters verified agent events and materializes raw payload only on demand", async () => {
    renderDrawer();
    const dialog = await screen.findByRole("dialog");
    await screen.findByText(GOAL);
    fireEvent.click(
      within(dialog).getByRole("tab", { name: "Timeline (45)" }),
    );
    fireEvent.click(
      within(dialog).getByRole("radio", { name: /agent/i }),
    );
    expect(within(dialog).getAllByText("Service agent")).toHaveLength(20);

    fireEvent.click(
      within(dialog).getByRole("radio", { name: /all events/i }),
    );
    const rawButtons = within(dialog).getAllByRole("button", {
      name: "Raw payload",
    });
    expect(within(dialog).queryByText(/"task_id"/)).toBeNull();
    fireEvent.click(rawButtons[0]!);
    expect(within(dialog).getByText(/"task_id"/)).toBeTruthy();
  });

  it("keeps head and tasks useful when only the timeline read failed", async () => {
    fetchMock.mockResolvedValue(
      json(
        apiBody({
          timeline: null,
          timelineError: "The issue timeline is temporarily unavailable.",
        }),
      ),
    );
    renderDrawer();
    const dialog = await screen.findByRole("dialog");
    await screen.findByText(GOAL);
    fireEvent.click(
      within(dialog).getByRole("tab", { name: "Timeline (45)" }),
    );

    expect(within(dialog).getByText("Timeline unavailable")).toBeTruthy();
    expect(
      within(dialog).getByText("The issue timeline is temporarily unavailable."),
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("tab", { name: "Tasks (2)" }));
    expect(
      within(dialog).getByText("Chase carrier for policy docs"),
    ).toBeTruthy();
  });

  it("shows the named detail failure with a retry", async () => {
    fetchMock.mockResolvedValue(
      json({ error: "Issue detail is temporarily unavailable." }, 503),
    );
    renderDrawer();
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText("Issue detail unavailable"),
    ).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("carries the read-only workbench footer", async () => {
    renderDrawer();
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "Actions are managed in Actions Workbench.",
      ),
    ).toBeTruthy();
    const link = within(dialog).getByRole("link", {
      name: /open actions workbench/i,
    });
    expect(link.getAttribute("href")).toBe(ACTIONS_WORKBENCH_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("closes on Escape by popping the issue param and restores focus to the trigger", async () => {
    renderDrawer();
    await screen.findByRole("dialog");
    await screen.findByText(GOAL);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(navigation.pushes).toEqual(["/service-spine"]);

    const trigger = screen.getByText("board card stand-in");
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("makes the background inert while open and restores it on close", async () => {
    renderDrawer();
    await screen.findByRole("dialog");
    const trigger = screen.getByText("board card stand-in");
    const appRoot = trigger.closest("div");
    expect((appRoot as HTMLElement | null)?.inert).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((appRoot as HTMLElement | null)?.inert).toBe(false);
  });

  it("supports arrow-key tab navigation", async () => {
    renderDrawer();
    const dialog = await screen.findByRole("dialog");
    await screen.findByText(GOAL);
    const overview = within(dialog).getByRole("tab", { name: "Overview" });
    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    const tasks = within(dialog).getByRole("tab", { name: "Tasks (2)" });
    expect(tasks.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tasks);
  });
});

describe("splitSpinePayload", () => {
  it("inlines short human strings and folds id-shaped or long values", () => {
    const { inline, raw } = splitSpinePayload({
      note: "Called the insured back.",
      correlation_key: "spine-prod-20260731:pd:4242",
      task_id: "9001",
      uuid: "0e6f4c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b",
      long: "x".repeat(500),
      count: 3,
    });
    expect(inline).toEqual([{ key: "note", value: "Called the insured back." }]);
    expect(raw).toContain("spine-prod-20260731:pd:4242");
  });

  it("inlines a bare short string payload and folds a bare id", () => {
    expect(splitSpinePayload("All set.").inline).toEqual([
      { key: null, value: "All set." },
    ]);
    expect(splitSpinePayload("123456789").inline).toEqual([]);
    expect(splitSpinePayload(null)).toEqual({ inline: [], raw: null });
  });
});

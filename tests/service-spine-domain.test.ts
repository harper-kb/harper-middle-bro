import { describe, expect, it } from "vitest";
import {
  buildSpineSearchHaystack,
  eventKindLabel,
  ISSUE_TERMINAL_STATUSES,
  issueInSpineQueue,
  issueTypeLabel,
  isOpenHumanTask,
  isOpenTaskStatus,
  isTerminalIssueStatus,
  SPINE_COLUMNS,
  spineAssigneeMatchesViewer,
  spineCohortOf,
  spineColumnLabel,
  spineColumnOf,
  spineQueuePersonOf,
  spineSlaDuration,
  spineSlaState,
  SLA_SOON_WINDOW_MS,
  statusLabel,
  viewerNameMatches,
  waveOf,
} from "@/lib/service-spine/domain";

/**
 * Every Service Spine domain law, pinned against the audited source semantics
 * (harper-coi-workbench @ 718064e5 — labels.ts, my-queue.ts,
 * work-lane-core.ts, ServiceSpineBoard.tsx). These are the laws both the
 * refresher and the read service import; if one drifts, every face drifts.
 */

describe("column fold (spineColumnOf)", () => {
  it("folds both terminal statuses to closed", () => {
    expect(ISSUE_TERMINAL_STATUSES).toEqual(["resolved", "cancelled"]);
    expect(spineColumnOf({ status: "resolved", closureProposed: false })).toBe(
      "closed",
    );
    expect(spineColumnOf({ status: "cancelled", closureProposed: false })).toBe(
      "closed",
    );
  });

  it("lets a terminal status outrank a closure proposal", () => {
    expect(spineColumnOf({ status: "resolved", closureProposed: true })).toBe(
      "closed",
    );
    expect(spineColumnOf({ status: "cancelled", closureProposed: true })).toBe(
      "closed",
    );
  });

  it("files a proposed closure ahead of the raw status", () => {
    expect(spineColumnOf({ status: "open", closureProposed: true })).toBe(
      "closure-proposed",
    );
    expect(
      spineColumnOf({ status: "waiting_customer", closureProposed: true }),
    ).toBe("closure-proposed");
    expect(spineColumnOf({ status: "blocked", closureProposed: true })).toBe(
      "closure-proposed",
    );
  });

  it("keeps every non-terminal status verbatim", () => {
    for (const status of [
      "open",
      "waiting_customer",
      "waiting_third_party",
      "blocked",
    ]) {
      expect(spineColumnOf({ status, closureProposed: false })).toBe(status);
    }
  });

  it("gives an unknown status its own column, never a silent re-file", () => {
    expect(spineColumnOf({ status: "paused", closureProposed: false })).toBe(
      "paused",
    );
    expect(
      spineColumnOf({ status: "escalated_to_legal", closureProposed: false }),
    ).toBe("escalated_to_legal");
  });

  it("declares six columns with the blocked column foldable", () => {
    expect(SPINE_COLUMNS.map((column) => column.id)).toEqual([
      "open",
      "waiting_customer",
      "waiting_third_party",
      "blocked",
      "closure-proposed",
      "closed",
    ]);
    for (const column of SPINE_COLUMNS) {
      expect(column.alwaysShown).toBe(column.id !== "blocked");
    }
  });
});

describe("labels", () => {
  it("maps the six known statuses to operator labels", () => {
    expect(statusLabel("open")).toBe("Open");
    expect(statusLabel("waiting_customer")).toBe("Waiting on customer");
    expect(statusLabel("waiting_third_party")).toBe("Waiting on third party");
    expect(statusLabel("blocked")).toBe("Blocked");
    expect(statusLabel("resolved")).toBe("Resolved");
    expect(statusLabel("cancelled")).toBe("Cancelled");
  });

  it("degrades unknown keys to readable words, never a raw token", () => {
    expect(statusLabel("waiting_on_legal")).toBe("waiting on legal");
    expect(issueTypeLabel("general_request")).toBe("general request");
    expect(eventKindLabel("closure_proposed")).toBe("closure proposed");
  });

  it("labels known columns from the declaration and unknown via statusLabel", () => {
    expect(spineColumnLabel("closure-proposed")).toBe("Closure proposed");
    expect(spineColumnLabel("closed")).toBe("Closed");
    expect(spineColumnLabel("paused")).toBe("paused");
    expect(spineColumnLabel("weird_state")).toBe("weird state");
  });
});

describe("wave parsing (waveOf)", () => {
  it("reads MMDD off a dated tag prefix", () => {
    expect(waveOf("spine-prod-20260731:x")).toBe("0731");
    expect(waveOf("spine-prod-20261115:batch:9")).toBe("1115");
    expect(waveOf("20260731:anything")).toBe("0731");
  });

  it("returns null for undated keys and absent keys", () => {
    expect(waveOf("deterministic:iq_coi_send:order:13265")).toBeNull();
    expect(waveOf("foo:bar")).toBeNull();
    expect(waveOf("")).toBeNull();
    expect(waveOf(null)).toBeNull();
  });

  it("only matches a date at the END of the first segment", () => {
    expect(waveOf("spine-prod-20260731-extra:x")).toBeNull();
    expect(waveOf("spine-prod-20260731")).toBe("0731");
  });
});

describe("task openness", () => {
  it("treats done and cancelled as closed, everything else open", () => {
    expect(isOpenTaskStatus("todo")).toBe(true);
    expect(isOpenTaskStatus("in_progress")).toBe(true);
    expect(isOpenTaskStatus("waiting")).toBe(true);
    expect(isOpenTaskStatus("done")).toBe(false);
    expect(isOpenTaskStatus("cancelled")).toBe(false);
  });

  it("requires human ownership AND openness for open-human", () => {
    expect(isOpenHumanTask({ ownerKind: "human", status: "todo" })).toBe(true);
    expect(isOpenHumanTask({ ownerKind: "human", status: "done" })).toBe(false);
    expect(isOpenHumanTask({ ownerKind: "agent", status: "todo" })).toBe(false);
    expect(isOpenHumanTask({ ownerKind: null, status: null })).toBe(false);
  });
});

describe("viewer name matching (work-lane-core law)", () => {
  it("matches folded names exactly", () => {
    expect(viewerNameMatches("Jane Doe", "jane doe")).toBe(true);
    expect(viewerNameMatches("JANE   DOE", "Jane Doe")).toBe(true);
    expect(viewerNameMatches("Jane Doe", "Jane Smith")).toBe(false);
    expect(viewerNameMatches("John Doe", "Jane Doe")).toBe(false);
  });

  it("prefix-matches trailing tokens after an exact first token", () => {
    expect(viewerNameMatches("Jane D", "Jane Doe")).toBe(true);
    expect(viewerNameMatches("Jane Do", "Jane Doe")).toBe(true);
    expect(viewerNameMatches("Jane Doeling", "Jane Doe")).toBe(false);
  });

  it("folds ONLY harperinsure.com emails with two-token local parts", () => {
    expect(viewerNameMatches("jane.doe@harperinsure.com", "Jane Doe")).toBe(
      true,
    );
    expect(viewerNameMatches("Jane Doe", "jane.doe@harperinsure.com")).toBe(
      true,
    );
    // Single-token local part never folds to a name.
    expect(viewerNameMatches("jane@harperinsure.com", "Jane Doe")).toBe(false);
    // Foreign domains never fold.
    expect(viewerNameMatches("jane.doe@gmail.com", "Jane Doe")).toBe(false);
    // Empty sides never match.
    expect(viewerNameMatches("", "Jane Doe")).toBe(false);
    expect(viewerNameMatches("Jane Doe", null)).toBe(false);
  });
});

describe("assignee vs viewer (spineAssigneeMatchesViewer)", () => {
  it("matches an exact email case-insensitively", () => {
    expect(
      spineAssigneeMatchesViewer("Jane.Doe@HarperInsure.com", {
        name: "Someone Else",
        email: "jane.doe@harperinsure.com",
      }),
    ).toBe(true);
  });

  it("falls back to the name law when the email differs", () => {
    expect(
      spineAssigneeMatchesViewer("Jane Doe", {
        name: "Jane Doe",
        email: "other@harperinsure.com",
      }),
    ).toBe(true);
    expect(
      spineAssigneeMatchesViewer("", { name: "Jane Doe", email: "j@x.com" }),
    ).toBe(false);
  });
});

describe("queue law (issueInSpineQueue)", () => {
  const viewer = { name: "Jane Doe", email: "jane.doe@harperinsure.com" };
  const issue = (
    humanOpen: number,
    agentOpen: number,
    openHumanAssignees: string[] = [],
  ) => ({ humanOpen, agentOpen, openHumanAssignees });

  it("runs the all/human/ai/human+ai truth table", () => {
    const cases: Array<{
      human: number;
      agent: number;
      all: boolean;
      humanQ: boolean;
      aiQ: boolean;
      bothQ: boolean;
    }> = [
      { human: 0, agent: 0, all: true, humanQ: false, aiQ: false, bothQ: false },
      { human: 1, agent: 0, all: true, humanQ: true, aiQ: false, bothQ: true },
      { human: 0, agent: 2, all: true, humanQ: false, aiQ: true, bothQ: true },
      { human: 3, agent: 1, all: true, humanQ: true, aiQ: true, bothQ: true },
    ];
    for (const c of cases) {
      const row = issue(c.human, c.agent);
      expect(issueInSpineQueue(row, "all", viewer)).toBe(c.all);
      expect(issueInSpineQueue(row, "human", viewer)).toBe(c.humanQ);
      expect(issueInSpineQueue(row, "ai", viewer)).toBe(c.aiQ);
      expect(issueInSpineQueue(row, "human+ai", viewer)).toBe(c.bothQ);
    }
  });

  it("matches mine on a name token", () => {
    expect(
      issueInSpineQueue(issue(1, 0, ["Jane Doe"]), "mine", viewer),
    ).toBe(true);
    expect(
      issueInSpineQueue(issue(1, 0, ["Bob Smith"]), "mine", viewer),
    ).toBe(false);
  });

  it("matches mine on an exact email token", () => {
    expect(
      issueInSpineQueue(
        issue(1, 0, ["JANE.DOE@harperinsure.com"]),
        "mine",
        viewer,
      ),
    ).toBe(true);
  });

  it("matches mine through the harperinsure email fold", () => {
    // Assignee token is an email; viewer email differs; the local part folds
    // to a two-token name that matches the viewer's display name.
    expect(
      issueInSpineQueue(issue(1, 0, ["jane.doe@harperinsure.com"]), "mine", {
        name: "Jane Doe",
        email: "different@harperinsure.com",
      }),
    ).toBe(true);
    expect(
      issueInSpineQueue(issue(1, 0, ["jane.doe@gmail.com"]), "mine", {
        name: "Jane Doe",
        email: "different@harperinsure.com",
      }),
    ).toBe(false);
  });

  it("applies the person: exact-token law (never fuzzy)", () => {
    const row = issue(1, 0, ["Jane Doe", "Bob Smith"]);
    expect(issueInSpineQueue(row, "person:jane doe", viewer)).toBe(true);
    expect(issueInSpineQueue(row, "person: Jane Doe ", viewer)).toBe(true);
    expect(issueInSpineQueue(row, "person:jane", viewer)).toBe(false);
    expect(issueInSpineQueue(row, "person:doe", viewer)).toBe(false);
  });

  it("reads the person off the queue value", () => {
    expect(spineQueuePersonOf("person:Jane Doe")).toBe("Jane Doe");
    expect(spineQueuePersonOf("person:   ")).toBeNull();
    expect(spineQueuePersonOf("mine")).toBeNull();
  });

  it("treats an empty assignee set as matching nobody", () => {
    expect(issueInSpineQueue(issue(1, 0, []), "mine", viewer)).toBe(false);
    expect(issueInSpineQueue(issue(1, 0), "person:jane doe", viewer)).toBe(
      false,
    );
  });
});

describe("SLA states (spineSlaState)", () => {
  const now = Date.parse("2026-08-19T12:00:00.000Z");

  it("shows nothing for terminal, absent, or unparseable due dates", () => {
    expect(
      spineSlaState("2026-08-19T13:00:00.000Z", "resolved", now),
    ).toEqual({ state: "none", dueMs: null });
    expect(
      spineSlaState("2026-08-19T13:00:00.000Z", "cancelled", now),
    ).toEqual({ state: "none", dueMs: null });
    expect(spineSlaState(null, "open", now)).toEqual({
      state: "none",
      dueMs: null,
    });
    expect(spineSlaState("not-a-date", "open", now)).toEqual({
      state: "none",
      dueMs: null,
    });
  });

  it("marks a past due date breached", () => {
    const due = "2026-08-19T11:59:59.000Z";
    expect(spineSlaState(due, "open", now)).toEqual({
      state: "breached",
      dueMs: Date.parse(due),
    });
  });

  it("marks a due date inside four hours as soon, at/beyond as due", () => {
    const soon = "2026-08-19T15:59:59.000Z";
    expect(spineSlaState(soon, "open", now).state).toBe("soon");
    const exactlyFourHours = new Date(now + SLA_SOON_WINDOW_MS).toISOString();
    expect(spineSlaState(exactlyFourHours, "open", now).state).toBe("due");
    expect(spineSlaState("2026-08-20T12:00:00.000Z", "open", now).state).toBe(
      "due",
    );
  });

  it("formats short durations like the source durShort", () => {
    expect(spineSlaDuration(30_000)).toBe("1m");
    expect(spineSlaDuration(90_000)).toBe("1m");
    expect(spineSlaDuration(16 * 3_600_000 + 20 * 60_000)).toBe("16h 20m");
    expect(spineSlaDuration(28 * 3_600_000)).toBe("1d 4h");
    expect(spineSlaDuration(-28 * 3_600_000)).toBe("1d 4h");
  });
});

describe("cohort mapping (spineCohortOf)", () => {
  it("maps the tri-state exactly", () => {
    expect(spineCohortOf(true)).toBe("pending");
    expect(spineCohortOf(false)).toBe("active");
    expect(spineCohortOf(null)).toBe("others");
  });
});

describe("search haystack (buildSpineSearchHaystack)", () => {
  const issue = {
    companyName: "Acme Trucking LLC",
    companyId: 925148,
    id: 4321,
    goal: "Deliver the renewed policy",
    issueType: "policy_delivery",
    status: "waiting_customer",
    priority: "P1",
    correlationKey: "spine-prod-20260731:batch",
    latestSummary: "Waiting for the insured to confirm.",
    origin: "deterministic",
  };

  it("covers every source search field, lowercased", () => {
    const haystack = buildSpineSearchHaystack(issue);
    expect(haystack).toBe(haystack.toLowerCase());
    for (const needle of [
      "acme trucking llc",
      "925148",
      "4321",
      "deliver the renewed policy",
      "policy_delivery",
      "policy delivery", // issueTypeLabel
      "waiting_customer",
      "waiting on customer", // statusLabel
      "p1",
      "spine-prod-20260731:batch",
      "waiting for the insured to confirm.",
      "deterministic",
    ]) {
      expect(haystack).toContain(needle);
    }
  });

  it("skips absent fields instead of writing null words", () => {
    const haystack = buildSpineSearchHaystack({
      ...issue,
      companyName: null,
      companyId: null,
      correlationKey: null,
      latestSummary: null,
      origin: null,
    });
    expect(haystack).not.toContain("null");
    expect(haystack).not.toContain("acme");
    expect(haystack).toContain("4321");
  });

  it("degrades unknown statuses to their readable label in the haystack", () => {
    const haystack = buildSpineSearchHaystack({
      ...issue,
      status: "waiting_on_legal",
    });
    expect(haystack).toContain("waiting_on_legal");
    expect(haystack).toContain("waiting on legal");
  });

  it("keeps terminal statuses searchable by label", () => {
    expect(isTerminalIssueStatus("resolved")).toBe(true);
    const haystack = buildSpineSearchHaystack({ ...issue, status: "resolved" });
    expect(haystack).toContain("resolved");
  });
});

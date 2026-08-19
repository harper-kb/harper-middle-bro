import { describe, expect, it } from "vitest";
import {
  clearSpineFilters,
  defaultSpineFilterState,
  droppedSpineParams,
  isCanonicalSpineQuery,
  normalizeSpineFilterState,
  parseSpineFilterState,
  serializeSpineFilterState,
  spineFilterHref,
  SPINE_FILTER_PARAM_ORDER,
  updateSpineFilters,
  type SpineFilterState,
  type SpineSearchParams,
} from "@/app/service-spine/spine-filter-state";

/** Rebuild the shape Next.js hands a page from a query string. */
function paramsOf(query: string): SpineSearchParams {
  const params: SpineSearchParams = {};
  for (const [key, value] of new URLSearchParams(query)) {
    const existing = params[key];
    if (existing === undefined) {
      params[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      params[key] = [existing, value];
    }
  }
  return params;
}

const FULL_STATE: SpineFilterState = {
  view: "table",
  q: "roof leak",
  priority: "P1",
  type: "policy_delivery",
  wave: "0731",
  cohort: "pending",
  queue: "human+ai",
  sort: "priority",
  rows: 250,
  page: 3,
  issue: 4242,
};

describe("spine filter state codec", () => {
  it("serializes the default state to the bare path", () => {
    const state = defaultSpineFilterState();
    expect(serializeSpineFilterState(state).toString()).toBe("");
    expect(spineFilterHref(state)).toBe("/service-spine");
  });

  it("round-trips a fully specified state through the URL", () => {
    const query = serializeSpineFilterState(FULL_STATE).toString();
    expect(parseSpineFilterState(paramsOf(query))).toEqual(FULL_STATE);
  });

  it("serializes params in the canonical fixed order", () => {
    const keys = [...serializeSpineFilterState(FULL_STATE).keys()];
    expect(keys).toEqual([...SPINE_FILTER_PARAM_ORDER]);
  });

  it("omits every default-valued param", () => {
    const params = serializeSpineFilterState({
      ...defaultSpineFilterState(),
      priority: "P0",
    });
    expect([...params.keys()]).toEqual(["priority"]);
  });

  it("drops each unrecognised value on its own field, never the model", () => {
    const state = parseSpineFilterState({
      view: "grid",
      q: "still here",
      priority: "P12",
      type: "Policy-Delivery",
      wave: "073",
      cohort: "archived",
      queue: "robots",
      sort: "newest",
      rows: "123",
      page: "0",
      issue: "-4",
    });
    expect(state).toEqual({
      ...defaultSpineFilterState(),
      q: "still here",
    });
  });

  it("keeps every valid field when one sibling is invalid", () => {
    const state = parseSpineFilterState({
      priority: "P0",
      wave: "0731",
      cohort: "nonsense",
    });
    expect(state.priority).toBe("P0");
    expect(state.wave).toBe("0731");
    expect(state.cohort).toBeNull();
  });

  it("trims, caps at 200 chars and strips control characters from q", () => {
    const noisy = `  hello\u0000\u001f world\u007f  `;
    expect(parseSpineFilterState({ q: noisy }).q).toBe("hello world");
    const long = "x".repeat(300);
    expect(parseSpineFilterState({ q: long }).q).toHaveLength(200);
  });

  it("validates page and issue as integers", () => {
    expect(parseSpineFilterState({ page: "2" }).page).toBe(2);
    expect(parseSpineFilterState({ page: "0" }).page).toBe(1);
    expect(parseSpineFilterState({ page: "-3" }).page).toBe(1);
    expect(parseSpineFilterState({ page: "1.5" }).page).toBe(1);
    expect(parseSpineFilterState({ page: "abc" }).page).toBe(1);
    expect(
      parseSpineFilterState({ page: "99999999999999999999" }).page,
    ).toBe(1);

    expect(parseSpineFilterState({ issue: "17" }).issue).toBe(17);
    expect(parseSpineFilterState({ issue: "0" }).issue).toBeNull();
    expect(parseSpineFilterState({ issue: "-2" }).issue).toBeNull();
    expect(parseSpineFilterState({ issue: "3.5" }).issue).toBeNull();
    expect(parseSpineFilterState({ issue: "abc" }).issue).toBeNull();
    expect(
      parseSpineFilterState({ issue: "99999999999999999999" }).issue,
    ).toBeNull();
  });

  it("accepts only the board rows steps", () => {
    expect(parseSpineFilterState({ rows: "250" }).rows).toBe(250);
    expect(parseSpineFilterState({ rows: "1000" }).rows).toBe(1000);
    expect(parseSpineFilterState({ rows: "300" }).rows).toBe(100);
    expect(parseSpineFilterState({ rows: "0" }).rows).toBe(100);
  });

  it("round-trips person queue values, including spaces", () => {
    const state = parseSpineFilterState({ queue: "person:Jane Doe" });
    expect(state.queue).toBe("person:Jane Doe");

    const serialized = serializeSpineFilterState(state);
    expect(serialized.get("queue")).toBe("person:Jane Doe");
    // Through the encoded wire format and back.
    const reparsed = parseSpineFilterState(paramsOf(serialized.toString()));
    expect(reparsed.queue).toBe("person:Jane Doe");
  });

  it("normalizes person queue whitespace and drops empty or oversized names", () => {
    expect(parseSpineFilterState({ queue: "person:  Jane Doe  " }).queue).toBe(
      "person:Jane Doe",
    );
    expect(parseSpineFilterState({ queue: "person:" }).queue).toBe("all");
    expect(parseSpineFilterState({ queue: "person:   " }).queue).toBe("all");
    expect(
      parseSpineFilterState({ queue: `person:${"n".repeat(81)}` }).queue,
    ).toBe("all");
  });

  it("keeps human+ai intact through URL encoding and drops the decoded-space spelling", () => {
    const query = serializeSpineFilterState({
      ...defaultSpineFilterState(),
      queue: "human+ai",
    }).toString();
    expect(query).toBe("queue=human%2Bai");
    expect(parseSpineFilterState(paramsOf(query)).queue).toBe("human+ai");
    // A hand-typed `?queue=human+ai` decodes to "human ai" — an unknown mode.
    expect(parseSpineFilterState({ queue: "human ai" }).queue).toBe("all");
  });

  it("recognises the canonical spelling and rejects any other", () => {
    const query = serializeSpineFilterState(FULL_STATE).toString();
    const canonical = paramsOf(query);
    expect(isCanonicalSpineQuery(parseSpineFilterState(canonical), canonical)).toBe(
      true,
    );

    // Same state, different param order.
    const reordered = paramsOf("q=roof+leak&view=table");
    const reorderedState = parseSpineFilterState(reordered);
    expect(isCanonicalSpineQuery(reorderedState, reordered)).toBe(false);
    // Redirect settles in one hop: the canonical spelling parses to itself.
    const settled = paramsOf(
      serializeSpineFilterState(reorderedState).toString(),
    );
    expect(isCanonicalSpineQuery(parseSpineFilterState(settled), settled)).toBe(
      true,
    );

    // A default value spelled out is non-canonical.
    const explicitDefault = paramsOf("view=board");
    expect(
      isCanonicalSpineQuery(parseSpineFilterState(explicitDefault), explicitDefault),
    ).toBe(false);

    // Repeated params are non-canonical; the first value wins the parse.
    const repeated = paramsOf("priority=P1&priority=P2");
    const repeatedState = parseSpineFilterState(repeated);
    expect(repeatedState.priority).toBe("P1");
    expect(isCanonicalSpineQuery(repeatedState, repeated)).toBe(false);
  });

  it("names exactly the fields a redirect dropped", () => {
    const params: SpineSearchParams = {
      priority: "P77",
      wave: "0731",
      issue: "zero",
    };
    const state = parseSpineFilterState(params);
    expect(droppedSpineParams(state, params)).toEqual(["priority", "issue"]);
  });

  it("normalizing is idempotent and matches the parse", () => {
    const normalized = normalizeSpineFilterState({
      ...FULL_STATE,
      priority: "urgent",
      queue: "person:  Ana Li ",
    });
    expect(normalized.priority).toBeNull();
    expect(normalized.queue).toBe("person:Ana Li");
    expect(normalizeSpineFilterState(normalized)).toEqual(normalized);
  });

  it("resets the page when the result set changes, and only then", () => {
    const onPageThree = { ...FULL_STATE };
    expect(updateSpineFilters(onPageThree, { q: "water" }).page).toBe(1);
    expect(updateSpineFilters(onPageThree, { cohort: "active" }).page).toBe(1);
    // Opening the drawer and raising the board cap keep the page.
    expect(updateSpineFilters(onPageThree, { issue: 7 }).page).toBe(3);
    expect(updateSpineFilters(onPageThree, { rows: 500 }).page).toBe(3);
    // An explicit page patch is respected verbatim.
    expect(updateSpineFilters(onPageThree, { page: 2 }).page).toBe(2);
  });

  it("clears filters without touching the face or the open drawer", () => {
    const cleared = clearSpineFilters(FULL_STATE);
    expect(cleared).toEqual({
      ...defaultSpineFilterState(),
      view: "table",
      issue: 4242,
    });
  });
});

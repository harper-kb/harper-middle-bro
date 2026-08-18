// @vitest-environment jsdom
/**
 * The State & Sort control: trigger wording per selection, the URL contract
 * (filters survive, `page` resets, codes and the sort tokens land
 * canonical), the state picker as a dropdown selection inside the popover,
 * the two composable sort radio groups (date + revenue), option search,
 * unavailable selections, Clear, and the keyboard path.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCATION_STATE_NONE } from "@/lib/location-state";
import { DEFAULT_ACCOUNT_SORT } from "@/lib/account-sort";
import { RecordsTestProvider } from "./records-filter-test-utils";

const pushes: string[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => {
      pushes.push(href);
    },
  }),
}));

const { StateSortSelect, stateSortHref, stateSortTriggerText } = await import(
  "@/app/all-accounts/StateSortSelect"
);

const OPTIONS = [
  { id: "CA", code: "CA", label: "California", accountCount: 214 },
  { id: "FL", code: "FL", label: "Florida", accountCount: 356 },
  { id: "NY", code: "NY", label: "New York", accountCount: 48 },
  {
    id: LOCATION_STATE_NONE,
    code: null,
    label: "Unknown / Not set",
    accountCount: 12,
  },
];

function renderControl(
  props: Partial<Parameters<typeof StateSortSelect>[0]> = {},
) {
  const selectedStates = props.selectedStates ?? [];
  const sort = props.sort ?? DEFAULT_ACCOUNT_SORT;
  return render(
    <RecordsTestProvider
      params={{ source: "iq", page: "3" }}
      patch={{ locationStates: selectedStates, sort }}
    >
      <StateSortSelect
        basePath="/pending-orders"
        currentParams={{ source: "iq", page: "3" }}
        selectedStates={selectedStates}
        sort={sort}
        options={OPTIONS}
        unavailableSelected={[]}
        resultTotal={42}
        {...props}
      />
    </RecordsTestProvider>,
  );
}

/** Open the popover, then drop down the state menu. */
async function openStates(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: /Filter by location state/ }),
  );
  await user.click(screen.getByRole("button", { name: /^Location State/ }));
}

afterEach(() => {
  cleanup();
  pushes.length = 0;
});

describe("stateSortHref", () => {
  it("keeps every active filter, resets the page, writes canonical values", () => {
    expect(
      stateSortHref(
        "/pending-orders",
        { q: "acme", carrier: "hiscox ins co", page: "4" },
        ["NY", "CA"],
        { date: "newest", revenue: "revenue-desc" },
      ),
    ).toBe(
      "/pending-orders?carrier=hiscox+ins+co&state=CA%2CNY&sort=revenue-desc%2Cnewest&q=acme",
    );
  });

  it("drops both params when the selection empties back to defaults", () => {
    expect(
      stateSortHref(
        "/bound-orders",
        { state: "CA,NY", sort: "newest", range: "this-week" },
        [],
        DEFAULT_ACCOUNT_SORT,
      ),
    ).toBe("/bound-orders?range=this-week");
  });
});

describe("stateSortTriggerText", () => {
  it("summarizes state and sort compactly", () => {
    expect(stateSortTriggerText([], DEFAULT_ACCOUNT_SORT)).toBe("State & Sort");
    expect(
      stateSortTriggerText(["CA"], { date: "newest", revenue: "none" }),
    ).toBe("CA · Newest");
    expect(stateSortTriggerText(["CA"], DEFAULT_ACCOUNT_SORT)).toBe("CA");
    expect(
      stateSortTriggerText(["CA", "FL", "NY"], {
        date: "oldest",
        revenue: "revenue-desc",
      }),
    ).toBe("3 states · Revenue high");
    expect(
      stateSortTriggerText([], { date: "newest", revenue: "revenue-asc" }),
    ).toBe("All states · Revenue low · Newest");
    expect(
      stateSortTriggerText([LOCATION_STATE_NONE], DEFAULT_ACCOUNT_SORT),
    ).toBe("Unknown");
  });
});

describe("StateSortSelect", () => {
  it("names itself and its active selection on the trigger", () => {
    renderControl({
      selectedStates: ["CA"],
      sort: { date: "newest", revenue: "none" },
    });
    const trigger = screen.getByRole("button", {
      name: "Filter by location state and sort accounts: CA · Newest",
    });
    expect(trigger.textContent).toContain("CA · Newest");
    expect(trigger.className).toContain("carrier-trigger--active");
  });

  it("stays quiet with no selection and the default (oldest) sort", () => {
    renderControl();
    const trigger = screen.getByRole("button", {
      name: "Filter by location state and sort accounts",
    });
    expect(trigger.textContent).toContain("State & Sort");
    expect(trigger.className).not.toContain("carrier-trigger--active");
  });

  it("keeps the state menu behind a dropdown so both sort groups stay in view", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(
      screen.getByRole("button", {
        name: "Filter by location state and sort accounts",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Location state and sort",
    });
    // Collapsed: no checkboxes yet, the dropdown field summarizes.
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
    const dropdown = within(dialog).getByRole("button", {
      name: /^Location State/,
    });
    expect(dropdown.textContent).toContain("All states");
    expect(dropdown.getAttribute("aria-expanded")).toBe("false");
    // Both sort groups are visible before the menu is ever opened.
    expect(within(dialog).getByRole("radiogroup", { name: "Sort · Date" })).toBeTruthy();
    expect(
      within(dialog).getByRole("radiogroup", { name: "Sort · Revenue" }),
    ).toBeTruthy();
    // Dropped down: the searchable multi-select appears.
    await user.click(dropdown);
    expect(dropdown.getAttribute("aria-expanded")).toBe("true");
    const boxes = within(dialog).getAllByRole("checkbox");
    expect(boxes.map((box) => box.getAttribute("aria-label"))).toEqual([
      "California, 214 matching accounts",
      "Florida, 356 matching accounts",
      "New York, 48 matching accounts",
      "Unknown / Not set, 12 matching accounts",
    ]);
    // …and collapses again on a second click.
    await user.click(dropdown);
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("raises State & Sort above the shared page-focus backdrop", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(
      screen.getByRole("button", {
        name: "Filter by location state and sort accounts",
      }),
    );

    const backdrop = document.querySelector<HTMLElement>(
      "[data-records-filter-backdrop]",
    )!;
    expect(backdrop).toBeTruthy();
    expect(
      document
        .querySelector(".state-sort-select")
        ?.classList.contains("records-filter-control--open"),
    ).toBe(true);

    fireEvent.pointerDown(backdrop);
    expect(
      screen.queryByRole("dialog", { name: "Location state and sort" }),
    ).toBeNull();
  });

  it("summarizes the dropdown field from the current selection", async () => {
    const user = userEvent.setup();
    renderControl({ selectedStates: ["CA", "NY"] });
    await user.click(
      screen.getByRole("button", { name: /Filter by location state/ }),
    );
    expect(
      screen.getByRole("button", { name: /^Location State/ }).textContent,
    ).toContain("2 states");
  });

  it("offers both sort groups as radios with the defaults checked", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(
      screen.getByRole("button", { name: /Filter by location state/ }),
    );
    const dateGroup = screen.getByRole("radiogroup", { name: "Sort · Date" });
    const dateRadios = within(dateGroup).getAllByRole("radio");
    expect(dateRadios).toHaveLength(2);
    expect(
      (within(dateGroup).getByRole("radio", { name: "Oldest first" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    const revenueGroup = screen.getByRole("radiogroup", {
      name: "Sort · Revenue",
    });
    const revenueRadios = within(revenueGroup).getAllByRole("radio");
    expect(revenueRadios).toHaveLength(3);
    expect(
      (within(revenueGroup).getByRole("radio", { name: "None" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("applies a state selection immediately with the page reset", async () => {
    const user = userEvent.setup();
    renderControl();
    await openStates(user);
    await user.click(screen.getByRole("checkbox", { name: /California/ }));
    expect(pushes).toEqual([
      "/pending-orders?source=iq&state=CA",
    ]);
  });

  it("combines one date choice and one revenue choice", async () => {
    const user = userEvent.setup();
    renderControl({
      selectedStates: ["CA"],
      sort: { date: "newest", revenue: "none" },
    });
    await user.click(
      screen.getByRole("button", { name: /Filter by location state/ }),
    );
    // Picking a revenue order keeps the date choice — revenue leads the URL.
    await user.click(screen.getByRole("radio", { name: "High to low" }));
    expect(pushes).toEqual([
      "/pending-orders?source=iq&state=CA&sort=revenue-desc%2Cnewest",
    ]);
  });

  it("keeps the revenue choice when the date direction flips", async () => {
    const user = userEvent.setup();
    renderControl({ sort: { date: "newest", revenue: "revenue-asc" } });
    await user.click(
      screen.getByRole("button", { name: /Filter by location state/ }),
    );
    await user.click(screen.getByRole("radio", { name: "Oldest first" }));
    expect(pushes).toEqual([
      "/pending-orders?source=iq&sort=revenue-asc",
    ]);
  });

  it("searches state options only, matching codes and names", async () => {
    const user = userEvent.setup();
    renderControl();
    await openStates(user);
    const search = screen.getByRole("textbox", {
      name: "Search location states",
    });
    await user.type(search, "fl");
    let boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.getAttribute("aria-label")).toContain("Florida");
    await user.clear(search);
    await user.type(search, "unknown");
    boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.getAttribute("aria-label")).toContain("Unknown / Not set");
    // The sort radios are never filtered away by the state search.
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(pushes).toEqual([]);
  });

  it("pins the selection, marks unavailable states and lets them go", async () => {
    const user = userEvent.setup();
    renderControl({
      selectedStates: ["FL", "NY"],
      unavailableSelected: [{ id: "FL", label: "Florida" }],
      options: OPTIONS.filter((option) => option.id !== "FL"),
    });
    await openStates(user);
    const dialog = screen.getByRole("dialog", {
      name: "Location state and sort",
    });
    expect(within(dialog).getByText("Selected")).toBeTruthy();
    const unavailable = within(dialog).getByRole("checkbox", {
      name: "Florida, unavailable with current filters",
    });
    expect((unavailable as HTMLInputElement).checked).toBe(true);
    expect(within(dialog).getByText("Unavailable")).toBeTruthy();
    await user.click(unavailable);
    expect(pushes).toEqual([
      "/pending-orders?source=iq&state=NY",
    ]);
  });

  it("clears only its own state and sort", async () => {
    const user = userEvent.setup();
    renderControl({
      selectedStates: ["CA", "NY"],
      sort: { date: "newest", revenue: "revenue-desc" },
    });
    await user.click(
      screen.getByRole("button", { name: /Filter by location state/ }),
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    // Source, range and every other filter survive.
    expect(pushes).toEqual(["/pending-orders?source=iq"]);
  });

  it("supports the keyboard path end to end", async () => {
    const user = userEvent.setup();
    renderControl();
    const trigger = screen.getByRole("button", {
      name: "Filter by location state and sort accounts",
    });
    trigger.focus();
    // ArrowDown opens the popover and lands on the state dropdown field.
    await user.keyboard("{ArrowDown}");
    const dropdown = screen.getByRole("button", { name: /^Location State/ });
    expect(document.activeElement).toBe(dropdown);
    // ArrowDown drops the state menu and lands in its search box.
    await user.keyboard("{ArrowDown}");
    const search = screen.getByRole("textbox", {
      name: "Search location states",
    });
    expect(document.activeElement).toBe(search);
    // Arrows traverse from the search into the checkboxes.
    await user.keyboard("{ArrowDown}");
    const boxes = screen.getAllByRole("checkbox");
    expect(document.activeElement).toBe(boxes[0]);
    await user.keyboard("{Enter}");
    expect(pushes).toEqual([
      "/pending-orders?source=iq&state=CA",
    ]);
    // Enter on a focused radio applies that choice too.
    const radio = screen.getByRole("radio", { name: "Newest first" });
    radio.focus();
    await user.keyboard("{Enter}");
    expect(pushes[1]).toBe(
      "/pending-orders?source=iq&state=CA&sort=newest",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("announces the applied result politely", () => {
    renderControl({
      selectedStates: ["CA"],
      sort: { date: "newest", revenue: "revenue-desc" },
      resultTotal: 7,
    });
    expect(
      screen.getByText(
        "7 accounts in 1 selected state, sorted Revenue high · Newest",
      ),
    ).toBeTruthy();
  });
});

// @vitest-environment jsdom
/**
 * The Accounts carrier filter control: trigger wording per selection size,
 * the URL contract (every filter survives, `page` resets, carriers land
 * sorted in `carrier`), popover behavior (option search, pinned Selected
 * group, unavailable selections kept and removable, Clear), and the keyboard
 * path (open, arrows, Enter/Space, Escape with focus restoration).
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
import { RecordsTestProvider } from "./records-filter-test-utils";

const pushes: string[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => {
      pushes.push(href);
    },
  }),
}));

const { CarrierMultiSelect, carrierFilterHref, carrierTriggerText } =
  await import("@/app/all-accounts/CarrierMultiSelect");

const OPTIONS = [
  { key: "coterie insurance", label: "Coterie Insurance", orderCount: 2 },
  { key: "hiscox ins co", label: "Hiscox Ins Co", orderCount: 3 },
  { key: "markel insurance company", label: "Markel Insurance Company", orderCount: 1 },
];

function renderControl(
  props: Partial<Parameters<typeof CarrierMultiSelect>[0]> = {},
) {
  const selected = props.selected ?? [];
  return render(
    <RecordsTestProvider
      params={{ source: "iq", page: "3" }}
      patch={{ carriers: selected }}
    >
      <CarrierMultiSelect
        basePath="/pending-orders"
        currentParams={{ source: "iq", page: "3" }}
        selected={selected}
        options={OPTIONS}
        unavailableSelected={[]}
        resultTotal={42}
        {...props}
      />
    </RecordsTestProvider>,
  );
}

afterEach(() => {
  cleanup();
  pushes.length = 0;
});

describe("carrierFilterHref", () => {
  it("keeps every active filter, resets the page and writes sorted carriers", () => {
    expect(
      carrierFilterHref(
        "/pending-orders",
        { q: "acme", source: "iq", iqStage: "bind_requested", page: "4" },
        ["next insurance us inc", "hiscox ins co"],
      ),
    ).toBe(
      "/pending-orders?source=iq&iqStage=bind_requested&carrier=hiscox+ins+co%2Cnext+insurance+us+inc&q=acme",
    );
  });

  it("drops the carrier param when the selection empties", () => {
    expect(
      carrierFilterHref(
        "/bound-orders",
        { carrier: "hiscox ins co", range: "this-week" },
        [],
      ),
    ).toBe("/bound-orders?range=this-week");
    expect(carrierFilterHref("/all-accounts", {}, [])).toBe("/all-accounts");
  });
});

describe("carrierTriggerText", () => {
  it("scales the wording with the selection size", () => {
    expect(carrierTriggerText([])).toBe("All carriers");
    expect(carrierTriggerText(["Hiscox Ins Co"])).toBe("Hiscox Ins Co");
    expect(carrierTriggerText(["Markel Insurance Company", "Hiscox Ins Co"])).toBe(
      "Hiscox Ins Co +1",
    );
    expect(carrierTriggerText(["A", "B", "C"])).toBe("3 carriers selected");
  });
});

describe("CarrierMultiSelect", () => {
  it("names itself and its selection state on the collapsed trigger", () => {
    renderControl({ selected: ["hiscox ins co"] });
    const trigger = screen.getByRole("button", {
      name: "Filter by carrier: 1 carrier selected",
    });
    expect(trigger.textContent).toContain("Hiscox Ins Co");
    expect(trigger.className).toContain("carrier-trigger--active");
  });

  it("stays visually quiet with no selection", () => {
    renderControl();
    const trigger = screen.getByRole("button", { name: "Filter by carrier" });
    expect(trigger.textContent).toContain("All carriers");
    expect(trigger.className).not.toContain("carrier-trigger--active");
  });

  it("opens a labelled dialog listing options alphabetically with order counts", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(screen.getByRole("button", { name: "Filter by carrier" }));
    const dialog = screen.getByRole("dialog", { name: "Carriers" });
    const boxes = within(dialog).getAllByRole("checkbox");
    expect(boxes.map((box) => box.getAttribute("aria-label"))).toEqual([
      "Coterie Insurance, 2 matching orders",
      "Hiscox Ins Co, 3 matching orders",
      "Markel Insurance Company, 1 matching order",
    ]);
    expect(boxes.every((box) => !(box as HTMLInputElement).checked)).toBe(true);
  });

  it("raises the menu above a dismissible page-focus backdrop", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(screen.getByRole("button", { name: "Filter by carrier" }));

    const backdrop = document.querySelector<HTMLElement>(
      "[data-records-filter-backdrop]",
    )!;
    expect(backdrop).toBeTruthy();
    expect(
      document
        .querySelector(".carrier-filter")
        ?.classList.contains("records-filter-control--open"),
    ).toBe(true);

    fireEvent.pointerDown(backdrop);
    expect(screen.queryByRole("dialog", { name: "Carriers" })).toBeNull();
    expect(document.querySelector("[data-records-filter-backdrop]")).toBeNull();
  });

  it("applies a selection immediately with the page reset", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(screen.getByRole("button", { name: "Filter by carrier" }));
    await user.click(
      screen.getByRole("checkbox", { name: /Hiscox Ins Co/ }),
    );
    expect(pushes).toEqual([
      "/pending-orders?source=iq&carrier=hiscox+ins+co",
    ]);
  });

  it("searches carrier options only, without touching the Accounts query", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(screen.getByRole("button", { name: "Filter by carrier" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search carrier options" }),
      "markel",
    );
    const dialog = screen.getByRole("dialog", { name: "Carriers" });
    const boxes = within(dialog).getAllByRole("checkbox");
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.getAttribute("aria-label")).toBe(
      "Markel Insurance Company, 1 matching order",
    );
    // Option search never navigates — the Accounts query is untouched.
    expect(pushes).toEqual([]);
    expect(screen.getByText("1 carrier shown")).toBeTruthy();
  });

  it("reports when no option matches the search", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(screen.getByRole("button", { name: "Filter by carrier" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search carrier options" }),
      "zzz",
    );
    expect(screen.getByText("No carriers match “zzz”.")).toBeTruthy();
  });

  it("pins the current selection in a Selected group without duplicating it", async () => {
    const user = userEvent.setup();
    renderControl({ selected: ["markel insurance company"] });
    await user.click(
      screen.getByRole("button", {
        name: "Filter by carrier: 1 carrier selected",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Carriers" });
    expect(within(dialog).getByText("Selected")).toBeTruthy();
    const boxes = within(dialog).getAllByRole("checkbox");
    // Markel leads the list as the pinned selection, checked, listed once.
    expect(boxes[0]!.getAttribute("aria-label")).toBe(
      "Markel Insurance Company, 1 matching order",
    );
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect(boxes).toHaveLength(3);
  });

  it("keeps an unavailable selection visible, marked and removable", async () => {
    const user = userEvent.setup();
    renderControl({
      selected: ["next insurance us inc"],
      unavailableSelected: [
        { key: "next insurance us inc", label: "NEXT Insurance US Inc" },
      ],
    });
    await user.click(
      screen.getByRole("button", {
        name: "Filter by carrier: 1 carrier selected",
      }),
    );
    const box = screen.getByRole("checkbox", {
      name: "NEXT Insurance US Inc, unavailable with current filters",
    });
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Unavailable")).toBeTruthy();
    await user.click(box);
    // Removing it drops the carrier param entirely.
    expect(pushes).toEqual(["/pending-orders?source=iq"]);
  });

  it("clears only the carrier selection from the popover", async () => {
    const user = userEvent.setup();
    renderControl({ selected: ["hiscox ins co", "coterie insurance"] });
    await user.click(
      screen.getByRole("button", {
        name: "Filter by carrier: 2 carriers selected",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(pushes).toEqual(["/pending-orders?source=iq"]);
  });

  it("supports the keyboard path end to end", async () => {
    const user = userEvent.setup();
    renderControl();
    const trigger = screen.getByRole("button", { name: "Filter by carrier" });
    trigger.focus();
    // ArrowDown opens and lands in the option search.
    await user.keyboard("{ArrowDown}");
    const search = screen.getByRole("textbox", {
      name: "Search carrier options",
    });
    expect(document.activeElement).toBe(search);
    // Arrows traverse from the search into the checkboxes.
    await user.keyboard("{ArrowDown}");
    const boxes = screen.getAllByRole("checkbox");
    expect(document.activeElement).toBe(boxes[0]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(boxes[1]);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(boxes[0]);
    // Enter selects the focused option.
    await user.keyboard("{Enter}");
    expect(pushes).toEqual([
      "/pending-orders?source=iq&carrier=coterie+insurance",
    ]);
    // Escape dismisses and restores focus to the trigger.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("announces the applied result count politely", () => {
    renderControl({ selected: ["hiscox ins co"], resultTotal: 7 });
    expect(
      screen.getByText("7 accounts match 1 selected carrier"),
    ).toBeTruthy();
  });
});

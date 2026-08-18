// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AccountSearchField } from "@/app/all-accounts/AccountSearchField";
import { AccountFilterToolbar } from "@/app/all-accounts/AccountFilterToolbar";
import {
  RecordsFilterProvider,
  useRecordsFilters,
} from "@/app/all-accounts/RecordsFilterProvider";
import {
  parseRecordsFilterState,
  type RecordsFilterState,
} from "@/app/all-accounts/records-filter-state";

const navigation = vi.hoisted(() => ({
  pushes: [] as string[],
  replaces: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => navigation.pushes.push(href),
    replace: (href: string) => navigation.replaces.push(href),
  }),
}));

function FilterButtons() {
  const { state, update } = useRecordsFilters();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          update(
            { carriers: ["hiscox ins co"] },
            { reason: "filter", trigger: "test-carrier" },
          )
        }
      >
        Carrier
      </button>
      <button
        type="button"
        onClick={() =>
          update(
            { locationStates: ["CA"] },
            { reason: "filter", trigger: "test-state" },
          )
        }
      >
        State
      </button>
      <output data-testid="state">
        {state.carriers.join(",")}|{state.locationStates.join(",")}
      </output>
    </>
  );
}

function App({
  state,
  withSearch = false,
}: {
  state: RecordsFilterState;
  withSearch?: boolean;
}) {
  return (
    <RecordsFilterProvider state={state}>
      {withSearch ? (
        <AccountSearchField
          committedQuery={state.query}
          resultCount={10}
        />
      ) : null}
      <FilterButtons />
    </RecordsFilterProvider>
  );
}

const initial = () =>
  parseRecordsFilterState("pending", {
    source: "iq",
    page: "3",
  });

beforeEach(() => {
  navigation.pushes.length = 0;
  navigation.replaces.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Records transition races", () => {
  it("composes rapid sibling filter changes from the newest requested state", () => {
    render(<App state={initial()} />);

    fireEvent.click(screen.getByRole("button", { name: "Carrier" }));
    fireEvent.click(screen.getByRole("button", { name: "State" }));

    expect(navigation.pushes).toEqual([
      "/pending-orders?source=iq&carrier=hiscox+ins+co",
      "/pending-orders?source=iq&carrier=hiscox+ins+co&state=CA",
    ]);
  });

  it("lets each toolbar control change only the field it owns", () => {
    render(
      <RecordsFilterProvider state={parseRecordsFilterState("pending", {})}>
        <AccountFilterToolbar source="all" range="all-time" />
      </RecordsFilterProvider>,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Broker" }));
    fireEvent.click(screen.getByRole("radio", { name: "Last 30 Days" }));

    expect(navigation.pushes).toEqual([
      "/pending-orders?source=broker",
      "/pending-orders?source=broker&range=last-30-days",
    ]);
  });

  it("composes rapid IQ Stage toggles before either response returns", () => {
    render(
      <RecordsFilterProvider
        state={parseRecordsFilterState("pending", { source: "iq" })}
      >
        <AccountFilterToolbar
          source="iq"
          range="all-time"
          showIqStage
          iqStages={[]}
        />
      </RecordsFilterProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /IQ Stage/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Bind requested" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Awaiting binder" }));

    expect(navigation.pushes).toEqual([
      "/pending-orders?source=iq&iqStage=bind_requested",
      "/pending-orders?source=iq&iqStage=bind_requested%2Cawaiting_binder",
    ]);
  });

  it("merges a pending debounced search into a newer carrier selection", () => {
    vi.useFakeTimers();
    render(<App state={initial()} withSearch />);

    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Search accounts in this view by name or DBA",
      }),
      { target: { value: "acme" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Carrier" }));

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(navigation.pushes).toEqual([
      "/pending-orders?source=iq&carrier=hiscox+ins+co",
    ]);
    expect(navigation.replaces).toEqual([
      "/pending-orders?source=iq&carrier=hiscox+ins+co&q=acme",
    ]);
  });

  it("ignores an older server response and accepts the newest response", () => {
    const { rerender } = render(<App state={initial()} />);
    fireEvent.click(screen.getByRole("button", { name: "Carrier" }));
    fireEvent.click(screen.getByRole("button", { name: "State" }));

    const older = parseRecordsFilterState("pending", {
      source: "iq",
      carrier: "hiscox ins co",
    });
    rerender(<App state={older} />);
    // The carrier-only response belongs to the first request. It never gets
    // to paint over the accepted server snapshot while carrier+state is newer.
    expect(screen.getByTestId("state").textContent).toBe("|");

    const newest = parseRecordsFilterState("pending", {
      source: "iq",
      carrier: "hiscox ins co",
      state: "CA",
    });
    rerender(<App state={newest} />);
    expect(screen.getByTestId("state").textContent).toBe(
      "hiscox ins co|CA",
    );
  });

  it("accepts that same older state when browser Back explicitly requests it", () => {
    const { rerender } = render(<App state={initial()} />);
    fireEvent.click(screen.getByRole("button", { name: "Carrier" }));
    fireEvent.click(screen.getByRole("button", { name: "State" }));

    window.dispatchEvent(new PopStateEvent("popstate"));
    rerender(
      <App
        state={parseRecordsFilterState("pending", {
          source: "iq",
          carrier: "hiscox ins co",
        })}
      />,
    );
    expect(screen.getByTestId("state").textContent).toBe("hiscox ins co|");
  });

  it("does not let an older response erase the live search draft", () => {
    vi.useFakeTimers();
    const { rerender } = render(<App state={initial()} withSearch />);
    const input = screen.getByRole("textbox", {
      name: "Search accounts in this view by name or DBA",
    });
    fireEvent.change(input, { target: { value: "acme" } });

    act(() => {
      vi.advanceTimersByTime(250);
    });
    rerender(
      <App
        state={parseRecordsFilterState("pending", {
          source: "iq",
          carrier: "hiscox ins co",
        })}
        withSearch
      />,
    );

    expect(input).toHaveProperty("value", "acme");
  });

  it("cancels a pending search when the Records surface unmounts", () => {
    vi.useFakeTimers();
    const { unmount } = render(<App state={initial()} withSearch />);
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Search accounts in this view by name or DBA",
      }),
      { target: { value: "acme" } },
    );
    unmount();

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(navigation.replaces).toEqual([]);
  });
});

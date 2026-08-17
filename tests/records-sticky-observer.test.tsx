// @vitest-environment jsdom

import {
  StrictMode,
  useRef,
  type RefObject,
} from "react";
import {
  act,
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountResultsPanel } from "@/app/all-accounts/AccountResultsPanel";
import {
  TOP_NAV_BOTTOM_PROPERTY,
  TOP_NAV_HEIGHT_PROPERTY,
  TOP_NAV_METRICS_EVENT,
  TopNavHeightSync,
} from "@/components/TopNavHeightSync";

type IntersectionCallback = ConstructorParameters<
  typeof IntersectionObserver
>[0];

class IntersectionObserverMock {
  static instances: IntersectionObserverMock[] = [];
  callback: IntersectionCallback;
  options?: IntersectionObserverInit;
  disconnected = false;
  target: Element | null = null;

  constructor(
    callback: IntersectionCallback,
    options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.options = options;
    IntersectionObserverMock.instances.push(this);
  }

  observe(target: Element) {
    this.target = target;
  }

  unobserve() {}
  takeRecords() {
    return [];
  }
  disconnect() {
    this.disconnected = true;
  }
  get root() {
    return this.options?.root ?? null;
  }
  get rootMargin() {
    return this.options?.rootMargin ?? "0px";
  }
  get thresholds() {
    return [0];
  }
}

type ResizeCallback = ConstructorParameters<typeof ResizeObserver>[0];

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  callback: ResizeCallback;
  disconnected = false;
  observed: Element[] = [];

  constructor(callback: ResizeCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}

function activeIntersectionObserver(): IntersectionObserverMock {
  return IntersectionObserverMock.instances.findLast(
    (observer) => !observer.disconnected,
  )!;
}

function panel() {
  return (
    <AccountResultsPanel
      rows={[]}
      emptyMessage="No accounts"
      todayDay="2026-08-17"
      total={0}
      view={{ id: "all", title: "All Accounts" }}
      filterState={{
        source: "all",
        iqStages: [],
        brokerGates: [],
        carriers: [],
        locationStates: [],
        sort: { date: "oldest", revenue: "none" },
        search: "",
      }}
      pagination={{
        currentPage: 1,
        totalPages: 1,
        currentParams: {},
        basePath: "/all-accounts",
      }}
    />
  );
}

beforeEach(() => {
  IntersectionObserverMock.instances = [];
  ResizeObserverMock.instances = [];
  vi.stubGlobal(
    "IntersectionObserver",
    IntersectionObserverMock as unknown as typeof IntersectionObserver,
  );
  vi.stubGlobal(
    "ResizeObserver",
    ResizeObserverMock as unknown as typeof ResizeObserver,
  );
});

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty(TOP_NAV_HEIGHT_PROPERTY);
  document.documentElement.style.removeProperty(TOP_NAV_BOTTOM_PROPERTY);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Records sticky sentinel", () => {
  function cross(top: number, isIntersecting = false) {
    const observer = activeIntersectionObserver();
    act(() => {
      observer.callback(
        [
          {
            target: observer.target,
            isIntersecting,
            boundingClientRect: { top },
          } as unknown as IntersectionObserverEntry,
        ],
        observer as unknown as IntersectionObserver,
      );
    });
  }

  it("does not mark a below-viewport sentinel as pinned", () => {
    render(panel());
    cross(600);
    expect(
      screen
        .getByRole("region", { name: "Records controls and active filters" })
        .getAttribute("data-pinned"),
    ).toBe("false");
  });

  it("activates above the sticky boundary and deactivates below it", () => {
    render(panel());
    cross(-1);
    const header = screen.getByRole("region", {
      name: "Records controls and active filters",
    });
    expect(header.getAttribute("data-pinned")).toBe("true");

    cross(1, true);
    expect(header.getAttribute("data-pinned")).toBe("false");
  });

  it("rebuilds around a nav-height change without duplicate live observers", () => {
    const view = render(
      <StrictMode>{panel()}</StrictMode>,
    );
    expect(
      IntersectionObserverMock.instances.filter(
        (observer) => !observer.disconnected,
      ),
    ).toHaveLength(1);

    act(() => {
      window.dispatchEvent(new CustomEvent(TOP_NAV_METRICS_EVENT));
    });
    expect(
      IntersectionObserverMock.instances.filter(
        (observer) => !observer.disconnected,
      ),
    ).toHaveLength(1);

    view.unmount();
    expect(
      IntersectionObserverMock.instances.filter(
        (observer) => !observer.disconnected,
      ),
    ).toHaveLength(0);
  });
});

function TopNavHarness({
  desktopHeight,
  desktopBottom,
  mobileHeight,
  mobileBottom,
  mobile,
}: {
  desktopHeight: number;
  desktopBottom: number;
  mobileHeight: number;
  mobileBottom: number;
  mobile: boolean;
}) {
  const desktopRef = useRef<HTMLDivElement>(null);
  const mobileRef = useRef<HTMLElement>(null);
  return (
    <>
      <div
        ref={desktopRef}
        data-test-top-nav
        data-height={desktopHeight}
        data-bottom={desktopBottom}
        data-visible={mobile ? "false" : "true"}
      />
      <header
        ref={mobileRef}
        data-test-top-nav
        data-height={mobileHeight}
        data-bottom={mobileBottom}
        data-visible={mobile ? "true" : "false"}
      />
      <TopNavHeightSync
        desktopRef={desktopRef as RefObject<HTMLElement | null>}
        mobileRef={mobileRef}
      />
    </>
  );
}

describe("top-nav height owner", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
      function (this: HTMLElement) {
        return (this.dataset.visible === "true"
          ? ([{}] as unknown as DOMRectList)
          : ([] as unknown as DOMRectList));
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const height = Number(this.dataset.height ?? 0);
        const bottom = Number(this.dataset.bottom ?? 0);
        return { height, bottom } as DOMRect;
      },
    );
  });

  it("publishes fractional desktop and responsive heights", () => {
    const metrics = vi.fn();
    window.addEventListener(TOP_NAV_METRICS_EVENT, metrics);
    const view = render(
      <TopNavHarness
        desktopHeight={46.25}
        desktopBottom={46.75}
        mobileHeight={91.75}
        mobileBottom={104.5}
        mobile={false}
      />,
    );
    expect(
      document.documentElement.style.getPropertyValue(TOP_NAV_HEIGHT_PROPERTY),
    ).toBe("46.25px");
    expect(
      document.documentElement.style.getPropertyValue(TOP_NAV_BOTTOM_PROPERTY),
    ).toBe("46.75px");

    view.rerender(
      <TopNavHarness
        desktopHeight={46.25}
        desktopBottom={46.75}
        mobileHeight={91.75}
        mobileBottom={104.5}
        mobile
      />,
    );
    act(() => {
      ResizeObserverMock.instances
        .findLast((observer) => !observer.disconnected)
        ?.callback([], {} as ResizeObserver);
    });
    expect(
      document.documentElement.style.getPropertyValue(TOP_NAV_HEIGHT_PROPERTY),
    ).toBe("91.75px");
    expect(
      document.documentElement.style.getPropertyValue(TOP_NAV_BOTTOM_PROPERTY),
    ).toBe("104.5px");
    expect(metrics).toHaveBeenCalledTimes(2);
    window.removeEventListener(TOP_NAV_METRICS_EVENT, metrics);
  });
});

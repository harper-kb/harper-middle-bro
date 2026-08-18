// @vitest-environment jsdom

import fs from "fs";
import path from "path";
import {
  StrictMode,
  useEffect,
  useState,
  type ChangeEvent,
} from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  BrandOverlayTrigger,
  IDLE_BRAND_CONTINUOUS_THROTTLE_MS,
  IDLE_BRAND_EXIT_MS,
  IDLE_BRAND_TIMEOUT_MS,
  IdleBrandOverlay,
} from "@/components/IdleBrandOverlay";

let hidden = false;
let originalHidden: PropertyDescriptor | undefined;

async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function setDocumentHidden(value: boolean): void {
  hidden = value;
  fireEvent(document, new Event("visibilitychange"));
}

function dispatchPointerMove(
  clientX: number,
  clientY: number,
  movementX = 0,
  movementY = 0,
): void {
  const event = new MouseEvent("pointermove", {
    bubbles: true,
    clientX,
    clientY,
  });
  Object.defineProperties(event, {
    movementX: { configurable: true, value: movementX },
    movementY: { configurable: true, value: movementY },
  });
  fireEvent(window, event);
}

function AppAndOverlay() {
  return (
    <>
      <main data-test-application>
        <label>
          Search
          <input aria-label="Search accounts" />
        </label>
      </main>
      <IdleBrandOverlay />
    </>
  );
}

function TriggerHarness() {
  return (
    <>
      <div data-test-application>
        <BrandOverlayTrigger brand="harper">
          <span aria-hidden="true">Harper artwork</span>
        </BrandOverlayTrigger>
        <BrandOverlayTrigger brand="step-bro">
          <span aria-hidden="true">Step Bro artwork</span>
        </BrandOverlayTrigger>
      </div>
      <IdleBrandOverlay />
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");
  hidden = false;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
  document.documentElement.classList.remove("idle-brand-overlay-open");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
  document.documentElement.classList.remove("idle-brand-overlay-open");
  if (originalHidden) {
    Object.defineProperty(document, "hidden", originalHidden);
  } else {
    Reflect.deleteProperty(document, "hidden");
  }
});

describe("idle timing and lifecycle", () => {
  it("opens once at one minute and never before", async () => {
    render(<AppAndOverlay />);

    await advance(IDLE_BRAND_TIMEOUT_MS - 1);
    expect(screen.queryByRole("dialog")).toBeNull();

    await advance(1);
    expect(
      screen.getByRole("dialog", { name: "Harper Step Bro" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Built for Service, By Service."),
    ).toBeTruthy();
    expect(screen.queryByText("×")).toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it.each([
    [
      "keyboard",
      (input: HTMLInputElement) =>
        fireEvent.keyDown(input, { key: "a", code: "KeyA" }),
    ],
    [
      "pointer",
      () => fireEvent.pointerDown(window, { clientX: 24, clientY: 16 }),
    ],
    ["touch", () => fireEvent.touchStart(window)],
    ["scroll", () => fireEvent.scroll(window)],
    ["focus", (input: HTMLInputElement) => fireEvent.focusIn(input)],
    [
      "virtual-keyboard input",
      (input: HTMLInputElement) =>
        fireEvent.input(input, { target: { value: "insured" } }),
    ],
  ])("restarts a fresh timer after %s activity", async (_label, activity) => {
    render(<AppAndOverlay />);
    const input = screen.getByRole("textbox", {
      name: "Search accounts",
    }) as HTMLInputElement;

    await advance(20_000);
    activity(input);
    await advance(IDLE_BRAND_TIMEOUT_MS - 1);
    expect(screen.queryByRole("dialog")).toBeNull();

    await advance(1);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("ignores tiny pointer jitter and throttles meaningful movement", async () => {
    render(<AppAndOverlay />);
    dispatchPointerMove(0, 0);

    await advance(20_000);
    dispatchPointerMove(4, 3);
    await advance(IDLE_BRAND_TIMEOUT_MS - 20_000 - 1);
    expect(screen.queryByRole("dialog")).toBeNull();
    await advance(1);
    expect(screen.getByRole("dialog")).toBeTruthy();

    cleanup();
    vi.clearAllTimers();
    render(<AppAndOverlay />);
    dispatchPointerMove(0, 0);
    await advance(20_000);
    dispatchPointerMove(20, 0);
    dispatchPointerMove(60, 0);
    await advance(IDLE_BRAND_CONTINUOUS_THROTTLE_MS - 1);
    dispatchPointerMove(90, 0);
    await advance(1);
    dispatchPointerMove(120, 0);

    await advance(IDLE_BRAND_TIMEOUT_MS - 1);
    expect(screen.queryByRole("dialog")).toBeNull();
    await advance(1);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("pauses while hidden and starts a fresh foreground timer on return", async () => {
    render(<AppAndOverlay />);

    await advance(29_000);
    setDocumentHidden(true);
    await advance(5 * 60_000);
    expect(screen.queryByRole("dialog")).toBeNull();

    setDocumentHidden(false);
    await advance(IDLE_BRAND_TIMEOUT_MS - 1);
    expect(screen.queryByRole("dialog")).toBeNull();
    await advance(1);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("survives route rerenders, stays singular in Strict Mode, and cleans up", async () => {
    function RouteHarness({ route }: { route: string }) {
      return (
        <>
          <p>{route}</p>
          <IdleBrandOverlay />
        </>
      );
    }

    const view = render(
      <StrictMode>
        <RouteHarness route="Accounts" />
      </StrictMode>,
    );
    expect(vi.getTimerCount()).toBe(1);

    await advance(20_000);
    view.rerender(
      <StrictMode>
        <RouteHarness route="Company detail" />
      </StrictMode>,
    );
    await advance(IDLE_BRAND_TIMEOUT_MS - 20_000 - 1);
    expect(screen.queryByRole("dialog")).toBeNull();
    await advance(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    view.unmount();
    expect(screen.queryByRole("dialog")).toBeNull();
    // next/image may retain its own completed image bookkeeping timer; clear
    // that unrelated work before isolating the still-counting idle timer.
    vi.clearAllTimers();

    const second = render(<IdleBrandOverlay />);
    await advance(20_000);
    second.unmount();
    await advance(20_000);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("manual opening and dismissal", () => {
  it("opens from each logo trigger and cannot stack on rapid clicks", async () => {
    render(<TriggerHarness />);
    const harper = document.querySelector<HTMLButtonElement>(
      '[data-brand-overlay-trigger="harper"]',
    )!;
    const stepBro = document.querySelector<HTMLButtonElement>(
      '[data-brand-overlay-trigger="step-bro"]',
    )!;

    expect(
      screen.getAllByRole("button", {
        name: "Open Harper and Step Bro brand screen",
      }),
    ).toHaveLength(2);

    fireEvent.click(harper);
    for (let index = 0; index < 5; index += 1) {
      fireEvent.click(harper);
      fireEvent.click(stepBro);
    }
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await advance(IDLE_BRAND_EXIT_MS);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(stepBro);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("Back closes locally, backdrop does not dismiss, and Escape may dismiss", async () => {
    const historyBack = vi.spyOn(window.history, "back");
    render(<TriggerHarness />);
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-brand-overlay-trigger="harper"]',
    )!;

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    fireEvent.pointerDown(dialog);
    await advance(500);
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog").getAttribute("data-state")).toBe(
      "closing",
    );
    await advance(IDLE_BRAND_EXIT_MS);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(historyBack).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    await advance(IDLE_BRAND_EXIT_MS);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(historyBack).not.toHaveBeenCalled();
  });
});

describe("modal accessibility and state preservation", () => {
  it("traps focus and restores manual and automatic focus targets", async () => {
    render(<TriggerHarness />);
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-brand-overlay-trigger="harper"]',
    )!;
    trigger.focus();
    fireEvent.click(trigger);

    const back = screen.getByRole("button", { name: "Back" });
    expect(document.activeElement).toBe(back);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(back);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(back);

    fireEvent.click(back);
    await advance(IDLE_BRAND_EXIT_MS);
    expect(document.activeElement).toBe(trigger);

    cleanup();
    vi.clearAllTimers();
    render(<AppAndOverlay />);
    const input = screen.getByRole("textbox", { name: "Search accounts" });
    input.focus();
    await advance(IDLE_BRAND_TIMEOUT_MS);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Back" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await advance(IDLE_BRAND_EXIT_MS);
    expect(document.activeElement).toBe(input);

    cleanup();
    vi.clearAllTimers();
    render(<IdleBrandOverlay />);
    await advance(IDLE_BRAND_TIMEOUT_MS);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await advance(IDLE_BRAND_EXIT_MS);
    expect(
      document.activeElement?.hasAttribute(
        "data-idle-brand-focus-fallback",
      ),
    ).toBe(true);
  });

  it("makes every background layer inert and restores scroll and attributes", async () => {
    const view = render(<TriggerHarness />);
    const applicationRoot = view.container;
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-brand-overlay-trigger="harper"]',
    )!;
    fireEvent.click(trigger);

    expect(applicationRoot.hasAttribute("inert")).toBe(true);
    expect(applicationRoot.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");
    expect(
      document.documentElement.classList.contains(
        "idle-brand-overlay-open",
      ),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await advance(IDLE_BRAND_EXIT_MS);
    expect(applicationRoot.hasAttribute("inert")).toBe(false);
    expect(applicationRoot.hasAttribute("aria-hidden")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(
      document.documentElement.classList.contains(
        "idle-brand-overlay-open",
      ),
    ).toBe(false);
  });

  it("preserves filters, expanded content, open layers, and scroll position", async () => {
    function StatefulDesk() {
      const [filter, setFilter] = useState("pending");
      const [expanded] = useState(true);
      const [drawer, setDrawer] = useState(true);
      const [popover] = useState(true);

      useEffect(() => {
        if (!drawer) return;
        const closeDrawer = (event: KeyboardEvent) => {
          if (event.key === "Escape") setDrawer(false);
        };
        document.addEventListener("keydown", closeDrawer);
        return () => document.removeEventListener("keydown", closeDrawer);
      }, [drawer]);

      return (
        <div data-stateful-desk>
          <label>
            Account filter
            <select
              aria-label="Account filter"
              value={filter}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setFilter(event.target.value)
              }
            >
              <option value="pending">Pending</option>
              <option value="bound">Bound</option>
            </select>
          </label>
          {expanded ? <div data-expanded-account>Expanded account</div> : null}
          {drawer ? (
            <div data-test-drawer className="fixed z-[110]">
              Open drawer
            </div>
          ) : null}
          {popover ? (
            <div data-test-popover className="fixed z-[80]">
              Open popover
            </div>
          ) : null}
          <div data-scroll-surface style={{ overflow: "auto", height: 40 }}>
            <div style={{ height: 500 }}>Scrollable account content</div>
          </div>
          <BrandOverlayTrigger brand="harper">
            <span aria-hidden="true">Harper artwork</span>
          </BrandOverlayTrigger>
        </div>
      );
    }

    render(
      <>
        <StatefulDesk />
        <IdleBrandOverlay />
      </>,
    );
    const select = screen.getByRole("combobox", { name: "Account filter" });
    fireEvent.change(select, { target: { value: "bound" } });
    const scrollSurface = document.querySelector<HTMLElement>(
      "[data-scroll-surface]",
    )!;
    scrollSurface.scrollTop = 184;
    const trigger = document.querySelector<HTMLButtonElement>(
      '[data-brand-overlay-trigger="harper"]',
    )!;

    // Match the real drawer convention: it owns an existing body scroll lock.
    document.body.style.overflow = "hidden";
    fireEvent.click(trigger);
    const overlay = screen.getByRole("dialog");
    const drawer = document.querySelector<HTMLElement>("[data-test-drawer]")!;
    expect(overlay.className).toContain("z-[200]");
    expect(drawer.className).toContain("z-[110]");
    expect(drawer.closest("[inert]")).toBeTruthy();

    // The top-most overlay consumes Escape before the underlying drawer.
    fireEvent.keyDown(document, { key: "Escape" });
    await advance(IDLE_BRAND_EXIT_MS);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[data-test-drawer]")).toBeTruthy();
    expect(document.querySelector("[data-test-popover]")).toBeTruthy();
    expect(document.querySelector("[data-expanded-account]")).toBeTruthy();
    expect((select as HTMLSelectElement).value).toBe("bound");
    expect(scrollSurface.scrollTop).toBe(184);
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("removes the decorative overlay immediately when the session ends", () => {
    function SessionHarness({ signedIn }: { signedIn: boolean }) {
      if (!signedIn) return <main>Session expired — sign in</main>;
      return (
        <>
          <BrandOverlayTrigger brand="harper">
            <span aria-hidden="true">Harper artwork</span>
          </BrandOverlayTrigger>
          <IdleBrandOverlay />
        </>
      );
    }

    const view = render(<SessionHarness signedIn />);
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(
        '[data-brand-overlay-trigger="harper"]',
      )!,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();

    view.rerender(<SessionHarness signedIn={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Session expired — sign in")).toBeTruthy();
    expect(view.container.hasAttribute("inert")).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });
});

describe("brand assets and visual contract", () => {
  it("uses the authoritative artwork with one non-repetitive dialog label", async () => {
    render(<IdleBrandOverlay />);
    await advance(IDLE_BRAND_TIMEOUT_MS);
    const dialog = screen.getByRole("dialog", { name: "Harper Step Bro" });
    const harper = dialog.querySelector<HTMLImageElement>("img");
    const stepBro = dialog.querySelector<HTMLElement>(
      ".step-bro-wordmark.idle-brand-step-logo",
    );

    expect(harper?.outerHTML).toContain("harper-wordmark.png");
    expect(harper?.getAttribute("alt")).toBe("");
    expect(stepBro).toBeTruthy();
    expect(stepBro?.getAttribute("role")).toBeNull();
    expect(dialog.textContent).toContain("Built for Service, By Service.");
    expect(dialog.querySelector(".idle-brand-separator")).toBeNull();
  });

  it("wires both existing header marks and covers responsive theme states", () => {
    const nav = fs.readFileSync(
      path.join(process.cwd(), "src/components/Nav.tsx"),
      "utf8",
    );
    const widgets = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/components/AuthenticatedDeskWidgets.tsx",
      ),
      "utf8",
    );
    const component = fs.readFileSync(
      path.join(process.cwd(), "src/components/IdleBrandOverlay.tsx"),
      "utf8",
    );
    const css = fs.readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    expect(nav.match(/BrandOverlayTrigger brand="harper"/g)).toHaveLength(2);
    expect(nav.match(/BrandOverlayTrigger brand="step-bro"/g)).toHaveLength(2);
    expect(nav).toContain('src="/harper-wordmark.png"');
    expect(nav).toContain("step-bro-wordmark");
    expect(widgets).toMatch(
      /<Show when="signed-in">[\s\S]*?<IdleBrandOverlay \/>/,
    );
    expect(component).toContain('src="/harper-wordmark.png"');
    expect(component).toContain(
      "step-bro-wordmark idle-brand-step-logo",
    );
    expect(component).toContain("page-title idle-brand-tagline");
    expect(component).not.toContain("idle-brand-separator");
    expect(component).toContain("min-h-dvh");
    expect(component).toContain("z-[200]");
    expect(css).toContain(':root[data-theme="dark"] .idle-brand-overlay');
    expect(css).toContain("@media (max-width: 35rem)");
    expect(css).toContain("@media (max-height: 34rem)");
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(
      "@media (prefers-reduced-transparency: reduce)",
    );
    expect(css).toContain("@media (prefers-contrast: more)");
    expect(css).toContain("backdrop-filter: blur(4px)");
    expect(css).toContain("var(--background) 74%");
    expect(css).toContain("white-space: nowrap");
    expect(css).toContain("idle-brand-overlay--closing");
  });
});

// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const imageMocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  copyBlob: vi.fn(),
}));

vi.mock("@/lib/daily-stats-snapshot-image", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/daily-stats-snapshot-image")>();
  return {
    ...actual,
    createDailyStatsSnapshotRenderJob: imageMocks.createJob,
    copyPngBlobToClipboard: imageMocks.copyBlob,
  };
});

import {
  DAILY_STATS_SNAPSHOT_OPEN_ATTRIBUTE,
  DailyStatsSnapshotButton,
} from "@/components/daily-stats-snapshot/DailyStatsSnapshotButton";
import {
  IdleBrandOverlay,
  openIdleBrandOverlay,
} from "@/components/IdleBrandOverlay";
import type { ClipboardCopyOutcome } from "@/lib/daily-stats-snapshot-image";
import {
  createDailyOperationsStats,
  type DailyOperationsStats,
  type OperationsStatsResponse,
} from "@/lib/operations-stats";

function response(
  overrides: Partial<OperationsStatsResponse> = {},
): OperationsStatsResponse {
  return {
    selectedBusinessDate: "2026-08-17",
    businessTimezone: "America/Los_Angeles",
    bindSentTimezone: "America/New_York",
    metricsCalculatedAt: "2026-08-17T15:45:01.000Z",
    lastSuccessfulSyncAt: "2026-08-17T15:45:04.000Z",
    availableDates: [
      "2026-08-17",
      "2026-08-16",
      "2026-08-15",
      "2026-08-14",
      "2026-08-13",
      "2026-08-12",
      "2026-08-11",
    ],
    businessWindow: {
      startsAt: "2026-08-17T07:00:00.000Z",
      endsAt: "2026-08-18T07:00:00.000Z",
    },
    bindSentWindow: {
      startsAt: "2026-08-17T04:00:00.000Z",
      endsAt: "2026-08-18T04:00:00.000Z",
    },
    metrics: {
      bindSent: { total: 7, sameDay: 2, backlog: 5 },
      newOrders: 33,
      bound: 23,
      coisSent: 29,
    },
    refresh: {
      lastSuccessfulAt: "2026-08-17T15:45:04.000Z",
      lastAttemptAt: "2026-08-17T15:45:04.000Z",
      lastAttemptStatus: "success",
      lastFullRefreshAt: "2026-08-17T15:30:00.000Z",
    },
    ...overrides,
  };
}

function stats(
  overrides: Partial<OperationsStatsResponse> = {},
): DailyOperationsStats {
  return createDailyOperationsStats(response(overrides));
}

function renderJob(
  blobPromise: Promise<Blob>,
  automatic: ClipboardCopyOutcome = { status: "success" },
) {
  return {
    blobPromise,
    automaticCopyPromise: Promise.resolve(automatic),
    abortController: new AbortController(),
  };
}

let previewBlob: Blob;
let createObjectUrl: ReturnType<typeof vi.fn>;
let revokeObjectUrl: ReturnType<typeof vi.fn>;
let originalCreateObjectUrl: PropertyDescriptor | undefined;
let originalRevokeObjectUrl: PropertyDescriptor | undefined;

beforeEach(() => {
  previewBlob = new Blob(["snapshot-png"], { type: "image/png" });
  imageMocks.createJob.mockReset();
  imageMocks.copyBlob.mockReset();
  imageMocks.createJob.mockImplementation(() =>
    renderJob(Promise.resolve(previewBlob)),
  );
  imageMocks.copyBlob.mockResolvedValue({ status: "success" });

  originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
    URL,
    "createObjectURL",
  );
  originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
    URL,
    "revokeObjectURL",
  );
  createObjectUrl = vi.fn(() => "blob:daily-stats-preview");
  revokeObjectUrl = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectUrl,
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    return window.setTimeout(() => callback(performance.now()), 0);
  });
  document.documentElement.removeAttribute(
    DAILY_STATS_SNAPSHOT_OPEN_ATTRIBUTE,
  );
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute(
    DAILY_STATS_SNAPSHOT_OPEN_ATTRIBUTE,
  );
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  } else {
    Reflect.deleteProperty(URL, "createObjectURL");
  }
  if (originalRevokeObjectUrl) {
    Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  } else {
    Reflect.deleteProperty(URL, "revokeObjectURL");
  }
});

function trigger(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: "Create daily stats snapshot",
  }) as HTMLButtonElement;
}

describe("daily snapshot navigation action", () => {
  it("renders a compact named action with the requested tooltip", () => {
    render(<DailyStatsSnapshotButton stats={stats()} />);
    expect(trigger().title).toBe("Daily snapshot");
    expect(trigger().className).toContain("h-8");
    expect(trigger().textContent).toContain("Snapshot");
  });

  it("is unavailable without a valid shared stats object", () => {
    render(<DailyStatsSnapshotButton stats={null} />);
    expect(trigger().disabled).toBe(true);
    fireEvent.click(trigger());
    expect(imageMocks.createJob).not.toHaveBeenCalled();
  });

  it("opens only one dialog and starts only one render after rapid clicks", () => {
    render(<DailyStatsSnapshotButton stats={stats()} />);
    const button = trigger();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(imageMocks.createJob).toHaveBeenCalledTimes(1);
    expect(
      document.documentElement.hasAttribute(
        DAILY_STATS_SNAPSHOT_OPEN_ATTRIBUTE,
      ),
    ).toBe(true);
  });

  it("keeps the initial render job alive through development StrictMode replay", async () => {
    const strictJob = renderJob(Promise.resolve(previewBlob));
    imageMocks.createJob.mockReturnValueOnce(strictJob);
    render(
      <StrictMode>
        <DailyStatsSnapshotButton stats={stats()} />
      </StrictMode>,
    );
    fireEvent.click(trigger());

    expect(await screen.findByRole("img")).toBeTruthy();
    await Promise.resolve();
    expect(imageMocks.createJob).toHaveBeenCalledTimes(1);
    expect(strictJob.abortController.signal.aborted).toBe(false);
  });

  it("disables while another app modal owns the layer", async () => {
    const existing = document.createElement("div");
    existing.setAttribute("role", "dialog");
    existing.setAttribute("aria-modal", "true");
    document.body.appendChild(existing);
    render(<DailyStatsSnapshotButton stats={stats()} />);

    await waitFor(() => expect(trigger().disabled).toBe(true));
    existing.remove();
    await waitFor(() => expect(trigger().disabled).toBe(false));
  });

  it("does not let the idle brand layer stack over a snapshot dialog", () => {
    render(
      <>
        <DailyStatsSnapshotButton stats={stats()} />
        <IdleBrandOverlay />
      </>,
    );
    fireEvent.click(trigger());
    openIdleBrandOverlay(null);

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      document.querySelector("[data-idle-brand-overlay]"),
    ).toBeNull();
  });

  it("stops global keyboard shortcuts from opening a second modal", () => {
    const shortcut = vi.fn();
    window.addEventListener("keydown", shortcut);
    render(<DailyStatsSnapshotButton stats={stats()} />);
    fireEvent.click(trigger());

    fireEvent.keyDown(
      screen.getByRole("button", { name: "Close daily stats snapshot" }),
      { key: "s", metaKey: true },
    );
    expect(shortcut).not.toHaveBeenCalled();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    window.removeEventListener("keydown", shortcut);
  });
});

describe("frozen snapshot preview and image actions", () => {
  it("does not change an open snapshot when the navbar refreshes", async () => {
    let resolveBlob!: (blob: Blob) => void;
    const pending = new Promise<Blob>((resolve) => {
      resolveBlob = resolve;
    });
    imageMocks.createJob.mockReturnValueOnce(renderJob(pending));
    const view = render(<DailyStatsSnapshotButton stats={stats()} />);
    fireEvent.click(trigger());

    view.rerender(
      <DailyStatsSnapshotButton
        stats={stats({
          metricsCalculatedAt: "2026-08-17T15:47:01.000Z",
          metrics: {
            bindSent: { total: 10, sameDay: 4, backlog: 6 },
            newOrders: 40,
            bound: 28,
            coisSent: 35,
          },
        })}
      />,
    );
    resolveBlob(previewBlob);

    const preview = await screen.findByRole("img", {
      name: /Bind Sent 7, including 2 same-day and 5 backlog/,
    });
    expect(preview.getAttribute("alt")).toContain("New Orders 33");
    expect(preview.getAttribute("alt")).not.toContain("New Orders 40");
    const frozen = imageMocks.createJob.mock.calls[0][0];
    expect(frozen.metrics.newOrders).toBe(33);
  });

  it("previews, copies, and downloads the exact same PNG blob", async () => {
    render(<DailyStatsSnapshotButton stats={stats()} />);
    fireEvent.click(trigger());

    expect(await screen.findByText("Copied to clipboard")).toBeTruthy();
    const preview = screen.getByRole("img");
    const download = screen.getByRole("link", { name: "Download PNG" });
    expect(createObjectUrl).toHaveBeenCalledWith(previewBlob);
    expect(preview.getAttribute("src")).toBe("blob:daily-stats-preview");
    expect(download.getAttribute("href")).toBe("blob:daily-stats-preview");
    expect(download.getAttribute("download")).toMatch(
      /^step-bro-daily-stats-2026-08-17-\d{4}-(?:PT|PDT)\.png$/,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy image" }));
    await waitFor(() =>
      expect(imageMocks.copyBlob).toHaveBeenCalledWith(previewBlob),
    );
  });

  it("recovers from automatic-copy failure with an explicit copy gesture", async () => {
    imageMocks.createJob.mockReturnValueOnce(
      renderJob(Promise.resolve(previewBlob), {
        status: "denied",
        error: new DOMException("blocked", "NotAllowedError"),
      }),
    );
    render(<DailyStatsSnapshotButton stats={stats()} />);
    fireEvent.click(trigger());

    expect(await screen.findByText("Ready to copy")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy image" }));
    expect(await screen.findByText("Copied to clipboard")).toBeTruthy();
    expect(imageMocks.copyBlob).toHaveBeenCalledWith(previewBlob);
  });

  it("keeps download available when image clipboard writing is unsupported", async () => {
    imageMocks.createJob.mockReturnValueOnce(
      renderJob(Promise.resolve(previewBlob), { status: "unsupported" }),
    );
    render(<DailyStatsSnapshotButton stats={stats()} />);
    fireEvent.click(trigger());

    expect(
      await screen.findByText("Image copying isn’t supported here"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy image" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download PNG" })).toBeTruthy();
  });

  it("preserves the frozen model and retries a failed image render", async () => {
    imageMocks.createJob
      .mockReturnValueOnce(
        renderJob(Promise.reject(new Error("logo failed")), {
          status: "failed",
          error: new Error("logo failed"),
        }),
      )
      .mockReturnValueOnce(renderJob(Promise.resolve(previewBlob)));
    render(<DailyStatsSnapshotButton stats={stats()} />);
    fireEvent.click(trigger());

    expect(
      await screen.findByText("Couldn’t generate the snapshot"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry generation" }));

    expect(await screen.findByRole("img")).toBeTruthy();
    expect(imageMocks.createJob).toHaveBeenCalledTimes(2);
    expect(imageMocks.createJob.mock.calls[1][0]).toBe(
      imageMocks.createJob.mock.calls[0][0],
    );
  });
});

describe("daily snapshot dialog accessibility and cleanup", () => {
  it("subdues the full app, traps focus, closes with Escape, and restores focus", async () => {
    const view = render(<DailyStatsSnapshotButton stats={stats()} />);
    const button = trigger();
    button.focus();
    fireEvent.click(button);

    const dialog = screen.getByRole("dialog", {
      name: "Daily stats snapshot",
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(view.container.getAttribute("inert")).toBe("");
    expect(view.container.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");
    expect(
      document.querySelector("[data-daily-stats-snapshot-backdrop]")?.className,
    ).toContain("daily-stats-snapshot-backdrop");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close daily stats snapshot" }),
    );

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(view.container.hasAttribute("inert")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("revokes the preview URL and clears the modal lock on close", async () => {
    render(<DailyStatsSnapshotButton stats={stats()} />);
    fireEvent.click(trigger());
    await screen.findByRole("img");

    fireEvent.click(
      screen.getByRole("button", { name: "Close daily stats snapshot" }),
    );
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:daily-stats-preview");
    expect(
      document.documentElement.hasAttribute(
        DAILY_STATS_SNAPSHOT_OPEN_ATTRIBUTE,
      ),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FullNoteThreadEntries,
  mergeRequestedThreads,
  NoteThreadCardGrid,
  OrderNoteThreads,
  provisionalProducerThread,
  provisionalServiceThread,
  resolveNoteThreadCardState,
  selectVisibleThreadState,
  summaryTargets,
  type NoteThreadCardState,
  type SummaryState,
} from "@/app/all-accounts/OrderNoteThreads";
import type {
  NoteThread,
  NoteThreadEntry,
  NoteThreadsResponse,
  NoteThreadType,
} from "@/lib/note-thread-types";

function entry(type: NoteThreadType, id: string): NoteThreadEntry {
  return {
    id,
    body: `${type} note body`,
    author: "Harper operator",
    createdAt: "2026-08-16T20:00:00.000Z",
    updatedAt: null,
    edited: false,
    orderId: 7535,
    orderLabel: "Order #7535",
  };
}

function thread(type: NoteThreadType, count: number): NoteThread {
  return {
    type,
    scope: type === "producer" ? "order" : "account",
    entries: Array.from({ length: count }, (_, index) =>
      entry(type, `${type}-${index + 1}`),
    ),
    version: `${type}-version-${count}`,
    latestAt: count > 0 ? "2026-08-16T20:00:00.000Z" : null,
  };
}

function response(producerCount: number, serviceCount: number): NoteThreadsResponse {
  return {
    accountId: 906441,
    orderId: 7535,
    producer: thread("producer", producerCount),
    service: thread("service", serviceCount),
  };
}

const readySummary: SummaryState = {
  status: "ready",
  text: "The note summary.",
  generatedAt: "2026-08-16T20:01:00.000Z",
  version: "summary-version",
  method: "ai",
};

function single(type: NoteThreadType): NoteThreadCardState {
  const value = thread(type, 1);
  value.entries[0] = {
    ...value.entries[0]!,
    body: "Original first line\nOriginal second line",
    author: "Garrett Gargan",
  };
  return {
    kind: "single",
    visibleCount: 1,
    note: value.entries[0]!,
    thread: value,
  };
}

function multiple(type: NoteThreadType): NoteThreadCardState {
  const value = thread(type, 2);
  value.entries[0] = { ...value.entries[0]!, author: "Garrett Gargan" };
  value.entries[1] = { ...value.entries[1]!, author: "Ether Hammemi" };
  return {
    kind: "multiple",
    visibleCount: 2,
    notes: value.entries,
    thread: value,
    summaryState: readySummary,
  };
}

function empty(type: NoteThreadType, canAdd: boolean): NoteThreadCardState {
  return {
    kind: "empty",
    visibleCount: 0,
    canAdd,
    thread: thread(type, 0),
  };
}

function renderGrid(
  producer: NoteThreadCardState,
  service: NoteThreadCardState,
) {
  return renderToStaticMarkup(
    <NoteThreadCardGrid
      states={{ producer, service }}
      orderId={7535}
      onOpen={() => {}}
      onRetry={() => {}}
    />,
  );
}

describe("OrderNoteThreads", () => {
  it("renders separate accessible loading regions without exposing note content", () => {
    const html = renderToStaticMarkup(
      <OrderNoteThreads
        accountId="co-906441"
        accountName="ReliableRide Transportation LLC"
        orderId={7535}
        orderLabel="Order #7535"
        canEditProducer={false}
        producerEditHref="https://bigbrother.harperinsure.com/company/906441/transaction?tab=orders"
      />,
    );

    expect(html).toContain("Producer Notes");
    expect(html).toContain("Service Notes");
    expect(html.match(/aria-busy="true"/g)).toHaveLength(2);
    expect(html.match(/Loading visible notes/g)).toHaveLength(4);
    expect(html).not.toContain("ReliableRide Transportation LLC");
    expect(html).not.toContain("View full thread");
  });

  it("renders two materially compact cards when both visible threads are empty", () => {
    const html = renderGrid(empty("producer", true), empty("service", true));

    expect(html.match(/note-thread-card--empty/g)).toHaveLength(2);
    // Both empty cards share one min-height, so the card without an add
    // button (no permission) matches its neighbor with one.
    expect(html.match(/min-h-\[3\.375rem\]/g)).toHaveLength(2);
    expect(html).toContain("note-identity--producer");
    expect(html).toContain("note-identity--service");
    expect(html.match(/No notes yet/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Add producer note"');
    expect(html).toContain('aria-label="Add service note"');
    expect(html).toContain("min-h-0");
    expect(html).not.toContain("min-h-[10.5rem]");
    expect(html).not.toContain("AI Summary");
    expect(html).not.toContain("View full thread");
    expect(html).not.toContain("0 notes");
  });

  it("does not show Add actions when the viewer lacks permission", () => {
    const html = renderGrid(empty("producer", false), empty("service", false));

    expect(html.match(/No notes yet/g)).toHaveLength(2);
    expect(html).not.toContain("Add producer note");
    expect(html).not.toContain("Add service note");
    expect(html).not.toContain("disabled");
  });

  it("renders one visible note verbatim with prominent author and no summary", () => {
    const html = renderGrid(single("producer"), single("service"));

    expect(html.match(/Original first line/g)).toHaveLength(2);
    expect(html).toContain("note-identity--producer");
    expect(html).toContain("note-identity--service");
    expect(html.match(/Original second line/g)).toHaveLength(2);
    expect(html.match(/Garrett Gargan/g)).toHaveLength(2);
    expect(html.match(/>Note</g)).toHaveLength(2);
    expect(html).not.toContain("AI Summary");
    expect(html).not.toContain("Generating AI summary");
    expect(html.match(/View full thread/g)).toHaveLength(2);
    expect(html.match(/1 note/g)).toHaveLength(2);
    expect(html).not.toContain("No notes yet");
  });

  it("shows an honest author fallback instead of dropping attribution", () => {
    const producer = single("producer");
    if (producer.kind !== "single") throw new Error("expected single state");
    producer.note.author = " ";
    const html = renderGrid(producer, empty("service", false));

    expect(html).toContain("Unknown author");
    expect(html).toContain("note-thread-author");
  });

  it("renders AI summaries only for multiple visible notes with attribution context", () => {
    const html = renderGrid(multiple("producer"), multiple("service"));

    expect(html.match(/AI Summary/g)).toHaveLength(2);
    expect(html.match(/The note summary\./g)).toHaveLength(2);
    expect(html.match(/Garrett Gargan/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html.match(/Participants:/g)).toHaveLength(2);
    expect(html.match(/Ether Hammemi/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/2 notes/g)).toHaveLength(2);
  });

  it("keeps authors and original-thread access when a multi-note summary fails", () => {
    const service = multiple("service");
    if (service.kind !== "multiple") throw new Error("expected multiple state");
    service.summaryState = {
      status: "unavailable",
      version: service.thread.version,
    };
    const html = renderGrid(empty("producer", false), service);

    expect(html).toContain("AI summary unavailable");
    expect(html).toContain("Garrett Gargan");
    expect(html).toContain("Participants:");
    expect(html).toContain('aria-label="View full Service Notes thread"');
  });

  it("marks only the newly populated thread for the promotion transition", () => {
    const html = renderToStaticMarkup(
      <NoteThreadCardGrid
        states={{
          producer: single("producer"),
          service: multiple("service"),
        }}
        orderId={7535}
        promotedType="service"
        onOpen={() => {}}
        onRetry={() => {}}
      />,
    );

    expect(html.match(/note-thread-card--promoted/g)).toHaveLength(1);
  });

  it("does not stretch a compact Service card beside a populated Producer card", () => {
    const html = renderGrid(single("producer"), empty("service", true));

    expect(html).toContain("grid items-start");
    expect(html.match(/note-thread-card--empty/g)).toHaveLength(1);
    expect(html.match(/note-thread-card--full/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Add service note"');
    expect(html).toContain(
      'aria-label="View full Producer Notes thread"',
    );
    expect(html).not.toContain(
      'aria-label="View full Service Notes thread"',
    );
  });

  it("does not stretch a compact Producer card beside a populated Service card", () => {
    const html = renderGrid(empty("producer", true), multiple("service"));

    expect(html).toContain("grid items-start");
    expect(html.match(/note-thread-card--empty/g)).toHaveLength(1);
    expect(html.match(/note-thread-card--full/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Add producer note"');
    expect(html).toContain(
      'aria-label="View full Service Notes thread"',
    );
    expect(html).not.toContain(
      'aria-label="View full Producer Notes thread"',
    );
  });

  it("seeds the Producer card from the snapshot instead of a loading skeleton", () => {
    const html = renderToStaticMarkup(
      <OrderNoteThreads
        accountId="co-906441"
        accountName="ReliableRide Transportation LLC"
        orderId={13040}
        orderLabel="Order #13040"
        canEditProducer={false}
        producerEditHref="https://bigbrother.harperinsure.com/company/906441/transaction?tab=orders"
        producerNotePreview={{ body: null, updatedAt: null, authorName: null }}
      />,
    );

    // Producer renders its known-empty state immediately; only the
    // account-scoped Service thread still needs the round-trip.
    expect(html).toContain("No notes yet");
    expect(html.match(/aria-busy="true"/g)).toHaveLength(1);
  });

  it("renders both cards instantly when the account is verified note-free", () => {
    const html = renderToStaticMarkup(
      <OrderNoteThreads
        accountId="co-906441"
        accountName="ReliableRide Transportation LLC"
        orderId={13040}
        orderLabel="Order #13040"
        canEditProducer={false}
        producerEditHref="https://bigbrother.harperinsure.com/company/906441/transaction?tab=orders"
        producerNotePreview={{ body: null, updatedAt: null, authorName: null }}
        accountServiceNotesEmpty
      />,
    );

    // No skeleton at all: both threads render their known-empty state while
    // the live fetch confirms in the background.
    expect(html.match(/No notes yet/g)).toHaveLength(2);
    expect(html).not.toContain('aria-busy="true"');
    expect(html).not.toContain("Loading visible notes");
  });

  it("seeds the Service card only from a verified account-level empty", () => {
    const seeded = provisionalServiceThread(906441, true);
    expect(seeded).toMatchObject({
      type: "service",
      scope: "account",
      entries: [],
      latestAt: null,
    });
    // Unknown means unknown: no seed, the card keeps its loading state.
    expect(provisionalServiceThread(906441, undefined)).toBeNull();
    expect(provisionalServiceThread(906441, false)).toBeNull();
  });

  it("builds an exact provisional Producer thread from the snapshot note", () => {
    const seeded = provisionalProducerThread(13040, {
      body: "Renewal – prioritize the binder request.",
      updatedAt: "2026-08-15T04:00:49.170Z",
      authorName: "Trace Dela Peña",
    });
    expect(seeded?.entries).toHaveLength(1);
    expect(seeded?.entries[0]).toMatchObject({
      body: "Renewal – prioritize the binder request.",
      author: "Trace Dela Peña",
      orderId: 13040,
      orderLabel: "Order #13040",
    });
    expect(seeded?.latestAt).toBe("2026-08-15T04:00:49.170Z");

    const emptySeed = provisionalProducerThread(13040, {
      body: "  ",
      updatedAt: null,
      authorName: null,
    });
    expect(emptySeed?.entries).toHaveLength(0);

    expect(provisionalProducerThread(13040, undefined)).toBeNull();
    expect(provisionalProducerThread(13040, null)).toBeNull();
  });

  it("keeps showing a thread on hand through a failed refresh instead of an error card", () => {
    const value = thread("producer", 1);
    const state = resolveNoteThreadCardState({
      thread: value,
      summary: { status: "idle" },
      loading: false,
      error: "Note threads are temporarily unavailable.",
      canAdd: false,
    });
    expect(state.kind).toBe("single");

    const nothing = resolveNoteThreadCardState({
      thread: null,
      summary: { status: "idle" },
      loading: false,
      error: "Note threads are temporarily unavailable.",
      canAdd: false,
    });
    expect(nothing.kind).toBe("error");
  });

  it("derives empty state only from authorized visible entries", () => {
    const state = resolveNoteThreadCardState({
      thread: thread("service", 0),
      summary: { status: "idle" },
      loading: false,
      error: null,
      canAdd: false,
    });

    expect(state).toEqual({
      kind: "empty",
      visibleCount: 0,
      canAdd: false,
      thread: thread("service", 0),
    });
  });

  it("selects empty, single and multiple states from authorized visible entries", () => {
    expect(selectVisibleThreadState(thread("service", 0)).kind).toBe("empty");
    expect(selectVisibleThreadState(thread("service", 1)).kind).toBe("single");
    expect(selectVisibleThreadState(thread("service", 2)).kind).toBe(
      "multiple",
    );
  });

  it("never targets zero or one visible note for AI summary generation", () => {
    expect(summaryTargets(response(0, 0), ["producer", "service"])).toEqual([]);
    expect(summaryTargets(response(1, 1), ["producer", "service"])).toEqual([]);
    expect(summaryTargets(response(1, 2), ["producer", "service"])).toEqual([
      "service",
    ]);
  });

  it("merges a Service-only refresh without changing Producer state", () => {
    const current = response(1, 0);
    const incoming = response(0, 1);
    const merged = mergeRequestedThreads(current, incoming, ["service"]);

    expect(merged.producer).toBe(current.producer);
    expect(merged.service).toBe(incoming.service);
  });

  it("renders recoverable loading and error states without fake thread controls", () => {
    const html = renderGrid(
      { kind: "loading" },
      { kind: "error", recoverable: true, message: "Notes unavailable" },
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Notes unavailable");
    expect(html).toContain(">Retry<");
    expect(html).not.toContain("View full thread");
  });

  it("keeps every original note, author, and exact-time access in the full thread", () => {
    const value = thread("service", 2);
    value.entries[0] = {
      ...value.entries[0]!,
      body: "Newest original body",
      author: "Garrett Gargan",
      edited: true,
    };
    value.entries[1] = {
      ...value.entries[1]!,
      body: "Earlier original body",
      author: "Ether Hammemi",
    };
    const html = renderToStaticMarkup(
      <FullNoteThreadEntries thread={value} type="service" />,
    );

    expect(html).toContain("Newest original body");
    expect(html).toContain("Earlier original body");
    expect(html).toContain("Garrett Gargan");
    expect(html).toContain("Ether Hammemi");
    expect(html).toContain("Edited");
    expect(html.match(/dateTime=/g)).toHaveLength(2);
    expect(html.match(/title=/g)).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";
import {
  subscribeToSharedInFlight,
  type SharedInFlight,
} from "@/lib/shared-inflight.server";

function entry<T>(
  promise: Promise<T>,
  controller = new AbortController(),
): SharedInFlight<T> {
  return {
    promise,
    controller,
    subscribers: 0,
    keepAlive: false,
  };
}

describe("shared in-flight cancellation", () => {
  it("does not let one caller abort work another caller still needs", async () => {
    let resolve!: (value: string) => void;
    const shared = entry(
      new Promise<string>((done) => {
        resolve = done;
      }),
    );
    const first = new AbortController();
    const second = new AbortController();
    const firstResult = subscribeToSharedInFlight(shared, first.signal);
    const secondResult = subscribeToSharedInFlight(shared, second.signal);

    first.abort(new DOMException("left", "AbortError"));
    await expect(firstResult).rejects.toMatchObject({ name: "AbortError" });
    expect(shared.controller.signal.aborted).toBe(false);

    resolve("ready");
    await expect(secondResult).resolves.toBe("ready");
  });

  it("aborts underlying work when its final caller leaves", async () => {
    const shared = entry(new Promise<string>(() => {}));
    const caller = new AbortController();
    const result = subscribeToSharedInFlight(shared, caller.signal);

    caller.abort(new DOMException("left", "AbortError"));
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(shared.controller.signal.aborted).toBe(true);
  });

  it("aborts ownerless work for an already-aborted first caller", async () => {
    const shared = entry(new Promise<string>(() => {}));
    const caller = new AbortController();
    caller.abort(new DOMException("already left", "AbortError"));

    await expect(
      subscribeToSharedInFlight(shared, caller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(shared.controller.signal.aborted).toBe(true);
  });
});

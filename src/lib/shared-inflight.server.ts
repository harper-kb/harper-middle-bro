import "server-only";

export interface SharedInFlight<T> {
  promise: Promise<T>;
  controller: AbortController;
  subscribers: number;
  keepAlive: boolean;
}

/**
 * Give each HTTP request its own cancellation boundary while retaining one
 * underlying query. The query is aborted only when every cancellable caller
 * has left and no background/non-cancellable owner still needs it.
 */
export function subscribeToSharedInFlight<T>(
  entry: SharedInFlight<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) {
    entry.keepAlive = true;
    return entry.promise;
  }
  if (signal.aborted) {
    const reason =
      signal.reason ?? new DOMException("Request aborted.", "AbortError");
    if (
      entry.subscribers === 0 &&
      !entry.keepAlive &&
      !entry.controller.signal.aborted
    ) {
      entry.controller.abort(reason);
    }
    return Promise.reject(
      reason,
    );
  }

  entry.subscribers += 1;
  return new Promise<T>((resolve, reject) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signal.removeEventListener("abort", onAbort);
      entry.subscribers -= 1;
    };
    const onAbort = () => {
      release();
      reject(
        signal.reason ?? new DOMException("Request aborted.", "AbortError"),
      );
      if (
        entry.subscribers === 0 &&
        !entry.keepAlive &&
        !entry.controller.signal.aborted
      ) {
        entry.controller.abort(
          signal.reason ?? new DOMException("Request aborted.", "AbortError"),
        );
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      (value) => {
        release();
        resolve(value);
      },
      (error: unknown) => {
        release();
        reject(error);
      },
    );
  });
}

/**
 * Resolve after `ms` milliseconds. Identical to the inline
 * `new Promise(resolve => setTimeout(resolve, ms))` that used to live
 * in cli/auth-flow, cli/commands/login, and api/routers/project/resource-logs.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Thrown by {@link withTimeout} so callers can distinguish "took too long"
 *  from the operation's own failures. */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Reject with {@link TimeoutError} if `promise` hasn't settled within `ms`.
 *
 * The underlying operation keeps running — this only stops the caller from
 * waiting on it. That is the point: a promise that NEVER settles (the
 * projects-page outage of od-664 was exactly that — an in-process await that
 * sat forever with no I/O) otherwise wedges every caller with no error, no
 * log line, and no timeout at any other layer.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

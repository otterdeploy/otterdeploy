/**
 * Resolve after `ms` milliseconds. Identical to the inline
 * `new Promise(resolve => setTimeout(resolve, ms))` that used to live
 * in cli/auth-flow, cli/commands/login, and api/routers/project/resource-logs.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Preserve real errors and wrap non-Error rejection reasons without losing
 *  the original value. */
export function errorFromUnknown(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  if (typeof cause === "string") return new Error(cause);
  return new Error("Unexpected non-Error rejection", { cause });
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
 * The underlying operation keeps running. This only stops the caller from
 * waiting on it. That is the point: a promise that NEVER settles (the
 * projects-page outage of od-664 was exactly that. An in-process await that
 * sat forever with no I/O) otherwise wedges every caller with no error, no
 * log line, and no timeout at any other layer.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "operation",
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new TimeoutError(label, ms));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(errorFromUnknown(error));
      },
    );
  });
}

/**
 * Run `tasks` with at most `limit` in flight, preserving result order.
 *
 * Thunks rather than `(item, i) => …` on purpose: indexing a `readonly T[]`
 * inside the worker gives `T | undefined` under `noUncheckedIndexedAccess`,
 * and the only ways to spend that are a non-null assertion (a type assertion,
 * which this repo bans) or a guard that lies about `T` when `T` itself
 * includes undefined. A thunk array narrows honestly.
 *
 * Rejections propagate: a caller that wants "all of them, failures reported"
 * catches inside its own thunk, which is what the stack rollout does.
 */
export async function mapLimit<R>(
  tasks: ReadonlyArray<() => Promise<R>>,
  limit: number,
): Promise<R[]> {
  const out: R[] = new Array<R>(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const task = tasks[i];
      if (!task) return;
      out[i] = await task();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker));
  return out;
}

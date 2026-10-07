/**
 * A deadline on every Postgres statement a request awaits.
 *
 * With Postgres blackholed (packets dropped, no RST: a dead network path or a
 * frozen host) a statement already written to a pooled connection waits for an
 * answer that never comes. The pool's connect timeout only covers NEW
 * connections, the server-side statement_timeout cannot fire on a server that
 * is unreachable, and Bun's idle timeout is no bound either: on a pool that
 * keeps receiving queries it never fired in a 40 s local blackhole. API calls
 * were held 32 to 36 s and released together, and the release was only the
 * next connection event.
 *
 * Inside {@link runWithQueryDeadline} (the oRPC procedure middleware opens one
 * per request) a statement that has not answered within the deadline rejects
 * with {@link QueryDeadlineError}; the request fails promptly with a typed
 * error instead of holding its caller. The statement itself is abandoned, not
 * cancelled: under a blackhole a cancel request cannot get through either, and
 * the pool reclaims the connection when it errors or answers. Outside a scope
 * (background jobs, migrations, analytics rollups) nothing changes: their long
 * statements stay bounded by statement_timeout alone.
 */
import { TimeoutError, withTimeout } from "@otterdeploy/shared/promise";
import { TaggedError } from "better-result";
import { AsyncLocalStorage } from "node:async_hooks";

/** How long a request waits for one statement. A control-plane statement in a
 *  request answers in milliseconds; one that takes this long means Postgres is
 *  not answering, and the caller is better served by an error it can retry. */
export const REQUEST_QUERY_TIMEOUT_MS = 10_000;

/** A statement a request awaited did not answer within its deadline. */
export class QueryDeadlineError extends TaggedError("QueryDeadlineError")<{
  timeoutMs: number;
  message: string;
}>() {
  constructor(timeoutMs: number) {
    super({ timeoutMs, message: `Postgres did not answer within ${timeoutMs / 1000}s.` });
  }
}

const scope = new AsyncLocalStorage<{ timeoutMs: number }>();

/** Run `fn` with every statement it awaits bounded by `timeoutMs`. */
export function runWithQueryDeadline<T>(timeoutMs: number, fn: () => T): T {
  return scope.run({ timeoutMs }, fn);
}

type Settle = (value: unknown) => unknown;

function invoke(fn: unknown, self: unknown, args: readonly unknown[]): unknown {
  if (typeof fn !== "function") return undefined;
  const result: unknown = Reflect.apply(fn, self, args);
  return result;
}

function isWrappable(value: unknown): value is object {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

/** `then` for a statement: unchanged outside a scope, raced inside one. */
function deadlineThen(target: object, then: unknown) {
  return (onFulfilled?: Settle, onRejected?: Settle): unknown => {
    const active = scope.getStore();
    if (!active) return invoke(then, target, [onFulfilled, onRejected]);
    const settled = new Promise<unknown>((resolve, reject) => {
      invoke(then, target, [resolve, reject]);
    });
    return withTimeout(settled, active.timeoutMs, "query").then(onFulfilled, (error: unknown) => {
      const cause =
        error instanceof TimeoutError ? new QueryDeadlineError(active.timeoutMs) : error;
      if (onRejected) return onRejected(cause);
      throw cause;
    });
  };
}

/** A Bun SQL query (a lazy thenable) whose `then`, `catch` and `finally` obey
 *  the active deadline; `values()` / `raw()` return the same kind of query. */
function deadlineQuery<Q extends object>(query: Q): Q {
  const handler: ProxyHandler<Q> = {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (prop === "then") return deadlineThen(target, value);
      if (prop === "catch") {
        const then = deadlineThen(target, Reflect.get(target, "then", target));
        return (onRejected?: Settle) => then(undefined, onRejected);
      }
      if (prop === "finally") {
        const then = deadlineThen(target, Reflect.get(target, "then", target));
        return (onFinally?: () => void) =>
          then(
            (result) => {
              onFinally?.();
              return result;
            },
            (error) => {
              onFinally?.();
              throw error;
            },
          );
      }
      if (prop === "values" || prop === "raw") {
        return (...args: unknown[]) => {
          const next = invoke(value, target, args);
          return isWrappable(next) ? new Proxy(next, handler) : next;
        };
      }
      return (...args: unknown[]) => invoke(value, target, args);
    },
  };
  return new Proxy(query, handler);
}

/**
 * `client` (a Bun SQL pool, or a transaction client) with every statement it
 * issues bounded by the active request deadline: tagged-template calls,
 * `unsafe`, and each statement inside a `begin`/`savepoint` transaction. The
 * transaction as a whole is not bounded here (a legitimately long one must not
 * be cut short); the procedure deadline still covers it.
 */
export function withQueryDeadlines<C extends object>(client: C): C {
  return new Proxy(client, {
    apply(target, self, args: unknown[]) {
      const query = invoke(target, self, args);
      return isWrappable(query) ? deadlineQuery(query) : query;
    },
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (prop === "unsafe") {
        return (...args: unknown[]) => {
          const query = invoke(value, target, args);
          return isWrappable(query) ? deadlineQuery(query) : query;
        };
      }
      if (prop === "begin" || prop === "savepoint") {
        return (...args: unknown[]) => {
          const wrapped = args.map((arg) =>
            typeof arg === "function"
              ? (tx: unknown) =>
                  invoke(arg, undefined, [isWrappable(tx) ? withQueryDeadlines(tx) : tx])
              : arg,
          );
          return invoke(value, target, wrapped);
        };
      }
      return (...args: unknown[]) => invoke(value, target, args);
    },
  });
}

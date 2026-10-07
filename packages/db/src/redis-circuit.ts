/**
 * The one guard every cache-only Redis call goes through: a per-operation
 * deadline plus a circuit breaker.
 *
 * The deadline alone is not enough. With Redis blackholed (packets dropped, no
 * RST: a dead network path or a frozen host) every command waits out its full
 * timeout, and one request issues several: the query cache's GET, then on the
 * miss a SET and an index update per table, for every select, plus the
 * response cache's own GET and SET. A plain `service.get` took 12.2 s under a
 * Redis blackhole, every time, with the 2 s timeout working exactly as
 * written.
 *
 * So the first failure opens the circuit: for {@link REDIS_CIRCUIT_OPEN_MS}
 * every guarded call is skipped at once (a cache miss, a skipped put) and the
 * request goes straight to Postgres. After that one call is let through again;
 * if Redis answers, the cache is back. A Redis outage costs a request at most
 * one deadline, not one per command.
 *
 * Only for caches, where skipping Redis is always correct (Postgres is the
 * source of truth). Invalidation passes `force`: it is attempted even while
 * the circuit is open, because skipping a DEL can serve a stale read after
 * Redis returns.
 */
import { withTimeout } from "@otterdeploy/shared/promise";
import { Result, TaggedError } from "better-result";

/** Hard ceiling on one guarded Redis call. A cache that answers slower than
 *  this is worse than no cache: degrade to a miss and let Postgres answer. A
 *  command in flight when the connection wedges can otherwise leave a promise
 *  that never settles. */
export const REDIS_OP_TIMEOUT_MS = 2_000;

/** How long guarded calls skip Redis after one fails or times out. */
export const REDIS_CIRCUIT_OPEN_MS = 10_000;

/** Returned instead of calling Redis while the circuit is open. */
export class RedisCircuitOpenError extends TaggedError("RedisCircuitOpenError")<{
  message: string;
}>() {
  constructor(label: string) {
    super({ message: `${label} skipped: Redis failed recently` });
  }
}

interface RedisCircuitOptions {
  timeoutMs?: number;
  openMs?: number;
  /** Monotonic milliseconds. */
  now?: () => number;
}

export class RedisCircuit {
  private readonly timeoutMs: number;
  private readonly openMs: number;
  private readonly now: () => number;
  private openUntil = Number.NEGATIVE_INFINITY;

  constructor(options: RedisCircuitOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? REDIS_OP_TIMEOUT_MS;
    this.openMs = options.openMs ?? REDIS_CIRCUIT_OPEN_MS;
    this.now = options.now ?? (() => performance.now());
  }

  get isOpen(): boolean {
    return this.now() < this.openUntil;
  }

  /** Run `op` under the deadline; any failure opens the circuit. While it is
   *  open, `op` is not called (unless `force`). */
  async run<T>(
    label: string,
    op: () => Promise<T>,
    options: { force?: boolean } = {},
  ): Promise<Result<T, Error>> {
    if (this.isOpen && options.force !== true) {
      return Result.err(new RedisCircuitOpenError(label));
    }
    const result = await Result.tryPromise({
      try: () => withTimeout(op(), this.timeoutMs, label),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    if (result.isErr()) this.openUntil = this.now() + this.openMs;
    else this.openUntil = Number.NEGATIVE_INFINITY;
    return result;
  }
}

/** Shared by the Drizzle query cache and the API response cache: both talk to
 *  the same Redis, so one detected outage spares both. */
export const cacheRedisCircuit = new RedisCircuit();

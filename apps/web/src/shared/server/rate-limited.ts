/**
 * Telling "slow down" apart from "something broke".
 *
 * A 429 is the server answering, deliberately, that this client asked too
 * often; it says nothing about the session or the page. It used to surface as
 * the full-screen "500 Internal error / STATUS: FAULT" screen, which told an
 * operator the product had failed when it had only asked them to wait. The
 * auth reads now throw a typed `RateLimitedError` carrying the server's retry
 * hint, and the error boundary renders a calm, self-retrying notice for it.
 */
import { ORPCError } from "@orpc/client";

/** When the server gives no usable hint: long enough to clear most windows'
 *  tail, short enough that nobody waits on a stale guess. */
export const DEFAULT_RETRY_AFTER_SECONDS = 10;

/** Upper bound on any wait we show: a hint beyond this is not worth a
 *  countdown, the operator can retry by hand. */
export const MAX_RETRY_AFTER_SECONDS = 120;

/** The server asked this client to wait `retryAfterSeconds` before retrying. */
export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Too many requests. Retrying shortly.");
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * The wait a 429 response asks for, in whole seconds, clamped to
 * [1, MAX_RETRY_AFTER_SECONDS]. better-auth answers with `X-Retry-After`;
 * the standard `Retry-After` (delta-seconds) is honoured too. Anything absent
 * or unparsable falls back to DEFAULT_RETRY_AFTER_SECONDS.
 */
export function parseRetryAfter(headers: Headers): number {
  const raw = headers.get("x-retry-after") ?? headers.get("retry-after");
  const seconds = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(seconds)) return DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, seconds));
}

/**
 * A request whose 429 should become a RateLimitedError: hand `fetchOptions`
 * to a better-auth client call, then read `retryAfterSeconds` once it failed.
 */
export function createRetryAfterProbe() {
  let retryAfterSeconds = DEFAULT_RETRY_AFTER_SECONDS;
  return {
    fetchOptions: {
      onError: ({ response }: { response: Response }) => {
        retryAfterSeconds = parseRetryAfter(response.headers);
      },
    },
    get retryAfterSeconds() {
      return retryAfterSeconds;
    },
  };
}

const orpcRetryHint = (data: unknown): number | null => {
  if (typeof data !== "object" || data === null || !("retryAfterSeconds" in data)) return null;
  return typeof data.retryAfterSeconds === "number" ? data.retryAfterSeconds : null;
};

/**
 * The wait `error` asks for, when it is a rate limit: a RateLimitedError from
 * an auth read, or an oRPC 429 (an API key over its budget). Null otherwise.
 */
export function rateLimitRetryAfter(error: unknown): number | null {
  if (error instanceof RateLimitedError) return error.retryAfterSeconds;
  if (error instanceof ORPCError && error.status === 429) {
    const hint = orpcRetryHint(error.data) ?? DEFAULT_RETRY_AFTER_SECONDS;
    return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, hint));
  }
  return null;
}

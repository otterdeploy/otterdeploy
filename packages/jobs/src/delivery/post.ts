/**
 * The one guarded request every transport goes through.
 *
 * `channel.target` is tenant-supplied for slack/discord/webhook — a URL the org
 * pasted in — so every request routes through the shared egress policy: resolve
 * and validate the address (loopback, private, link-local, metadata ranges and
 * the control plane's own identity denied by default), pin the connection to
 * the validated address, and re-validate every redirect hop. Fixed-URL
 * transports (FCM, PagerDuty, Telegram, Twilio) use it too, with redirects
 * off: a provider API that answers a POST with a 3xx has refused it, and the
 * delivery log must say that, not "blocked by outbound egress policy".
 *
 * Rate limits and provider outages are retried here, bounded: a 429 or a 5xx
 * is attempted up to {@link CHANNEL_DELIVERY_MAX_ATTEMPTS} times, waiting what
 * the provider asked for (`Retry-After` in seconds or as an HTTP date, or
 * Discord's float `retry_after` body field), else a short exponential backoff.
 * A wait longer than {@link CHANNEL_RETRY_MAX_WAIT_MS} is not slept through in
 * the delivery job: the attempt fails with the provider's retry window in the
 * error, so the delivery log shows a rate limit rather than a silent loss.
 *
 * It never throws: a provider error becomes a {@link DeliveryResult}, so one
 * dead or blocked channel cannot fail the whole fan-out.
 */

import { EgressPolicyError, egressFetch } from "@otterdeploy/shared/egress-policy";
import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";
import * as z from "zod";

import type { DeliveryResult } from "./types";

import { controlPlaneEgressDenylist, egressAllowlist } from "./egress-denylist";

const CHANNEL_DELIVERY_TIMEOUT_MS = 10_000;
const CHANNEL_MAX_RESPONSE_BYTES = 1024 * 1024;
/** First try plus two retries. */
const CHANNEL_DELIVERY_MAX_ATTEMPTS = 3;
/** Longest provider-requested wait the delivery job sleeps through. */
const CHANNEL_RETRY_MAX_WAIT_MS = 15_000;
/** Backoff when the provider names no wait: 1s, then 2s. */
const CHANNEL_RETRY_BASE_DELAY_MS = 1_000;
/** How much of a provider's error body the delivery log keeps. */
const ERROR_BODY_PREVIEW_CHARS = 200;

/** Rate limits and provider outages: worth retrying. 501 and other 5xx are
 *  answers about the request itself and are not. */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

export interface ProviderRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface RequestOptions {
  /** False for fixed provider APIs (see the module comment). Default true. */
  followRedirects?: boolean;
  /** Injected in tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

/** A provider's answer, body already read. */
export interface ProviderResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text: string;
  /** Set when the provider asked for a wait too long to sleep through, so
   *  the retry was not made: how long it asked for. */
  declinedRetryAfterMs?: number;
}

/** Seconds a provider names in its 429 body: Discord's top-level float
 *  `retry_after`, Telegram's `parameters.retry_after`. */
const retryBodySchema = z.union([
  z.object({ retry_after: z.number().nonnegative() }).transform((b) => b.retry_after),
  z
    .object({ parameters: z.object({ retry_after: z.number().nonnegative() }) })
    .transform((b) => b.parameters.retry_after),
]);

/**
 * Milliseconds the provider asked us to wait, or null when it named none.
 * Reads the body's `retry_after` first (Discord's float seconds are more
 * precise than its whole-second header; Telegram sends no header), then
 * `Retry-After` (delta-seconds or an HTTP date).
 */
function retryAfterMs(response: ProviderResponse): number | null {
  const body = Result.try(() => retryBodySchema.parse(JSON.parse(response.text)));
  if (body.isOk()) return Math.ceil(body.value * 1000);
  const header = response.headers.get("retry-after")?.trim();
  if (!header) return null;
  if (/^\d+(\.\d+)?$/.test(header)) return Math.ceil(Number(header) * 1000);
  const at = parseHttpDate(header);
  if (at === null) return null;
  return Math.max(0, at.epochMilliseconds - Temporal.Now.instant().epochMilliseconds);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IMF_FIXDATE = /^[A-Z][a-z]{2}, (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;

/** RFC 9110 IMF-fixdate (`Sun, 06 Nov 1994 08:49:37 GMT`), the only HTTP-date
 *  form a sender may generate; null for anything else. */
function parseHttpDate(value: string): Temporal.Instant | null {
  const match = IMF_FIXDATE.exec(value);
  if (!match) return null;
  const [, day, month, year, hour, minute, second] = match;
  const monthIndex = MONTHS.indexOf(month ?? "");
  if (monthIndex < 0) return null;
  const parsed = Result.try(() =>
    Temporal.ZonedDateTime.from({
      timeZone: "UTC",
      year: Number(year),
      month: monthIndex + 1,
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    }).toInstant(),
  );
  return parsed.isOk() ? parsed.value : null;
}

/** Why no usable answer came back. `message` is the delivery-log line. */
export interface RequestFailure {
  message: string;
  /** Worth another try later (transport trouble, a long rate limit), as
   *  opposed to a destination the policy refuses outright. */
  retryable: boolean;
}

/** One guarded exchange, no retry. */
async function exchange(
  url: string,
  init: ProviderRequest,
  options: RequestOptions,
): Promise<Result<ProviderResponse, RequestFailure>> {
  const sent = await Result.tryPromise({
    try: async () => {
      const denylist = await controlPlaneEgressDenylist();
      const res = await egressFetch(
        url,
        { method: init.method ?? "POST", headers: init.headers, body: init.body },
        {
          // Channel receivers (self-hosted webhook sinks, internal relays)
          // are commonly plain http. The address checks are the actual SSRF
          // defense, not the scheme.
          allowHttp: true,
          timeoutMs: CHANNEL_DELIVERY_TIMEOUT_MS,
          maxBytes: CHANNEL_MAX_RESPONSE_BYTES,
          maxRedirects: 5,
          followRedirects: options.followRedirects ?? true,
          denyHosts: denylist.blockedHosts,
          denyAddresses: denylist.blockedAddresses,
          allowAddresses: await egressAllowlist(),
        },
      );
      return { status: res.status, ok: res.ok, headers: res.headers, text: await res.text() };
    },
    catch: (err): RequestFailure => {
      if (err instanceof EgressPolicyError && err.kind === "denied") {
        return { message: `blocked by outbound egress policy: ${err.message}`, retryable: false };
      }
      return { message: err instanceof Error ? err.message : String(err), retryable: true };
    },
  });
  return sent;
}

const realSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** ` (provider asked to retry after 60s; not retried)`, or nothing. */
export function declinedRetryNote(response: ProviderResponse): string {
  return response.declinedRetryAfterMs === undefined
    ? ""
    : ` (provider asked to retry after ${Math.ceil(response.declinedRetryAfterMs / 1000)}s; not retried)`;
}

/** The delivery-log line for a provider's non-2xx answer. */
export function httpFailure(response: ProviderResponse): string {
  const body = response.text.slice(0, ERROR_BODY_PREVIEW_CHARS);
  return `HTTP ${response.status}${body ? `: ${body}` : ""}${declinedRetryNote(response)}`;
}

/**
 * Guarded request with the bounded 429/5xx retry. Ok carries the provider's
 * final answer whatever its status (a caller that understands the body, like
 * FCM, inspects it), marked when a requested wait was declined; Err means no
 * answer was obtained at all.
 */
export async function request(
  url: string,
  init: ProviderRequest,
  options: RequestOptions = {},
): Promise<Result<ProviderResponse, RequestFailure>> {
  const sleep = options.sleep ?? realSleep;
  for (let attempt = 1; ; attempt++) {
    const sent = await exchange(url, init, options);
    if (sent.isErr()) return sent;
    const response = sent.value;
    if (!RETRYABLE_STATUSES.has(response.status) || attempt >= CHANNEL_DELIVERY_MAX_ATTEMPTS) {
      return sent;
    }
    const wait = retryAfterMs(response) ?? CHANNEL_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
    if (wait > CHANNEL_RETRY_MAX_WAIT_MS) {
      return Result.ok({ ...response, declinedRetryAfterMs: wait });
    }
    await sleep(wait);
  }
}

/** Guarded POST whose 2xx is the whole verdict (webhooks, chat, incidents). */
export async function post(
  url: string,
  init: ProviderRequest,
  options: RequestOptions = {},
): Promise<DeliveryResult> {
  const answered = await request(url, { ...init, method: init.method ?? "POST" }, options);
  if (answered.isErr()) {
    return { ok: false, error: answered.error.message, retryable: answered.error.retryable };
  }
  if (answered.value.ok) return { ok: true };
  return {
    ok: false,
    error: httpFailure(answered.value),
    retryable: RETRYABLE_STATUSES.has(answered.value.status),
  };
}

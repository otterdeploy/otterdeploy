import type * as z from "zod";

/**
 * Small shared pieces: the one error type, JSON-over-HTTP with schema parsing
 * at the boundary, clocks, and polling. No raw try/catch: every throwing call
 * goes through better-result.
 */
import { Temporal } from "@otterdeploy/shared/temporal";
import { Result, TaggedError } from "better-result";

export class LabError extends TaggedError("LabError")<{ where: string; message: string }>() {
  constructor(where: string, message: string) {
    super({ where, message });
  }
}

export type LabResult<T> = Result<T, LabError>;

export function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export interface JsonRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Fetch JSON and parse it with `schema`. Non-2xx bodies are surfaced verbatim
 *  (provider APIs put the actionable reason there). */
export async function fetchJson<S extends z.ZodType>(
  where: string,
  url: string,
  schema: S,
  request: JsonRequest = {},
): Promise<LabResult<z.infer<S>>> {
  const headers: Record<string, string> = { ...request.headers };
  if (request.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await Result.tryPromise({
    try: () =>
      fetch(url, {
        method: request.method ?? "GET",
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: AbortSignal.timeout(60_000),
      }),
    catch: (cause) => new LabError(where, `request failed: ${describeCause(cause)}`),
  });
  if (response.isErr()) return Result.err(response.error);
  const text = await Result.tryPromise({
    try: () => response.value.text(),
    catch: (cause) => new LabError(where, `reading body failed: ${describeCause(cause)}`),
  });
  if (text.isErr()) return Result.err(text.error);
  if (!response.value.ok) {
    return Result.err(new LabError(where, `HTTP ${response.value.status}: ${text.value}`));
  }
  const json = Result.try({
    try: (): unknown => (text.value.length === 0 ? {} : JSON.parse(text.value)),
    catch: (cause) => new LabError(where, `invalid JSON: ${describeCause(cause)}`),
  });
  if (json.isErr()) return Result.err(json.error);
  const parsed = schema.safeParse(json.value);
  if (!parsed.success) {
    return Result.err(new LabError(where, `unexpected response shape: ${parsed.error.message}`));
  }
  return Result.ok(parsed.data);
}

export function nowInstant(): Temporal.Instant {
  return Temporal.Now.instant();
}

export function nowEpochSeconds(): number {
  return Math.floor(nowInstant().epochMilliseconds / 1000);
}

export function secondsSince(start: Temporal.Instant): number {
  return Math.round(nowInstant().since(start).total("milliseconds") / 100) / 10;
}

/** Poll `check` until it yields a value or `timeoutMs` passes. `check`
 *  returning undefined means "not yet"; an Err aborts immediately. */
export async function pollUntil<T>(
  where: string,
  timeoutMs: number,
  intervalMs: number,
  check: () => Promise<LabResult<T | undefined>>,
): Promise<LabResult<T>> {
  const deadline = nowInstant().add({ milliseconds: timeoutMs });
  for (;;) {
    const result = await check();
    if (result.isErr()) return Result.err(result.error);
    if (result.value !== undefined) return Result.ok(result.value);
    if (Temporal.Instant.compare(nowInstant(), deadline) >= 0) {
      return Result.err(new LabError(where, `timed out after ${Math.round(timeoutMs / 1000)}s`));
    }
    await Bun.sleep(intervalMs);
  }
}

/** Short, DNS-label and Hetzner-label safe run id: `r` + base36 time + random. */
export function newRunId(): string {
  const time = (nowEpochSeconds() % 36 ** 5).toString(36).padStart(5, "0");
  const random = crypto.getRandomValues(new Uint8Array(2));
  const suffix = Array.from(random, (byte) => (byte % 36).toString(36)).join("");
  return `r${time}${suffix}`;
}

export const RUN_ID_PATTERN = /^r[a-z0-9]{4,12}$/;

/**
 * Cron parsing, backed by the native `Bun.cron.parse` (Bun ≥ 1.3.12): one
 * parser for BOTH boundary validation and scheduler math, so "valid at create
 * time" and "fires at run time" can never disagree. Throws from Bun carry
 * field-level detail ("value out of range for field", "expected 5
 * space-separated fields…"), which the contract surfaces to the form as-is.
 *
 * Accepts the standard 5-field syntax plus `@hourly`/`@daily`/`@weekly`/
 * `@monthly`/`@yearly` nicknames. Seconds (6-field) are not supported.
 *
 * Runtime floor: CI and the server image both run Bun ≥ 1.3.14 (see
 * .github/workflows/ci.yml and apps/server/Dockerfile BUN_VERSION); older
 * runtimes lack `Bun.cron` entirely.
 */
import { Result, TaggedError } from "better-result";

class InvalidCronError extends TaggedError("InvalidCronError")<{
  message: string;
  expression: string;
}>() {
  constructor(args: { expression: string; detail: string }) {
    super({ expression: args.expression, message: args.detail });
  }
}

/** Next fire time strictly after `from`. `ok(null)` = expression is valid but
 *  never matches (e.g. Feb 30); `err` = unparseable expression. */
export function nextCronFire(
  expression: string,
  from: Date,
): Result<Date | null, InvalidCronError> {
  return Result.try({
    try: () => Bun.cron.parse(expression, from),
    catch: (cause) =>
      new InvalidCronError({
        expression,
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
  });
}

/** Boundary validation: err carries Bun's field-level reason. */
export function validateCron(expression: string): Result<void, InvalidCronError> {
  return nextCronFire(expression, new Date()).map(() => undefined);
}

/** Expected ms between consecutive fires from `from` (null when the
 *  expression is invalid or never fires twice). Drives the derived
 *  backup-overdue threshold. */
export function cronIntervalMs(expression: string, from: Date): number | null {
  const first = nextCronFire(expression, from);
  if (first.isErr() || first.value == null) return null;
  const second = nextCronFire(expression, first.value);
  if (second.isErr() || second.value == null) return null;
  return second.value.getTime() - first.value.getTime();
}

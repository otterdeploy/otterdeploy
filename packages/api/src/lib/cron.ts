import { Result, TaggedError } from "better-result";
import cronParser from "cron-parser";

class InvalidCronError extends TaggedError("InvalidCronError")<{
  message: string;
  expression: string;
}>() {}

const CRON_NICKNAMES = new Set(["@hourly", "@daily", "@weekly", "@monthly", "@yearly"]);

function invalidCron(expression: string, detail: string): InvalidCronError {
  return new InvalidCronError({ expression, message: detail });
}

function assertFiveFieldCron(expression: string): void {
  const normalized = expression.trim();
  if (CRON_NICKNAMES.has(normalized)) return;
  if (normalized.split(/\s+/).length !== 5) {
    throw new Error("Expected 5 space-separated cron fields");
  }
}

/** Next fire time strictly after `from`. `ok(null)` = expression is valid but
 *  never matches (e.g. Feb 30); `err` = unparseable expression. */
export function nextCronFire(
  expression: string,
  from: Date,
): Result<Date | null, InvalidCronError> {
  return Result.try({
    try: () => {
      assertFiveFieldCron(expression);
      return cronParser
        .parseExpression(expression, { currentDate: from, tz: "UTC" })
        .next()
        .toDate();
    },
    catch: (cause) =>
      invalidCron(expression, cause instanceof Error ? cause.message : String(cause)),
  });
}

/** Boundary validation: err carries the parser's field-level reason. */
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

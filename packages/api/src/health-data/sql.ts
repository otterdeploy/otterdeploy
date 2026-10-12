/**
 * Database plumbing shared by the health data modules: one typed error, the
 * executor type both `db` and a transaction satisfy, row parsing for raw
 * `execute` results.
 */
import type { db } from "@otterdeploy/db";

import { TaggedError } from "better-result";
import * as z from "zod";

export class HealthDbError extends TaggedError("HealthDbError")<{
  message: string;
  /** SQLSTATE when the server raised it (e.g. "40001"), else the driver's code. */
  code: string | null;
}>() {}

/** `db` or a transaction handle: anything that can run a raw statement. */
export type Executor = Pick<typeof db, "execute">;

function stringField(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null || !(key in value)) return null;
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" ? field : null;
}

/** SQLSTATE of a driver error, looking through drizzle's wrapping `cause`. */
function sqlStateOf(cause: unknown): string | null {
  let current: unknown = cause;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth++) {
    const errno = stringField(current, "errno");
    if (errno !== null && /^[0-9A-Z]{5}$/.test(errno)) return errno;
    const code = stringField(current, "code");
    if (code !== null && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = typeof current === "object" ? Reflect.get(current, "cause") : null;
  }
  return null;
}

export function toDbError(cause: unknown): HealthDbError {
  if (HealthDbError.is(cause)) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  return new HealthDbError({ message, code: sqlStateOf(cause) });
}

/**
 * Rows of a raw `execute` result, parsed (never cast). bun-sql returns a plain
 * row array; a `{ rows }` shape is tolerated for other drivers.
 */
export function rowsOf<T>(result: unknown, schema: z.ZodType<T>): T[] {
  const rows =
    typeof result === "object" && result !== null && "rows" in result
      ? Reflect.get(result, "rows")
      : result;
  return z.array(schema).parse(Array.isArray(rows) ? rows : []);
}

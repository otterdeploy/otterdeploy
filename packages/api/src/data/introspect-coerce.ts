/**
 * Coercions shared by every introspection parser.
 *
 * Catalogs disagree about how to spell a boolean, a count and a list, and they
 * disagree per engine: MySQL returns "YES" while Postgres may return an int8
 * as a bigint or a string. Normalising in
 * one place is what lets the row parsers stay dialect-independent.
 */
import * as z from "zod";

/**
 * Coerce the many ways an engine reports a count or a size into a number, or
 * null.
 *
 * MySQL returns strings while Postgres can return bigints for int8. Anything that does not become a finite
 * non-negative number is null, meaning "unknown" -- which is different from
 * zero and must not be flattened into it.
 */
export const numericish = z
  .union([z.number(), z.bigint(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  });

/** Engines report booleans as true/false, as 1/0, or as "YES"/"NO". */
export const boolish = z
  .union([z.boolean(), z.number(), z.bigint(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number" || typeof v === "bigint") return Number(v) !== 0;
    if (typeof v === "string") return ["1", "true", "t", "yes"].includes(v.toLowerCase());
    return false;
  });

function isScalar(value: unknown): value is string | number | bigint {
  return typeof value === "string" || typeof value === "number" || typeof value === "bigint";
}

export const stringish = z
  .union([z.string(), z.number(), z.bigint(), z.null(), z.undefined()])
  .transform((v) => (v === null || v === undefined ? null : String(v)));

/** Engines return array columns as arrays, or as a comma-joined string. */
export const listish = z
  .union([z.array(z.unknown()), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    // Enum labels and column names. Anything that is not already a scalar is
    // dropped rather than stringified into "[object Object]".
    if (Array.isArray(v)) return v.flatMap((x) => (isScalar(x) ? [String(x)] : []));
    if (typeof v === "string" && v !== "") return v.split(",");
    return [];
  });

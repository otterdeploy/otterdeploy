/**
 * Driver value → {@link CellValue}.
 *
 * This is the layer that makes the typed grid true, and it is pure so it can be
 * tested exhaustively without a database.
 *
 * There are two paths, and the difference between them is worth stating plainly
 * because the UI surfaces it:
 *
 *   - **Declared** — browsing a table. The column's real type came from
 *     introspection, so the dialect already told us the exact family and we
 *     decode into it. `numeric` stays a decimal, `int8` stays exact, a NULL in
 *     a text column is a NULL.
 *
 *   - **Inferred** — an arbitrary statement in the SQL runner. Postgres reports
 *     result column names but not their types over this driver, so the family
 *     is read off the JavaScript value the driver produced. That is strictly
 *     less precise: `numeric` arrives as a string and is indistinguishable from
 *     text, so it is labelled `text`. We do not guess by looking at the shape of
 *     the string — "1.5" being a decimal and "1.5" being a version number are
 *     the same characters, and a grid that right-aligns one of them because it
 *     matched a regex is lying about what the database said.
 */
import type { CellKind, CellValue } from "@otterdeploy/data-engine";
import type { JsonValue } from "@otterdeploy/shared/json";

import {
  cellArray,
  cellBigint,
  cellBool,
  cellBytes,
  cellDate,
  cellDecimal,
  cellInstant,
  cellJson,
  cellNumber,
  cellOpaque,
  cellText,
  cellTime,
} from "@otterdeploy/data-engine";
import { Result } from "better-result";

/**
 * A readable string for a value we could not model.
 *
 * `String(value)` is wrong here: on a plain object it yields "[object Object]",
 * which is precisely the useless output the `opaque` kind exists to avoid. An
 * opaque cell is shown to a human who is trying to work out what the database
 * returned, so it has to carry something they can read.
 */
function describeUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const json = Result.try({
      try: (): string => JSON.stringify(value) ?? "",
      catch: () => undefined,
    });
    if (json.isOk() && json.value !== "") return json.value;
    return Object.prototype.toString.call(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  // symbol, function: anything whose default stringification is a tag.
  return Object.prototype.toString.call(value);
}

/** Base64-encode bytes without a Buffer round trip. */
function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

/**
 * A `Date` reaching this module is a library seam, not a modelling choice: the
 * driver hands one back for timestamp columns. It is converted immediately to
 * an ISO string and never propagates — the repo's rule is Temporal everywhere,
 * and an ISO instant is what Temporal parses.
 */
function isDate(value: unknown): value is Date {
  return value instanceof Date;
}

/** Best-effort JSON round trip, so a driver-provided object stays structured. */
function asJsonValue(value: unknown): JsonValue | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    for (const item of value) {
      const child = asJsonValue(item);
      if (child === undefined) return undefined;
      out.push(child);
    }
    return out;
  }
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value)) {
      const child = asJsonValue(v);
      if (child === undefined) return undefined;
      out[k] = child;
    }
    return out;
  }
  return undefined;
}

/** Decoders for the kinds whose driver representation needs real handling. */
const DECLARED_DECODERS: Partial<Record<CellKind, (raw: unknown) => CellValue>> = {
  bool: (raw) => (typeof raw === "boolean" ? cellBool(raw) : cellText(describeUnknown(raw))),
  number: (raw) => {
    if (typeof raw === "number") return cellNumber(raw);
    // Postgres hands float8 back as a string in some configurations.
    const n = Number(raw);
    return Number.isFinite(n) ? cellNumber(n) : cellText(describeUnknown(raw));
  },
  // Exactness is the whole point: never route these through Number.
  bigint: (raw) => cellBigint(typeof raw === "bigint" ? raw.toString() : describeUnknown(raw)),
  decimal: (raw) => cellDecimal(describeUnknown(raw)),
  bytes: (raw) =>
    isUint8Array(raw) ? cellBytes(encodeBase64(raw)) : cellText(describeUnknown(raw)),
  json: (raw) => {
    const json = asJsonValue(raw);
    // A jsonb column whose value we cannot re-encode is a driver surprise, not
    // a user error; keep it visible as opaque rather than dropping it.
    return json === undefined ? cellOpaque(describeUnknown(raw)) : cellJson(json);
  },
  instant: (raw) => cellInstant(isDate(raw) ? raw.toISOString() : describeUnknown(raw)),
  date: (raw) =>
    cellDate(isDate(raw) ? (raw.toISOString().split("T")[0] ?? "") : describeUnknown(raw)),
  time: (raw) => cellTime(describeUnknown(raw)),
};

/**
 * Decode one value into the family the column was *declared* as.
 *
 * SQL NULL is checked first and once: it is the only thing that becomes `null`,
 * and no decoder below can ever produce it.
 */
export function decodeDeclared(raw: unknown, kind: CellKind): CellValue {
  if (raw === null || raw === undefined) return null;
  if (kind === "array") {
    if (!Array.isArray(raw)) return cellOpaque(describeUnknown(raw));
    // Element type is not carried per element; infer each so a text[] of digits
    // does not silently become numbers.
    return cellArray(raw.map((item) => decodeInferred(item)));
  }
  const decoder = DECLARED_DECODERS[kind];
  if (decoder) return decoder(raw);
  // text / opaque, and anything a dialect classified into them.
  return kind === "opaque" ? cellOpaque(describeUnknown(raw)) : cellText(describeUnknown(raw));
}

/**
 * Decode one value with no declared type, reading the family off the JavaScript
 * value the driver produced.
 *
 * Deliberately conservative. A `numeric` arrives as a string and is left as
 * text rather than being sniffed into a decimal, because a regex cannot tell a
 * decimal from a version string and the grid would then right-align and
 * validate a value the database never called a number.
 */
export function decodeInferred(raw: unknown): CellValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "boolean") return cellBool(raw);
  if (typeof raw === "number") return cellNumber(raw);
  if (typeof raw === "bigint") return cellBigint(raw.toString());
  if (typeof raw === "string") return cellText(raw);
  if (isUint8Array(raw)) return cellBytes(encodeBase64(raw));
  if (isDate(raw)) return cellInstant(raw.toISOString());
  if (Array.isArray(raw)) return cellArray(raw.map(decodeInferred));
  if (typeof raw === "object") {
    const json = asJsonValue(raw);
    return json === undefined ? cellOpaque(describeUnknown(raw)) : cellJson(json);
  }
  return cellOpaque(describeUnknown(raw));
}

/**
 * Decode a driver row (already in array-of-values form) against the column
 * kinds for that result, falling back to inference for any column past the end
 * of the declared list.
 */
export function decodeRow(raw: readonly unknown[], kinds: readonly CellKind[]): CellValue[] {
  return raw.map((value, i) => {
    const kind = kinds[i];
    return kind === undefined ? decodeInferred(value) : decodeDeclared(value, kind);
  });
}

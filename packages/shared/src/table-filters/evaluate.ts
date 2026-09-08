/**
 * The in-memory engine: one canonical operation against one row.
 *
 * Every comparison here has a counterpart in the SQL compiler
 * (`packages/api/src/lib/table/sql.ts`), and the pair is pinned by the shared
 * conformance fixtures — that is what "the rows on screen and the rows the
 * database returns agree" means in practice.
 */

import type { FilterOp, Scalar } from "./types";

import { Temporal } from "../temporal";
import { asInstant, asNumber, asText, isRecord } from "./values";

/**
 * Read a possibly dotted key off a row.
 *
 * Keys are dot-notation (`"timing.dns"`), and rows may carry that as a literal
 * flat key or as a nested object. A flat hit wins, since that is the wire shape.
 */
export function valueAtKey(row: unknown, key: string): unknown {
  if (!isRecord(row)) return undefined;
  const flat = row[key];
  if (flat !== undefined) return flat;
  if (!key.includes(".")) return undefined;
  let current: unknown = row;
  for (const part of key.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Case-insensitive substring, matching the SQL side's `ilike`.
 *
 * An array cell matches when any MEMBER matches, rather than stringifying the
 * whole array — a needle spanning the comma separator would otherwise match a
 * pair of tags that share no such text.
 */
function containsText(cell: unknown, needle: string): boolean {
  if (Array.isArray(cell)) return cell.some((item) => containsText(item, needle));
  const text = asText(cell);
  return text !== null && text.toLowerCase().includes(needle.toLowerCase());
}

function sameScalar(cell: unknown, value: Scalar): boolean {
  if (cell === value) return true;
  // A URL can only produce strings, so a number column filtered from a link
  // arrives as one. Compare by string as a LAST resort rather than coercing,
  // which would make `0 == false` true.
  if ((typeof cell === "number" || typeof cell === "boolean") && typeof value === "string") {
    return String(cell) === value;
  }
  if (typeof cell === "string" && typeof value !== "string") {
    return cell === String(value);
  }
  return false;
}

/**
 * Evaluate one canonical operation against one row.
 *
 * Takes the ROW rather than a cell because `substringAny` spans columns.
 * Exhaustive over `FilterOp` with no default branch: an eighth operation fails
 * to compile here rather than silently passing every row.
 */
export function evaluateOp(op: FilterOp, row: unknown): boolean {
  switch (op.op) {
    case "substring":
      return containsText(valueAtKey(row, op.key), op.value);

    case "substringAny":
      return op.keys.some((key) => containsText(valueAtKey(row, key), op.value));

    case "equals":
      return sameScalar(valueAtKey(row, op.key), op.value);

    case "oneOf": {
      const cell = valueAtKey(row, op.key);
      return op.values.some((value) => sameScalar(cell, value));
    }

    case "overlaps": {
      // The column is a set. A scalar cell counts as a one-element set, so a
      // single-value column still matches.
      const cell = valueAtKey(row, op.key);
      const cells = Array.isArray(cell) ? cell : [cell];
      return cells.some((item) => op.values.some((value) => sameScalar(item, value)));
    }

    case "numberRange": {
      const value = asNumber(valueAtKey(row, op.key));
      return value !== null && value >= op.min && value <= op.max;
    }

    case "instantRange": {
      const instant = asInstant(valueAtKey(row, op.key));
      if (instant === null) return false;
      return (
        Temporal.Instant.compare(instant, op.from) >= 0 &&
        Temporal.Instant.compare(instant, op.to) <= 0
      );
    }
  }
}

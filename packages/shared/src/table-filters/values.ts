/**
 * Reading untrusted values without ever throwing.
 *
 * Filter values arrive from a URL a human can edit, a JSON boundary that has no
 * `Date` type, and API callers that send whatever they like. Every reader here
 * answers `null` for "not usable as this kind of thing", which normalization
 * reads as "the user is not filtering on this column" — never as an exception
 * inside a table render, and never as "match nothing".
 */

import type { ColKind, Scalar } from "./types";

import { Temporal, toTemporalInstant } from "../temporal";

/** Unix ms timestamps are 13-digit numbers (> Sep 2001, < Nov 2286). */
const UNIX_MS_MIN = 1_000_000_000_000;
/** A plain date, as a date picker and a URL both write it. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** All digits: epoch millis that lost their number type crossing JSON. */
const ALL_DIGITS = /^\d+$/;

/** A real type guard, so reading an arbitrary key needs no type assertion. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Parse a time-ish string without throwing.
 *
 * `Temporal.Instant.from` throws on malformed input, so parsing goes through
 * `Date.parse` — the one non-throwing parser available. It yields a NUMBER, so
 * no `Date` object is constructed here.
 */
function parseInstantText(text: string): Temporal.Instant | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  // Epoch millis that arrived as a string — what a URL codec and JSON both
  // produce. The magnitude test keeps a bare year ("2024") parsing as a year.
  if (ALL_DIGITS.test(trimmed)) {
    const millis = Number(trimmed);
    if (millis >= UNIX_MS_MIN) return Temporal.Instant.fromEpochMilliseconds(millis);
  }
  // A plain date is read as UTC midnight; `normalize` widens it to a whole day
  // in the declared zone. Without the explicit `Z`, `Date.parse` reads a bare
  // date as UTC but a date+time as local, and that inconsistency would make one
  // filter select different rows on two machines.
  const iso = DATE_ONLY.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : Temporal.Instant.fromEpochMilliseconds(parsed);
}

/** Whatever a URL, a wire payload, a driver row or a chart handed us. */
export function asInstant(value: unknown): Temporal.Instant | null {
  if (value instanceof Temporal.Instant) return value;
  if (value instanceof Temporal.ZonedDateTime) return value.toInstant();
  // A `Date` only ever arrives from a library seam (d3 ticks, a driver row).
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toTemporalInstant.call(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? Temporal.Instant.fromEpochMilliseconds(value) : null;
  }
  if (typeof value === "string") return parseInstantText(value);
  return null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function asScalar(value: unknown): Scalar | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Coerce one set member to the column's DECLARED family.
 *
 * The URL layer, a pasted link and every JSON boundary deliver `["200","500"]`
 * for a numeric column. Without this the SQL side would emit
 * `inArray(integerColumn, ["200","500"])` and lean on the database casting the
 * literals, while the in-memory side compared strings against numbers.
 */
export function asDeclaredScalar(kind: ColKind, value: unknown): Scalar | null {
  switch (kind) {
    case "number":
      return asNumber(value);
    case "boolean":
      return asBoolean(value);
    case "instant": {
      const instant = asInstant(value);
      return instant === null ? null : instant.epochMilliseconds;
    }
    case "string":
    case "enum":
    case "array": {
      const scalar = asScalar(value);
      return scalar === null ? null : String(scalar);
    }
  }
}

/**
 * Is this filter value active — has the user actually filtered on the column?
 *
 * Inactive means absent, cleared, an empty multi-select, or a value nothing can
 * be compared against. An array is active when ANY member is usable:
 * `normalize` drops the members it cannot use, so requiring all of them would
 * let one blank entry delete the whole filter — and inconsistently, since
 * `["abc", 500]` on a slider degenerates to 500 while `["", 500]` vanished.
 */
export function isActive(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (Array.isArray(value)) return value.some(isActive);
  return true;
}

/**
 * A cell as comparable text, or `null` when it has none.
 *
 * A plain object is deliberately NOT stringified: `String({})` is
 * `"[object Object]"`, and a search box that quietly matches every row carrying
 * a jsonb column is worse than one that matches none.
 */
export function asText(cell: unknown): string | null {
  if (typeof cell === "string") return cell;
  if (typeof cell === "number" || typeof cell === "boolean" || typeof cell === "bigint") {
    return String(cell);
  }
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : cell.toISOString();
  if (cell instanceof Temporal.Instant) return cell.toString();
  return null;
}

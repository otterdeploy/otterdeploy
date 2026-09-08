/**
 * Declaration + value → one canonical operation.
 *
 * Dispatch is on the declared `(type, kind)` pair. `normalize` is the ONLY
 * place a filter value's shape is interpreted; every engine downstream sees an
 * operation that has already been decided.
 */

import type { ColKind, FilterOp, FilterSpec, Scalar } from "./types";

import { Temporal } from "../temporal";
import {
  asArray,
  asBoolean,
  asDeclaredScalar,
  asInstant,
  asNumber,
  asScalar,
  isActive,
} from "./values";

/** The whole day `instant` falls in, in `timeZone`, as an inclusive range. */
function dayRange(
  instant: Temporal.Instant,
  timeZone: string,
): { from: Temporal.Instant; to: Temporal.Instant } {
  const startOfDay = instant.toZonedDateTimeISO(timeZone).startOfDay();
  return {
    from: startOfDay.toInstant(),
    // The last representable moment of the day, so the range is inclusive on
    // both ends without any engine having to special-case the upper bound.
    to: startOfDay.add({ days: 1 }).subtract({ nanoseconds: 1 }).toInstant(),
  };
}

/** Every usable member, coerced to the declared family. */
function declaredMembers(kind: ColKind, value: unknown): Scalar[] {
  const members: Scalar[] = [];
  for (const member of asArray(value)) {
    const scalar = asDeclaredScalar(kind, member);
    if (scalar !== null) members.push(scalar);
  }
  return members;
}

function normalizeSearch(spec: FilterSpec, value: unknown): FilterOp | null {
  const text = asScalar(Array.isArray(value) ? value[0] : value);
  if (text === null) return null;
  const trimmed = String(text).trim();
  if (trimmed === "") return null;
  // A search declaring no columns searches its own key, so a degenerate
  // declaration still means something rather than matching every row.
  const keys = spec.keys && spec.keys.length > 0 ? spec.keys : [spec.key];
  return { op: "substringAny", key: spec.key, keys, value: trimmed };
}

function normalizeInput(spec: FilterSpec, value: unknown): FilterOp | null {
  const raw = Array.isArray(value) ? value[0] : value;
  // A number column's text box is an exact match, not a substring search:
  // substring matching a stringified number makes "5" match 1500.
  if (spec.kind === "number") {
    const parsed = asNumber(raw);
    return parsed === null ? null : { op: "equals", key: spec.key, value: parsed };
  }
  if (spec.kind === "boolean") {
    const parsed = asBoolean(raw);
    return parsed === null ? null : { op: "equals", key: spec.key, value: parsed };
  }
  const text = asScalar(raw);
  if (text === null) return null;
  const trimmed = String(text).trim();
  return trimmed === "" ? null : { op: "substring", key: spec.key, value: trimmed };
}

function normalizeCheckbox(spec: FilterSpec, value: unknown): FilterOp | null {
  // On an array column the members are compared against the ITEM family.
  const memberKind: ColKind = spec.kind === "array" ? (spec.itemKind ?? "string") : spec.kind;
  const values = declaredMembers(memberKind, value);
  if (values.length === 0) return null;
  // An array column is a set on both sides: overlap, not membership.
  return spec.kind === "array"
    ? { op: "overlaps", key: spec.key, values }
    : { op: "oneOf", key: spec.key, values };
}

function normalizeSlider(spec: FilterSpec, value: unknown): FilterOp | null {
  const numbers: number[] = [];
  for (const member of asArray(value)) {
    const parsed = asNumber(member);
    if (parsed !== null) numbers.push(parsed);
  }
  const first = numbers[0];
  if (first === undefined) return null;
  // A single-handle slider is a degenerate RANGE, not an equality — the two
  // disagree the moment the column holds non-integers.
  const second = numbers[1] ?? first;
  return {
    op: "numberRange",
    key: spec.key,
    min: Math.min(first, second),
    max: Math.max(first, second),
  };
}

function normalizeTimerange(spec: FilterSpec, value: unknown): FilterOp | null {
  const instants: Temporal.Instant[] = [];
  for (const member of asArray(value)) {
    const instant = asInstant(member);
    if (instant !== null) instants.push(instant);
  }
  const first = instants[0];
  if (first === undefined) return null;
  const second = instants[1];
  // One date means "that whole day", which is what a date picker means.
  if (second === undefined) {
    const { from, to } = dayRange(first, spec.timeZone ?? "UTC");
    return { op: "instantRange", key: spec.key, from, to };
  }
  return Temporal.Instant.compare(first, second) <= 0
    ? { op: "instantRange", key: spec.key, from: first, to: second }
    : { op: "instantRange", key: spec.key, from: second, to: first };
}

/**
 * Turn one declared filter and its value into a canonical operation.
 *
 * Returns `null` when the filter is inactive or the value cannot be coerced
 * into the declared shape — which every caller reads as "this column is not
 * being filtered", never as "match nothing".
 */
export function normalize(spec: FilterSpec, value: unknown): FilterOp | null {
  if (!isActive(value)) return null;
  switch (spec.type) {
    case "search":
      return normalizeSearch(spec, value);
    case "input":
      return normalizeInput(spec, value);
    case "checkbox":
      return normalizeCheckbox(spec, value);
    case "slider":
      return normalizeSlider(spec, value);
    case "timerange":
      return normalizeTimerange(spec, value);
  }
}

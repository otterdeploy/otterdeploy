/**
 * What a table filter MEANS, as plain data.
 *
 * A column declares its semantics once — a `(type, kind)` pair plus its option
 * set or bounds — and every engine (Postgres, the in-memory evaluator, the
 * client-side TanStack `filterFn`) consumes the canonical operations compiled
 * from that declaration and nothing else.
 *
 * The rule that makes it work: **dispatch is on the DECLARED pair, never on the
 * runtime shape of the value.** A two-element array on a numeric checkbox is a
 * two-member set, and on a slider it is a range; nothing downstream has to
 * guess, because `numberRange` is unreachable from a checkbox declaration.
 * That is the bug class this module deletes — the same filter meaning one thing
 * in SQL and another on the rows already on screen.
 */

import type { Temporal } from "../temporal";

/** The data family a column holds. Decides how its values are compared. */
export type ColKind = "string" | "number" | "boolean" | "enum" | "array" | "instant";

/**
 * The control a column is filtered through, which is also its semantics:
 *
 * - `input`      one text box → substring (or exact match on a number column)
 * - `search`     one text box spanning SEVERAL columns → OR of substrings
 * - `checkbox`   multi-select → set membership (set OVERLAP on an array column)
 * - `slider`     two handles → an inclusive numeric range
 * - `timerange`  date picker → an inclusive instant range
 */
export type FilterType = "input" | "search" | "checkbox" | "slider" | "timerange";

/** A value a filter can compare against. */
export type Scalar = string | number | boolean;

/**
 * A column's declared filter semantics.
 *
 * This is the whole input to normalization. No engine is given anything else
 * about a column, which is what stops one of them re-deriving semantics from
 * whatever the value happened to look like at runtime.
 */
export interface FilterSpec {
  /** The one identity space: schema key = URL param = facet key = column map key. */
  key: string;
  type: FilterType;
  kind: ColKind;
  /** Item family, when `kind === "array"`. Defaults to `"string"`. */
  itemKind?: ColKind;
  /** Columns a `search` spans. Ignored for every other type. */
  keys?: readonly string[];
  /** The allowed values of a checkbox. Also the guard `coerce` enforces. */
  options?: readonly Scalar[];
  /** Slider bounds. Also the clamp `coerce` applies. */
  min?: number;
  max?: number;
  /**
   * Time zone a lone date expands to a whole day in. Defaults to `"UTC"`
   * rather than the ambient zone ON PURPOSE: the client and the server must
   * agree on what "that day" means, and `Temporal.Now.timeZoneId()` differs
   * between them. The UI passes the viewer's zone explicitly.
   */
  timeZone?: string;
}

/** Restrict which keys `plan` considers — the three-pass strategy's knob. */
export interface FilterSelection {
  only?: readonly string[];
  exclude?: readonly string[];
}

/**
 * The backend-neutral operation set. CLOSED — exactly seven members.
 *
 * Every engine implements all seven in an exhaustive switch with no default
 * branch, so an eighth is a compile error everywhere rather than a filter that
 * silently stops filtering. That is the design, not a limitation.
 */
export type FilterOp =
  /** Case-insensitive substring, one column. */
  | { op: "substring"; key: string; value: string }
  /** Case-insensitive substring across several columns, OR-ed. */
  | { op: "substringAny"; key: string; keys: readonly string[]; value: string }
  | { op: "equals"; key: string; value: Scalar }
  /** Scalar column, value ∈ set. */
  | { op: "oneOf"; key: string; values: Scalar[] }
  /** Array column, column ∩ set ≠ ∅. */
  | { op: "overlaps"; key: string; values: Scalar[] }
  /** Inclusive on both ends. */
  | { op: "numberRange"; key: string; min: number; max: number }
  /** Inclusive on both ends. */
  | { op: "instantRange"; key: string; from: Temporal.Instant; to: Temporal.Instant };

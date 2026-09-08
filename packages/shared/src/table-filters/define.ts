/**
 * The entry point: a table's filter semantics, compiled once and shared.
 *
 * Every engine goes through `defineFilters`, so a column's declared
 * `(type, kind)` pair is honoured identically in SQL, in memory and on the
 * client instead of being re-derived from whatever the value happened to look
 * like at runtime.
 */

import type { FilterOp, FilterSelection, FilterSpec } from "./types";

import { evaluateOp } from "./evaluate";
import { normalize } from "./normalize";
import { isActive } from "./values";

/** A row as TanStack Table hands it to a `filterFn`. */
interface FilterFnRow {
  getValue: (columnId: string) => unknown;
  original: unknown;
}

export type ColumnFilterFn = (row: FilterFnRow, columnId: string, value: unknown) => boolean;

export interface Filters {
  readonly specs: readonly FilterSpec[];

  /** One column's declaration. */
  spec(key: string): FilterSpec | undefined;

  /** Values → operations. Inactive and unknown keys are dropped. */
  plan(values: Record<string, unknown>, selection?: FilterSelection): FilterOp[];

  /** Does one row satisfy every active filter? */
  matches(values: Record<string, unknown>, row: unknown, selection?: FilterSelection): boolean;

  /** Narrow a whole collection. */
  apply<TRow>(
    rows: readonly TRow[],
    values: Record<string, unknown>,
    selection?: FilterSelection,
  ): TRow[];

  /**
   * A TanStack Table `filterFn` for one column, as a FUNCTION — so nothing has
   * to be registered by name on the table's feature set, a contract that breaks
   * silently the one time it is forgotten.
   */
  filterFn(key: string): ColumnFilterFn | undefined;

  /** Validate and clamp untrusted input (a hand-edited URL, an API caller). */
  coerce(raw: Record<string, unknown>): Record<string, unknown>;
}

function isSelected(key: string, selection?: FilterSelection): boolean {
  if (selection?.exclude?.includes(key)) return false;
  if (selection?.only && !selection.only.includes(key)) return false;
  return true;
}

/** Round-trip through `normalize`: what the declaration cannot use is not a value. */
function coerceValue(spec: FilterSpec, raw: unknown): unknown {
  const op = normalize(spec, raw);
  if (op === null) return undefined;

  switch (op.op) {
    case "substring":
    case "substringAny":
    case "equals":
      return op.value;
    case "oneOf":
    case "overlaps": {
      const allowed = spec.options;
      if (!allowed) return op.values;
      // Drop members outside the declared option set — a hand-edited URL (or an
      // API caller) will happily name an enum member that does not exist.
      const kept = op.values.filter((value) =>
        allowed.some((option) => String(option) === String(value)),
      );
      return kept.length > 0 ? kept : undefined;
    }
    case "numberRange": {
      // Clamp to the declared bounds. This is the untrusted-input door, and an
      // unbounded range is how a filter turns into a full table scan.
      const lower = spec.min ?? Number.NEGATIVE_INFINITY;
      const upper = spec.max ?? Number.POSITIVE_INFINITY;
      return [Math.min(Math.max(op.min, lower), upper), Math.min(Math.max(op.max, lower), upper)];
    }
    case "instantRange":
      return [op.from.epochMilliseconds, op.to.epochMilliseconds];
  }
}

/**
 * Build the one interpretation of a table's filter semantics.
 *
 * @example
 * ```ts
 * const filters = defineFilters([
 *   { key: "outcome", type: "checkbox", kind: "enum", options: ["success", "denied"] },
 *   { key: "at", type: "timerange", kind: "instant" },
 * ]);
 * filters.plan({ outcome: ["denied"] }) // → [{ op: "oneOf", key: "outcome", values: [...] }]
 * ```
 */
export function defineFilters(specs: readonly FilterSpec[]): Filters {
  const byKey = new Map(specs.map((spec) => [spec.key, spec]));

  const plan = (values: Record<string, unknown>, selection?: FilterSelection): FilterOp[] => {
    const ops: FilterOp[] = [];
    // Iterate the SPECS, not the values: the value bag is untrusted input, and
    // this way an unknown key cannot reach an engine at all.
    for (const spec of specs) {
      if (!isSelected(spec.key, selection)) continue;
      const op = normalize(spec, values[spec.key]);
      if (op !== null) ops.push(op);
    }
    return ops;
  };

  return {
    specs,

    spec: (key) => byKey.get(key),

    plan,

    matches: (values, row, selection) => plan(values, selection).every((op) => evaluateOp(op, row)),

    apply: (rows, values, selection) => {
      const ops = plan(values, selection);
      if (ops.length === 0) return [...rows];
      return rows.filter((row) => ops.every((op) => evaluateOp(op, row)));
    },

    filterFn: (key) => {
      const spec = byKey.get(key);
      if (!spec) return undefined;
      return (row, columnId, value) => {
        const op = normalize(spec, value);
        // A present-but-empty column filter matches everything, which is what
        // TanStack expects.
        if (op === null) return true;
        // A single-column operation reads the cell TanStack resolved (it may
        // come from an accessorFn with no matching row property);
        // `substringAny` spans columns, so it reads the record itself.
        if (op.op === "substringAny") return evaluateOp(op, row.original);
        return evaluateOp(op, { [columnId]: row.getValue(columnId) });
      };
    },

    coerce: (raw) => {
      const result: Record<string, unknown> = {};
      for (const spec of specs) {
        const value = raw[spec.key];
        if (!isActive(value)) continue;
        const coerced = coerceValue(spec, value);
        if (coerced !== undefined) result[spec.key] = coerced;
      }
      return result;
    },
  };
}

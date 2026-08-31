import * as z from "zod";

/** Filter state shared by the UI and the server-side SQL compiler. */
import type { CellKind } from "./value";

export const FILTER_OPS = [
  "eq",
  "ne",
  "gt",
  "lt",
  "gte",
  "lte",
  "contains",
  "notcontains",
  "startswith",
  "endswith",
  "in",
  "notin",
  "between",
  "isnull",
  "notnull",
] as const;

export type FilterOp = (typeof FILTER_OPS)[number];
export const filterOpSchema = z.enum(FILTER_OPS);

export const filterSchema = z.object({
  column: z.string().min(1).max(255),
  op: filterOpSchema,
  /** Operand text as typed; conversion uses the introspected column kind. */
  values: z.array(z.string()).max(200).default([]),
  /** An unchecked filter stays in the list and out of the query. */
  enabled: z.boolean().default(true),
});
export type Filter = z.infer<typeof filterSchema>;

export interface FilterOpMeta {
  label: string;
  /** `-1` means one or more operands. */
  arity: 0 | 1 | 2 | -1;
  group: "comparison" | "text" | "list" | "null" | "range";
}

export const FILTER_OP_META: Record<FilterOp, FilterOpMeta> = {
  eq: { label: "equals", arity: 1, group: "comparison" },
  ne: { label: "not equals", arity: 1, group: "comparison" },
  gt: { label: "greater than", arity: 1, group: "comparison" },
  lt: { label: "less than", arity: 1, group: "comparison" },
  gte: { label: "at least", arity: 1, group: "comparison" },
  lte: { label: "at most", arity: 1, group: "comparison" },
  contains: { label: "contains", arity: 1, group: "text" },
  notcontains: { label: "does not contain", arity: 1, group: "text" },
  startswith: { label: "starts with", arity: 1, group: "text" },
  endswith: { label: "ends with", arity: 1, group: "text" },
  in: { label: "is any of", arity: -1, group: "list" },
  notin: { label: "is none of", arity: -1, group: "list" },
  between: { label: "between", arity: 2, group: "range" },
  isnull: { label: "is null", arity: 0, group: "null" },
  notnull: { label: "is not null", arity: 0, group: "null" },
};

export const FILTER_OP_GROUPS = [
  { group: "comparison", label: "Comparison" },
  { group: "text", label: "Text" },
  { group: "range", label: "Range" },
  { group: "list", label: "List" },
  { group: "null", label: "Null checks" },
] as const;

export function isFilterComplete(filter: Filter): boolean {
  if (!filter.enabled || filter.column === "") return false;
  const { arity } = FILTER_OP_META[filter.op];
  if (arity === 0) return true;
  if (arity === -1) return filter.values.length > 0;
  return (
    filter.values.length >= arity && filter.values.slice(0, arity).every((value) => value !== "")
  );
}

export function enabledFilters(filters: readonly Filter[]): Filter[] {
  return filters.filter(isFilterComplete);
}

/** The introspected allowlist for identifiers and operand kinds. */
export interface ColumnLookup {
  kindOf(column: string): CellKind | undefined;
}

export function columnLookup(
  columns: ReadonlyArray<{ name: string; kind: CellKind }>,
): ColumnLookup {
  const byName = new Map(columns.map((column) => [column.name, column.kind]));
  return { kindOf: (column) => byName.get(column) };
}

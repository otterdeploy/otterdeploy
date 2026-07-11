/**
 * Filter model for the data viewer's table-browse mode. Filters compile to a
 * Postgres WHERE clause appended to the SELECT. Values are quoted as text and
 * rely on Postgres' implicit cast of unknown literals to the column type, with
 * single quotes escaped. Read-only query path, but we still quote identifiers +
 * escape values. A filter starts with NO column/operator selected — the user
 * picks both before it does anything.
 */

export type FilterOp =
  | "eq"
  | "ne"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "contains"
  | "notcontains"
  | "startswith"
  | "endswith"
  | "isnull"
  | "notnull";

/** A freshly-added filter has an empty column/op until the user picks them. */
export interface Filter {
  id: string;
  column: string;
  op: FilterOp | "";
  value: string;
  /** Checkbox toggle — an unchecked filter stays in the list but isn't applied. */
  enabled: boolean;
}

export const FILTER_OPS: { value: FilterOp; label: string; needsValue: boolean }[] = [
  { value: "eq", label: "equals (=)", needsValue: true },
  { value: "ne", label: "not equals (!=)", needsValue: true },
  { value: "gt", label: "greater than (>)", needsValue: true },
  { value: "lt", label: "less than (<)", needsValue: true },
  { value: "gte", label: "at least (>=)", needsValue: true },
  { value: "lte", label: "at most (<=)", needsValue: true },
  { value: "contains", label: "contains (LIKE)", needsValue: true },
  { value: "notcontains", label: "not contains (NOT LIKE)", needsValue: true },
  { value: "startswith", label: "starts with", needsValue: true },
  { value: "endswith", label: "ends with", needsValue: true },
  { value: "isnull", label: "is null (IS NULL)", needsValue: false },
  { value: "notnull", label: "is not null (IS NOT NULL)", needsValue: false },
];

export function opNeedsValue(op: FilterOp | ""): boolean {
  if (op === "") return false;
  return op !== "isnull" && op !== "notnull";
}

/** Ordering comparisons take a NUMBER (validated, emitted unquoted). */
export function isNumericOp(op: FilterOp | ""): boolean {
  return op === "gt" || op === "lt" || op === "gte" || op === "lte";
}

/** Strict numeric literal — what the numeric ops accept. Emitted verbatim into
 *  the SQL (regex-validated, so it can't carry an injection), which also keeps
 *  big integers exact where Number() would round. */
const NUMERIC_LITERAL = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function isValidNumericValue(value: string): boolean {
  return NUMERIC_LITERAL.test(value.trim());
}

const esc = (v: string) => v.replace(/'/g, "''");
const ident = (c: string) => `"${c.replace(/"/g, '""')}"`;

export function isFilterActive(f: Filter): boolean {
  if (!f.enabled || !f.column || !f.op) return false;
  if (!opNeedsValue(f.op)) return true;
  if (f.value === "") return false;
  // A numeric op with a non-numeric value never compiles into the WHERE.
  if (isNumericOp(f.op)) return isValidNumericValue(f.value);
  return true;
}

const NUMERIC_SQL_OP: Record<"gt" | "lt" | "gte" | "lte", string> = {
  gt: ">",
  lt: "<",
  gte: ">=",
  lte: "<=",
};

function clause(f: Filter): string {
  const col = ident(f.column);
  if (isNumericOp(f.op)) {
    // Guarded by isFilterActive → isValidNumericValue; the trimmed literal is
    // digits/sign/dot/exponent only.
    return `${col} ${NUMERIC_SQL_OP[f.op as "gt" | "lt" | "gte" | "lte"]} ${f.value.trim()}`;
  }
  switch (f.op) {
    case "isnull":
      return `${col} IS NULL`;
    case "notnull":
      return `${col} IS NOT NULL`;
    case "contains":
      return `${col}::text ILIKE '%${esc(f.value)}%'`;
    case "notcontains":
      return `${col}::text NOT ILIKE '%${esc(f.value)}%'`;
    case "startswith":
      return `${col}::text ILIKE '${esc(f.value)}%'`;
    case "endswith":
      return `${col}::text ILIKE '%${esc(f.value)}'`;
    case "ne":
      return `${col} <> '${esc(f.value)}'`;
    default:
      return `${col} = '${esc(f.value)}'`;
  }
}

/** Build the ` WHERE …` suffix (empty string when no active filters). */
export function buildWhere(filters: Filter[]): string {
  const parts = filters.filter(isFilterActive).map(clause);
  return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
}

/** A new, unconfigured filter row — no column or operator chosen yet. */
export function newFilter(): Filter {
  return { id: crypto.randomUUID(), column: "", op: "", value: "", enabled: true };
}

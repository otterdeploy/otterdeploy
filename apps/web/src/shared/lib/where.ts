import { IR } from "@tanstack/db";
import {
  extractFieldPath,
  extractValue,
  walkExpression,
} from "@tanstack/query-db-collection";

/**
 * A flat TanStack DB filter expression, as handed to a collection's `queryKey`
 * / `queryFn` via `LoadSubsetOptions.where`. It's the `PropRef | Value | Func`
 * union (no aggregates), accessed through the `IR` namespace since
 * `BasicExpression` isn't re-exported at the package root.
 */
export type WhereExpression = IR.BasicExpression<boolean>;

/**
 * Pulls the literal id value(s) a WHERE clause pins a given primary-key field
 * to. Handles the two point-lookup shapes TanStack DB emits:
 *
 *   eq(row.id, x)        → [x]
 *   inArray(row.id, [a]) → [a, b, …]   (func name `in`)
 *
 * Anything else — no constraint on `idField`, range comparisons (gt/lt),
 * functions over the field, etc. — contributes nothing. Because this walks the
 * whole tree, an OR across several ids still yields all of them. Values come
 * back in tree-walk order with duplicates preserved; the caller decides how to
 * collapse them.
 *
 * @param where    The filter expression, or undefined for an unfiltered subset.
 * @param idField  The exact (last-segment) field name that is the id, e.g. "resourceId".
 *
 * @example extractIdsFromWhere(where, "resourceId") // ["res_abc"]
 */
export function extractIdsFromWhere(
  where: WhereExpression | undefined,
  idField: string,
): Array<unknown> {
  const ids: Array<unknown> = [];

  walkExpression(where, (node) => {
    if (node.type !== "func") return;
    if (node.name !== "eq" && node.name !== "in") return;

    // Comparisons are binary: one arg is the field ref, the other the literal.
    const [left, right] = node.args;
    const field = extractFieldPath(left) ?? extractFieldPath(right);
    // "Exactly the primary key" — match on the leaf segment of the path.
    if (field?.at(-1) !== idField) return;

    // The value is whichever side wasn't the ref.
    const value = left.type === "ref" ? extractValue(right) : extractValue(left);
    if (value === undefined) return;

    if (node.name === "in") {
      // inArray's literal is the candidate list; flatten it in.
      if (Array.isArray(value)) ids.push(...value);
    } else {
      ids.push(value);
    }
  });

  return ids;
}

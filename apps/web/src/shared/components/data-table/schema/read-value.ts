/**
 * One reading of "what does this column hold for this row".
 *
 * The grid, the CSV export and the detail sheet all have to agree on it, and
 * they were each answering it themselves — three copies of the same two lines,
 * which is exactly how an export quietly stops matching the table it came from.
 */

import type { DataTableColumn } from "@/shared/components/data-table/schema/types";

/**
 * Read a key off a row without a type assertion.
 *
 * A dotted key ("timing.dns") is ONE column id, not a path: the server names
 * its columns, and splitting on the dot here would look for a nesting the row
 * does not have.
 */
function readKey(row: unknown, key: string): unknown {
  if (typeof row !== "object" || row === null) return undefined;
  return Object.hasOwn(row, key) ? Reflect.get(row, key) : undefined;
}

/** A column's value for a row: its own accessor if it declared one, else the key. */
export function columnValue<TRow>(column: DataTableColumn<TRow>, row: TRow): unknown {
  return column.accessor ? column.accessor(row) : readKey(row, column.key);
}

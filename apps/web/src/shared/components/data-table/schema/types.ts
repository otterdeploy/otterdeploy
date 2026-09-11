/**
 * One declaration per column, read by everything that needs to know about it.
 *
 * A column is described once — what it holds, how it reads, how it filters,
 * whether it sorts — and the generators turn that into TanStack column
 * definitions, the filter sidebar's controls, the command palette's grammar,
 * the row-detail fields, and the filter specs the server compiles to SQL. The
 * alternative, which this app had in fifteen places, is writing the same column
 * four times in four dialects and watching them drift.
 */

import type { ColKind, FilterSpec, FilterType, Scalar } from "@otterdeploy/shared/table-filters";

import type { ReactNode } from "react";

/**
 * How a cell reads. The split follows DESIGN.md's Two-Cuts Rule: anything a
 * person could paste into a terminal is mono, everything else is sans.
 */
export type Display =
  /** Sans, truncated, full value on hover. */
  | { type: "text" }
  /**
   * Mono — ids, hashes, paths, IPs, env keys.
   *
   * `tone` tints the text. Unlike `state` it carries no dot, and it does not
   * need one: the value IS the label. "GET", "404" and "DELETE" are read as
   * words, and the colour only says again, faster, what the word already says
   * — which is the line DESIGN.md's never-colour-alone rule actually draws.
   */
  | { type: "code"; tone?: (value: unknown) => BadgeTone }
  /** Mono, tabular figures, trailing-aligned, with an optional unit. */
  | { type: "number"; unit?: string }
  /** Relative ("3m ago") with the exact instant on hover. */
  | { type: "instant" }
  /** A wall clock, for feeds whose rows arrive seconds apart. */
  | { type: "clock" }
  /** A pill. `tone` maps a value to the semantic vocabulary. */
  | { type: "badge"; tone?: (value: unknown) => BadgeTone }
  /** A dot plus a label — state that never depends on colour alone. */
  | { type: "state"; tone: (value: unknown) => BadgeTone }
  /** The number beside a proportional bar. */
  | { type: "bar"; min?: number; max?: number; unit?: string }
  /** A check or a dash. */
  | { type: "boolean" };

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

/** How a column is filtered, if it is. */
export interface FilterDeclaration {
  type: FilterType;
  /** Checkbox options. Server facets fill this in when it is omitted. */
  options?: readonly { label: string; value: Scalar }[];
  /**
   * Render an option in the sidebar.
   *
   * The facet only knows the raw value, so a column whose values READ as
   * something richer — a country code as a flag, a status code with its band —
   * says so here. The plain label is still what the option search matches on,
   * because a reader types "US", not an emoji.
   */
  optionLabel?: (value: Scalar) => ReactNode;
  /** Slider bounds. */
  min?: number;
  max?: number;
  /** Columns a `search` spans. */
  keys?: readonly string[];
  /** Open in the filter sidebar without being asked. */
  defaultOpen?: boolean;
  /** Hidden from the command palette (a timerange reads better as a picker). */
  commandDisabled?: boolean;
}

export interface DataTableColumn<TRow> {
  /**
   * The one identity space: the column id, the URL parameter, the facet key
   * and the server's column-map key are all this string.
   */
  key: string;
  label: string;
  /** How values COMPARE. Drives filter semantics, not rendering. */
  kind: ColKind;
  /** Item family when `kind` is `"array"`. */
  itemKind?: ColKind;
  /** How the value READS. Defaults by kind. */
  display?: Display;
  /** Read the value when it is not a plain property of the row. */
  accessor?: (row: TRow) => unknown;
  /** Full control of the cell. Overrides `display`. */
  cell?: (context: { value: unknown; row: TRow }) => ReactNode;
  filter?: FilterDeclaration;
  sortable?: boolean;
  /** Fixed width in px. Without one the column flexes. */
  width?: number;
  /** Floor for a flexing column. */
  minWidth?: number;
  resizable?: boolean;
  /** Hidden by default; still in the column menu. */
  hidden?: boolean;
  /**
   * A filter, not a column: it appears in the sidebar or the toolbar and never
   * in the grid or the detail sheet.
   *
   * The table-wide search is the case this exists for — it spans several
   * columns, so it is not one of them, but it is still declared here so its
   * semantics live beside everything else's.
   */
  filterOnly?: boolean;
  /** Cannot be hidden — the select gutter and the row-actions column. */
  alwaysVisible?: boolean;
  /**
   * Show in the row-detail sheet. `false` keeps it out; an object overrides how
   * it renders there. Defaults to shown for every non-gutter column.
   */
  sheet?:
    | false
    | {
        label?: string;
        render?: (row: TRow) => ReactNode;
        /**
         * The value is a BLOCK — a pre, a table of headers, a stack trace.
         *
         * Those do not belong in the label/value/copy row the other fields
         * share: a 140px-tall block in a 180px column, with its label floating
         * at the block's baseline, reads as a broken row rather than as a
         * field. A block field puts its label above and takes the full width.
         */
        block?: boolean;
      };
  headerClassName?: string;
  cellClassName?: string;
}

/** The default display for a kind, when a column does not name one. */
export function defaultDisplay(kind: ColKind): Display {
  switch (kind) {
    case "number":
      return { type: "number" };
    case "instant":
      return { type: "instant" };
    case "boolean":
      return { type: "boolean" };
    case "enum":
    case "array":
      return { type: "badge" };
    case "string":
      return { type: "text" };
  }
}

/**
 * The filter specs for a schema — the exact shape the server compiles.
 *
 * Generated from the same declaration the UI renders from, so a filter cannot
 * mean one thing in the sidebar and another in the WHERE clause. Pass
 * `timeZone` names the zone a lone date is bounded in. Pass `LOG_ZONE`: it has
 * to match the zone the rows PRINT in, or a picked day selects rows the table
 * labels as the day before.
 */
export function toFilterSpecs<TRow>(
  columns: readonly DataTableColumn<TRow>[],
  timeZone?: string,
): FilterSpec[] {
  const specs: FilterSpec[] = [];
  for (const column of columns) {
    const declared = column.filter;
    if (!declared) continue;
    specs.push({
      key: column.key,
      type: declared.type,
      kind: column.kind,
      ...(column.itemKind ? { itemKind: column.itemKind } : {}),
      ...(declared.keys ? { keys: declared.keys } : {}),
      ...(declared.options ? { options: declared.options.map((option) => option.value) } : {}),
      ...(declared.min === undefined ? {} : { min: declared.min }),
      ...(declared.max === undefined ? {} : { max: declared.max }),
      ...(declared.type === "timerange" && timeZone ? { timeZone } : {}),
    });
  }
  return specs;
}

/** Column keys that start hidden — the initial visibility state. */
export function defaultColumnVisibility<TRow>(
  columns: readonly DataTableColumn<TRow>[],
): Record<string, boolean> {
  const visibility: Record<string, boolean> = {};
  for (const column of columns) {
    if (column.hidden) visibility[column.key] = false;
  }
  return visibility;
}

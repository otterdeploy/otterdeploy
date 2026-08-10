/**
 * Layout primitives: section headers, tables, detail blocks and trees.
 *
 * These are the only things in the CLI that decide where a character lands.
 * Commands describe *what* they know; nothing outside this module calls
 * `padEnd`, counts columns, or draws a box-drawing character by hand.
 *
 * The shapes are borrowed from bd: bold uppercase section headers, a two-space
 * indent under each, dim column headers, and `├──`/`└──` for nesting. What is
 * deliberately *not* borrowed is bd's fixed-width padding. Every table here
 * measures its own content, so a long service name widens the column instead of
 * shearing the row.
 */

import { G } from "./glyphs";
import { out } from "./stream";
import { bold, dim, padEnd, padStart, width } from "./theme";

/** Two spaces, so every block sits under its header the same way. */
const INDENT = "  ";
/** Gutter between table columns. Two spaces reads as one column break. */
const GUTTER = "  ";

/**
 * A bold uppercase section header preceded by a blank line, e.g. `DEPLOYMENTS`.
 * Uppercase rather than title case so headers never compete with content for
 * attention: they are landmarks, not headlines.
 */
export function section(title: string): void {
  out();
  out(bold(title.toUpperCase()));
  out();
}

export interface Column {
  header: string;
  /** Right-align numerics and durations so digits line up on the decimal. */
  align?: "left" | "right";
}

/**
 * A self-measuring table. Cells may already be painted. Widths are computed on
 * printable width, so colour never shifts a column.
 *
 * Trailing empty cells are trimmed rather than padded, which keeps a mostly
 * empty last column (an error message, say) from leaving a ragged right edge.
 */
export function table(columns: Column[], rows: string[][]): void {
  if (rows.length === 0) return;
  const widths = columns.map((col, i) =>
    Math.max(width(col.header), ...rows.map((row) => width(row[i] ?? ""))),
  );

  const renderRow = (cells: string[], paintCell: (text: string) => string): string => {
    // Find the last cell with content so the line can stop there.
    let last = cells.length - 1;
    while (last > 0 && width(cells[last] ?? "") === 0) last -= 1;
    const parts = cells.slice(0, last + 1).map((cell, i) => {
      const text = paintCell(cell);
      // The final column needs no padding, nothing follows it.
      if (i === last) return text;
      const target = widths[i] ?? 0;
      return columns[i]?.align === "right" ? padStart(text, target) : padEnd(text, target);
    });
    return INDENT + parts.join(GUTTER);
  };

  out(
    renderRow(
      columns.map((c) => c.header.toUpperCase()),
      dim,
    ),
  );
  for (const row of rows) out(renderRow(row, (text) => text));
}

/**
 * An aligned label/value block for a single subject:
 *
 * ```
 *   domain   app.example.com
 *   status   ● enabled
 * ```
 *
 * Labels are dim and lowercase: they are the schema, the values are the news.
 */
export function detail(pairs: Array<[string, string]>): void {
  const visible = pairs.filter(([, value]) => value !== "");
  if (visible.length === 0) return;
  const labelWidth = Math.max(...visible.map(([label]) => label.length));
  for (const [label, value] of visible) {
    out(`${INDENT}${dim(padEnd(label, labelWidth))}${GUTTER}${value}`);
  }
}

export interface TreeNode {
  label: string;
  children?: TreeNode[];
}

/**
 * One scannable line about one thing, in bd's row grammar:
 * `<glyph> <subject> <badge> <title> ← <context>`.
 *
 * Passing pre-painted fragments is intentional. The caller knows which piece
 * is an id and which is a state; this only assembles and trims.
 */
export function row(parts: Array<string | undefined>): void {
  out(INDENT + parts.filter((p) => p !== undefined && p !== "").join(" "));
}

/** A plain indented line, for prose that belongs under a section. */
export function line(text = ""): void {
  out(text === "" ? "" : INDENT + text);
}

/**
 * A block set off by a left hairline rule, for the rare thing that must not be
 * skimmed past: a device-verification code, a destructive confirmation.
 *
 * Deliberately *not* a four-sided box. A box has to know its own width, so a
 * long URL either overflows the right edge or gets wrapped mid-token; a left
 * rule degrades cleanly at any terminal width and matches DESIGN.md's
 * flat-with-a-hairline register rather than drawing a container.
 */
export function panel(lines: string[]): void {
  out();
  for (const text of lines) {
    out(`${INDENT}${dim(G.vertical)} ${text}`);
  }
  out();
}

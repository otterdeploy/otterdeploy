/**
 * Pure form → `data.mutate(op: "insert")` translation for the Add-record modal.
 *
 * The modal collects one draft string per column; these helpers decide which
 * columns actually go into the INSERT's `set` and validate the draft first.
 * Rules (mirroring the reference viewer):
 * - auto-generated columns (identity / serial) are never sent. "auto";
 * - an untouched/empty field is OMITTED, so the column takes its DEFAULT or
 *   NULL server-side (typing is always explicit, never an accidental '');
 * - the literal NULL sentinel (boolean select's "null" option) sends SQL NULL;
 * - everything else is PARSED into the column's declared kind before it is
 *   sent. The predecessor shipped every field as text and let the server cast
 *   the unknown literal, which meant "12x" in an integer column reached the
 *   database before anyone said it was wrong.
 */

import type { CellKind, CellValue } from "@otterdeploy/data-engine";

import { parseCell } from "@otterdeploy/data-engine";

import type { ColumnValue } from "../components/dice-grid";
import type { StructureColumn } from "./structure";

/** Sentinel a control uses to say "explicit SQL NULL" (vs empty = omit).
 *  Starts with NUL so no typed text value can ever collide with it. */
export const NULL_SENTINEL = "\u0000null";

export interface InsertIssue {
  column: string;
  reason: "required" | "invalid-json" | "invalid-number" | "invalid-value";
}

/** Draft values keyed by column name; absent/empty = untouched. */
export type InsertDraft = Record<string, string | undefined>;

/**
 * Validate one field by PARSING it into the column's declared kind.
 *
 * One check replaces the per-shape ones the predecessor had (a try/catch around
 * `JSON.parse`, an `isFinite` for numbers, nothing at all for dates): if the
 * text does not parse into the kind, it is not a valid value for that column.
 */
function issueFor(col: StructureColumn, kind: CellKind, raw: string): InsertIssue | null {
  if (parseCell(raw, kind) !== undefined) return null;
  if (kind === "json") return { column: col.name, reason: "invalid-json" };
  if (kind === "number" || kind === "bigint" || kind === "decimal") {
    return { column: col.name, reason: "invalid-number" };
  }
  return { column: col.name, reason: "invalid-value" };
}

/** Validate a draft against the table's columns. Empty array = submittable. */
export function validateInsertDraft(
  columns: StructureColumn[],
  kinds: Record<string, CellKind>,
  draft: InsertDraft,
): InsertIssue[] {
  const issues: InsertIssue[] = [];
  for (const col of columns) {
    if (col.isAuto) continue;
    const raw = draft[col.name];
    const empty = raw === undefined || raw === "";
    if (empty) {
      if (col.isRequired) issues.push({ column: col.name, reason: "required" });
      continue;
    }
    if (raw === NULL_SENTINEL) continue;
    const issue = issueFor(col, kinds[col.name] ?? "text", raw);
    if (issue) issues.push(issue);
  }
  return issues;
}

/** Build the `set` payload for `data.mutate(op: "insert")` from a valid draft. */
export function buildInsertSet(
  columns: StructureColumn[],
  kinds: Record<string, CellKind>,
  draft: InsertDraft,
): ColumnValue[] {
  const set: ColumnValue[] = [];
  for (const col of columns) {
    if (col.isAuto) continue;
    const raw = draft[col.name];
    if (raw === undefined || raw === "") continue; // omitted → DEFAULT / NULL
    if (raw === NULL_SENTINEL) {
      set.push({ column: col.name, value: null });
      continue;
    }
    const kind = kinds[col.name] ?? "text";
    const parsed: CellValue = parseCell(raw, kind) ?? { k: "text", v: raw };
    set.push({ column: col.name, value: parsed });
  }
  return set;
}

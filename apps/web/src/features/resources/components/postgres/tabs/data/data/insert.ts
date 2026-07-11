/**
 * Pure form → `mutateRow(op: "insert")` translation for the Add-record modal.
 *
 * The modal collects one draft string per column; these helpers decide which
 * columns actually go into the INSERT's `set` and validate the draft first.
 * Rules (mirroring the reference viewer):
 * - auto-generated columns (identity / serial) are never sent — "auto";
 * - an untouched/empty field is OMITTED, so the column takes its DEFAULT or
 *   NULL server-side (typing is always explicit, never an accidental '');
 * - the literal NULL sentinel (boolean select's "null" option) sends SQL NULL;
 * - everything else is sent as text — the server's parameterized builder casts
 *   the unknown literal to the column type (same discipline as inline edits).
 */

import type { ColumnValue } from "../components/dice-grid";
import type { StructureColumn } from "./structure";

import { columnInputKind } from "./structure";

/** Sentinel a control uses to say "explicit SQL NULL" (vs empty = omit).
 *  Starts with NUL so no typed text value can ever collide with it. */
export const NULL_SENTINEL = "\u0000null";

export interface InsertIssue {
  column: string;
  reason: "required" | "invalid-json" | "invalid-number";
}

/** Draft values keyed by column name; absent/empty = untouched. */
export type InsertDraft = Record<string, string | undefined>;

function issueFor(col: StructureColumn, raw: string): InsertIssue | null {
  const kind = columnInputKind(col.dataType);
  if (kind === "json") {
    try {
      JSON.parse(raw);
    } catch {
      return { column: col.name, reason: "invalid-json" };
    }
  }
  if (kind === "number" && !Number.isFinite(Number(raw.trim()))) {
    return { column: col.name, reason: "invalid-number" };
  }
  return null;
}

/** Validate a draft against the table's columns. Empty array = submittable. */
export function validateInsertDraft(columns: StructureColumn[], draft: InsertDraft): InsertIssue[] {
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
    const issue = issueFor(col, raw);
    if (issue) issues.push(issue);
  }
  return issues;
}

/** Build the `set` payload for `mutateRow(op: "insert")` from a valid draft. */
export function buildInsertSet(columns: StructureColumn[], draft: InsertDraft): ColumnValue[] {
  const set: ColumnValue[] = [];
  for (const col of columns) {
    if (col.isAuto) continue;
    const raw = draft[col.name];
    if (raw === undefined || raw === "") continue; // omitted → DEFAULT / NULL
    set.push({ column: col.name, value: raw === NULL_SENTINEL ? null : raw });
  }
  return set;
}

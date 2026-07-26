/**
 * Rendering for manifest diffs — what `deploy --dry-run`, `sync --preview` and
 * `status` all print.
 *
 * The diff marks are the ones every developer already knows from `git diff` and
 * `terraform plan`: `+` create, `-` delete, `~` update, `·` unchanged. Colour
 * follows the mark rather than replacing it, so a piped or `NO_COLOR` diff still
 * reads correctly.
 *
 * Deletes are the reason this renders as a table rather than prose: a change set
 * that will destroy a database should be visually separable from one that only
 * adds a service, at a glance, before the confirmation prompt.
 */

import type { Role } from "./ui";

import { detail, dim, G, note, paint, strong, table } from "./ui";

export interface Change {
  kind: string;
  resource: string;
  name: string;
  details?: unknown;
}

/** Longest detail blob worth inlining; past this it's noise, not information. */
const MAX_DETAIL_LENGTH = 200;

const MARKS: Record<string, { mark: string; role: Role }> = {
  create: { mark: G.add, role: "ok" },
  delete: { mark: G.remove, role: "danger" },
  update: { mark: G.change, role: "warn" },
};

function markOf(kind: string): { mark: string; role: Role } {
  return MARKS[kind] ?? { mark: G.retired, role: "muted" };
}

export function printDiff(changes: Change[]): void {
  if (changes.length === 0) {
    note("In sync — no changes.");
    return;
  }

  const rows: string[][] = [];
  for (const change of changes) {
    const { mark, role } = markOf(change.kind);
    rows.push([strong(role, mark), dim(change.resource), paint(role, change.name)]);
    // Details land on their own indented line rather than a fourth column: they
    // are JSON of wildly varying length and would otherwise set the table width.
    const summary = change.details === undefined ? "" : JSON.stringify(change.details);
    if (summary !== "" && summary.length < MAX_DETAIL_LENGTH) {
      rows.push(["", "", dim(summary)]);
    }
  }

  table([{ header: "" }, { header: "" }, { header: "" }], rows);
}

export function countByKind(changes: Change[]): Record<string, number> {
  return changes.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] ?? 0) + 1;
    return acc;
  }, {});
}

/**
 * A one-line tally — `3 to create, 1 to update, 1 to delete` — so the reader
 * gets the shape of a change set before scanning it. Deletes are always named
 * last and in the destructive colour, because that is the part worth a pause.
 */
export function summarizeChanges(changes: Change[]): string {
  const counts = countByKind(changes);
  const parts: string[] = [];
  for (const kind of ["create", "update", "delete"]) {
    const n = counts[kind];
    if (!n) continue;
    const { role } = markOf(kind);
    parts.push(paint(role, `${n} to ${kind}`));
  }
  return parts.length > 0 ? parts.join(dim(` ${G.sep} `)) : dim("no changes");
}

/** The tally rendered as its own labelled line, for use under a section. */
export function printChangeSummary(changes: Change[]): void {
  detail([["changes", summarizeChanges(changes)]]);
}

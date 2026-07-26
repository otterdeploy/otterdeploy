/**
 * Row multi-select for inventory tables (volumes, Docker images, networks) —
 * the selection state, the header/row checkboxes, and the action bar that
 * appears once something is selected.
 *
 * Deliberately NOT a full data-grid: these tables render plain <Table> markup
 * and each owns its own columns. This gives them selection without asking them
 * to adopt a grid abstraction.
 *
 * Bulk destructive actions here are a CLIENT-SIDE FAN-OUT over the existing
 * single-item endpoints ({@link runBulk}), not a bulk API call. Removing infra
 * is partial-failure by nature — an in-use volume fails with IN_USE while its
 * neighbours succeed — and fanning out per item is what lets the UI report
 * "3 removed · 1 skipped" instead of collapsing to one all-or-nothing result.
 */

import { useMemo, useState, type ReactNode } from "react";

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AnimatePresence, useReducedMotion, type Transition } from "motion/react";
import * as m from "motion/react-client";

import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { TableCell, TableHead } from "@/shared/components/ui/table";

export interface TableSelection<T> {
  /** Keys currently selected — may include rows no longer present. */
  selected: ReadonlySet<string>;
  /** Selected rows, in the order they appear in `rows`. */
  selectedRows: T[];
  count: number;
  isSelected: (row: T) => boolean;
  toggle: (row: T) => void;
  /** Select every row in `rows`, or clear if all are already selected. */
  toggleAll: () => void;
  clear: () => void;
  allSelected: boolean;
  someSelected: boolean;
}

/**
 * Selection state keyed by a stable per-row id.
 *
 * `rows` is the FULL list, not the visible page: selecting rows, paging away
 * and paging back must not silently drop them. Selected keys that vanish from
 * `rows` (a poll removed them, a filter changed) are ignored when deriving
 * `selectedRows` rather than pruned from state, so a transient refetch gap
 * can't wipe a selection mid-interaction.
 */
export function useTableSelection<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  options?: {
    /**
     * Rows that select-all should pick up. Defaults to everything.
     *
     * This is ONLY for rows that can categorically never be actioned — a
     * built-in Docker network, say. It is NOT for rows the client merely
     * believes are busy: an in-use volume stays in select-all, because the
     * daemon decides that and a ref-count read seconds ago may be stale.
     * Rows excluded here remain individually selectable; they're just not
     * swept up by "select all", so the common path doesn't queue guaranteed
     * failures every time.
     */
    bulkEligible?: (row: T) => boolean;
  },
): TableSelection<T> {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const eligible = options?.bulkEligible ?? (() => true);

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(keyOf(row))),
    // keyOf is defined inline at every call site; depending on it would rebuild
    // this every render. rows + selected are what actually change the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, selected],
  );

  const toggle = (row: T) => {
    const key = keyOf(row);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // "All" means all ELIGIBLE rows — the checkbox reads as checked once every
  // row select-all would have picked is picked, not only when ineligible rows
  // have also been ticked by hand.
  const eligibleRows = rows.filter(eligible);
  const allSelected =
    eligibleRows.length > 0 && eligibleRows.every((row) => selected.has(keyOf(row)));

  const toggleAll = () =>
    setSelected(() => (allSelected ? new Set() : new Set(eligibleRows.map(keyOf))));

  return {
    selected,
    selectedRows,
    count: selectedRows.length,
    isSelected: (row) => selected.has(keyOf(row)),
    toggle,
    toggleAll,
    clear: () => setSelected(new Set()),
    allSelected,
    someSelected: selectedRows.length > 0 && !allSelected,
  };
}

/** Header cell holding the select-all checkbox. Render as the first column. */
export function SelectAllHead<T>({ selection }: { selection: TableSelection<T> }) {
  return (
    <TableHead className="w-10 pl-4">
      <Checkbox
        checked={selection.allSelected}
        indeterminate={selection.someSelected}
        onCheckedChange={() => selection.toggleAll()}
        aria-label={selection.allSelected ? "Deselect all" : "Select all"}
      />
    </TableHead>
  );
}

/** Row cell holding that row's checkbox. Render as the first cell. */
export function SelectRowCell<T>({
  selection,
  row,
  label,
}: {
  selection: TableSelection<T>;
  row: T;
  /** Names the row for screen readers, e.g. the volume name. */
  label: string;
}) {
  return (
    <TableCell className="w-10 pl-4">
      <Checkbox
        checked={selection.isSelected(row)}
        onCheckedChange={() => selection.toggle(row)}
        aria-label={`Select ${label}`}
      />
    </TableCell>
  );
}

/**
 * Floating action bar — appears pinned above the viewport's bottom edge once
 * rows are selected, and slides away when the selection empties.
 *
 * Floating rather than inline above the table on purpose: these inventories run
 * to hundreds of rows, and an inline bar scrolls out of view exactly when a
 * multi-page selection is in progress. Deliberately mirrors the shape and
 * motion of `PendingChangesBar` on the graph so the app has one vocabulary for
 * "you have staged something; here's how to commit or drop it".
 *
 * Rows the client believes are undeletable are still selectable — the daemon is
 * the authority on whether a remove succeeds, and a stale ref-count would
 * otherwise block a delete that would have worked. Outcomes are reported after
 * the fact by {@link runBulk}.
 */
export function SelectionBar<T>({
  selection,
  noun,
  actionLabel,
  onAction,
  pending,
}: {
  selection: TableSelection<T>;
  /** Singular noun for the count, e.g. "volume". */
  noun: string;
  /**
   * The bare verb — "Remove", "Archive". Deliberately NOT "Remove 8": the
   * count is already stated by the label to its left, and repeating it inside
   * the button reads as though the number were part of the action's name. The
   * confirm dialog does restate it ("Remove 8 volumes"), because that step is
   * irreversible and worth spelling out.
   */
  actionLabel: string;
  onAction: () => void;
  pending: boolean;
}) {
  // Framer's JS animations aren't covered by the CSS prefers-reduced-motion
  // reset, so collapse to instant ourselves — same as PendingChangesBar.
  const reduce = useReducedMotion();
  const transition: Transition = reduce
    ? { duration: 0 }
    : { type: "spring", stiffness: 420, damping: 34 };

  return (
    <AnimatePresence>
      {selection.count > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-3">
          <m.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={transition}
            role="status"
            className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border bg-popover/95 py-1.5 pr-1.5 pl-4 shadow-lg backdrop-blur-md sm:gap-3"
          >
            <span className="truncate text-[13px] font-medium">
              {selection.count} {noun}
              {selection.count === 1 ? "" : "s"} selected
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 rounded-full text-[12px]"
              onClick={selection.clear}
              disabled={pending}
            >
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-7 shrink-0 gap-1.5 rounded-full text-[12px]"
              onClick={onAction}
              disabled={pending}
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
              {pending ? "Working…" : actionLabel}
            </Button>
          </m.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export interface BulkOutcome<T> {
  ok: T[];
  failed: Array<{ row: T; reason: string }>;
}

/**
 * Run `fn` over every item and collect per-item outcomes instead of aborting on
 * the first rejection.
 *
 * SEQUENTIAL on purpose. These call the Docker daemon, which serialises this
 * work anyway; firing twenty concurrent removes buys nothing and makes the
 * daemon's own errors harder to attribute. It also keeps the eventual refetch
 * to one, after everything has settled.
 */
export async function runBulk<T>(
  items: readonly T[],
  fn: (item: T) => Promise<unknown>,
): Promise<BulkOutcome<T>> {
  const out: BulkOutcome<T> = { ok: [], failed: [] };
  for (const item of items) {
    try {
      await fn(item);
      out.ok.push(item);
    } catch (err) {
      out.failed.push({ row: item, reason: reasonOf(err) });
    }
  }
  return out;
}

function reasonOf(err: unknown): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { reason?: unknown } }).data;
    if (data && typeof data.reason === "string") return data.reason;
  }
  return err instanceof Error ? err.message : "Failed";
}

/**
 * One-line summary of a bulk run, for a toast. Names the first failure's reason
 * so "1 skipped" is never a dead end the operator has to go re-derive.
 */
export function summarizeBulk<T>(outcome: BulkOutcome<T>, noun: string): {
  message: string;
  tone: "success" | "warning" | "error";
} {
  const okCount = outcome.ok.length;
  const failCount = outcome.failed.length;
  const plural = (n: number) => `${n} ${noun}${n === 1 ? "" : "s"}`;

  if (failCount === 0) return { message: `Removed ${plural(okCount)}`, tone: "success" };
  if (okCount === 0) {
    return {
      message: `Couldn't remove ${plural(failCount)} — ${outcome.failed[0]?.reason ?? "failed"}`,
      tone: "error",
    };
  }
  return {
    message: `Removed ${plural(okCount)} · ${failCount} skipped — ${outcome.failed[0]?.reason ?? "failed"}`,
    tone: "warning",
  };
}

/** Renders the failed rows as a list, for the confirm dialog's aftermath. */
export function FailedList<T>({
  failed,
  labelOf,
}: {
  failed: BulkOutcome<T>["failed"];
  labelOf: (row: T) => string;
}): ReactNode {
  if (failed.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {failed.map(({ row, reason }) => (
        <li key={labelOf(row)} className="text-[12px] [overflow-wrap:anywhere]">
          <span className="font-mono">{labelOf(row)}</span>
          <span className="text-muted-foreground"> — {reason}</span>
        </li>
      ))}
    </ul>
  );
}

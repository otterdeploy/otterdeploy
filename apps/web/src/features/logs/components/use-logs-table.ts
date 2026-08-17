/**
 * Builds the TanStack Table + virtualizer for the logs route from the live tail
 * and the URL-driven filters. This is pure view wiring (filtering, sorting,
 * windowing, follow-the-tail) on top of `useProjectLogStream`: the stream read
 * itself is untouched and still owned by that hook.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";

import type { TimeRange } from "./logs-histogram";

import { useProjectLogStream, type LogLevel } from "../data/use-project-log-stream";
import { makeLogColumns } from "./log-columns";

interface UseLogsTableArgs {
  projectId: string;
  svcFilter: string;
  lvlFilter: Set<LogLevel>;
  query: string;
  timeRange: TimeRange | null;
  paused: boolean;
}

export function useLogsTable({
  projectId,
  svcFilter,
  lvlFilter,
  query,
  timeRange,
  paused,
}: UseLogsTableArgs) {
  const { t } = useTranslation();
  // Rebuilt when the language changes so the columns' aria-labels follow it.
  const columns = useMemo(() => makeLogColumns(t), [t]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // Live tail sticks to the bottom until the operator scrolls up (or sorts).
  const [follow, setFollow] = useState(true);
  const [prevIsDefaultSort, setPrevIsDefaultSort] = useState(true);

  const subscribedIds = useMemo(() => (svcFilter === "all" ? undefined : [svcFilter]), [svcFilter]);
  const { lines, status } = useProjectLogStream({
    projectId,
    resourceIds: subscribedIds,
    paused,
  });

  // Everything except the time window: drives the histogram so all buckets
  // stay visible (and clickable) even when one is selected.
  const filteredByMeta = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // msgLower is precomputed at ingest, no per-pass string allocation.
    return lines.filter((l) => lvlFilter.has(l.level) && (!needle || l.msgLower.includes(needle)));
  }, [lines, lvlFilter, query]);

  // The table additionally honors the selected histogram bucket.
  const filtered = useMemo(() => {
    if (!timeRange) return filteredByMeta;
    return filteredByMeta.filter(
      (l) => l.tsMs != null && l.tsMs >= timeRange.from && l.tsMs < timeRange.to,
    );
  }, [filteredByMeta, timeRange]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.id,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const isDefaultSort = sorting.length === 0;

  // Key virtual rows by row id, NOT index (the default). The live tail is a
  // capped ring: once the buffer trims, every append shifts all indices, so
  // index keys would remap React's DOM nodes across rows on every append;
  // stable ids keep each rendered row glued to its line. Read the live rows
  // through a ref so the callback keeps ONE identity across renders (a fresh
  // closure each render, closing over the new `rows` array, would churn the
  // virtualizer's memoized options every frame).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const getItemKey = useCallback((index: number) => rowsRef.current[index]?.id ?? index, []);

  // The scroll element lives in STATE, not a ref, and reaches the view as a
  // callback ref. This is the deterministic-attach pattern for a scroll
  // container that mounts AFTER the virtualizer hook runs (ours renders
  // inside a Tabs panel): a plain useRef populates without re-rendering, so
  // whether the virtualizer ever re-observed the element depended on an
  // unrelated render happening at the right moment. When it lost that race
  // its scroll listener stayed dead and it rendered the range for offset 0
  // forever (the "blank table, everything at the top" wedge). A state setter
  // forces the re-render, and the null→element transition makes the
  // virtualizer re-observe every time.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    // Real row height: py-1 (8px) + text-xs line height (16px) + border-b
    // (1px) = 25px. The old 28px estimate left ~3px of phantom height per
    // unmeasured row: a visible blank band at a few hundred rows.
    estimateSize: () => 25,
    overscan: 24,
    getItemKey,
  });

  // Sorting fights live tailing. Pause follow while a sort is active. Adjust
  // in render (prev-value compare) rather than an effect so it doesn't trigger
  // an extra render pass each time a sort turns on.
  if (prevIsDefaultSort !== isDefaultSort) {
    setPrevIsDefaultSort(isDefaultSort);
    if (!isDefaultSort) setFollow(false);
  }

  // Stick to bottom on new rows while following the live tail. A time-window
  // filter means we're inspecting history, so don't yank to the bottom.
  //
  // Deliberately NOT virtualizer.scrollToIndex: that writes the element's
  // scrollTop through the virtualizer's own model, and on first mount (or a
  // Tabs remount of the scroll div under a surviving virtualizer instance)
  // the model can lag the element. It kept rendering the range for offset 0
  // while its own scroll write parked the viewport at the bottom, leaving the
  // whole viewport row-free ("blank space above the rows"). Setting scrollTop
  // from the element's real scrollHeight is self-healing: the resulting
  // scroll event feeds the virtualizer the truth no matter what state its
  // model is in.
  useEffect(() => {
    if (!follow || !isDefaultSort || paused || timeRange || rows.length === 0) return;
    // scrollEl in the deps also makes this fire when the element mounts, so
    // the very first paint of a fresh page lands at the bottom.
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }, [rows.length, follow, isDefaultSort, paused, timeRange, scrollEl]);

  const selectedCount = Object.keys(rowSelection).length;

  return {
    table,
    rows,
    virtualizer,
    // Callback ref: the view attaches it to the scroll div (see scrollEl).
    scrollRef: setScrollEl,
    status,
    lines,
    filteredByMeta,
    filtered,
    isDefaultSort,
    follow,
    setFollow,
    selectedCount,
  };
}

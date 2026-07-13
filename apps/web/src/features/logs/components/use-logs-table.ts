/**
 * Builds the TanStack Table + virtualizer for the logs route from the live tail
 * and the URL-driven filters. This is pure view wiring (filtering, sorting,
 * windowing, follow-the-tail) on top of `useProjectLogStream` — the stream read
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

import type { TimeRange } from "./logs-histogram";

import { useProjectLogStream, type LogLevel } from "../data/use-project-log-stream";
import { logColumns } from "./log-columns";

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

  // Everything except the time window — drives the histogram so all buckets
  // stay visible (and clickable) even when one is selected.
  const filteredByMeta = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lines.filter(
      (l) => lvlFilter.has(l.level) && (!needle || l.msg.toLowerCase().includes(needle)),
    );
  }, [lines, lvlFilter, query]);

  // The table additionally honors the selected histogram bucket.
  const filtered = useMemo(() => {
    if (!timeRange) return filteredByMeta;
    return filteredByMeta.filter((l) => {
      const ms = l.tsIso ? Date.parse(l.tsIso) : NaN;
      return !Number.isNaN(ms) && ms >= timeRange.from && ms < timeRange.to;
    });
  }, [filteredByMeta, timeRange]);

  const table = useReactTable({
    data: filtered,
    columns: logColumns,
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
  // capped ring — once the buffer trims, every append shifts all indices, so
  // index keys would remap React's DOM nodes across rows on every append;
  // stable ids keep each rendered row glued to its line. Read the live rows
  // through a ref so the callback keeps ONE identity across renders (a fresh
  // closure each render, closing over the new `rows` array, would churn the
  // virtualizer's memoized options every frame).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const getItemKey = useCallback((index: number) => rowsRef.current[index]?.id ?? index, []);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 24,
    getItemKey,
  });

  // Sorting fights live tailing — pause follow while a sort is active. Adjust
  // in render (prev-value compare) rather than an effect so it doesn't trigger
  // an extra render pass each time a sort turns on.
  if (prevIsDefaultSort !== isDefaultSort) {
    setPrevIsDefaultSort(isDefaultSort);
    if (!isDefaultSort) setFollow(false);
  }

  // Stick to bottom on new rows while following the live tail. A time-window
  // filter means we're inspecting history, so don't yank to the bottom.
  useEffect(() => {
    if (!follow || !isDefaultSort || paused || timeRange || rows.length === 0) return;
    virtualizer.scrollToIndex(rows.length - 1, { align: "end" });
  }, [rows.length, follow, isDefaultSort, paused, timeRange, virtualizer]);

  const selectedCount = Object.keys(rowSelection).length;

  return {
    table,
    rows,
    virtualizer,
    scrollRef,
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

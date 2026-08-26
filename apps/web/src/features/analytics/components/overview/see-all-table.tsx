/**
 * The See-all dialog's table: sticky header over a scrolling body, a glyph
 * column, the key in mono, right-aligned tabular numbers, and the share as a
 * number beside the same hairline bar the cards draw. Loading is six
 * skeleton rows in the same grid; empty is the dashed Empty idiom with
 * honest copy, inside the table area so the dialog keeps its shape.
 */

import type { ReactNode } from "react";

import { useTranslation } from "react-i18next";

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

import { formatCount, formatShare } from "../../analytics-model";

export interface SeeAllRowBase {
  key: string;
}

export interface SeeAllColumn<Row> {
  id: string;
  label: string;
  cell: (row: Row) => string;
}

const SKELETON_ROWS = 6;
/** Rows keyed "(none)" are the API's "no value" bucket: shown, not pickable. */
const NONE_KEY = "(none)";

const NUMERIC_CELL = "text-right font-mono tabular-nums";
const HEAD = "h-8 px-2 text-xs font-medium text-muted-foreground";

export function SeeAllTable<Row extends SeeAllRowBase>({
  rows,
  total,
  loading,
  keyLabel,
  valueLabel,
  valueOf,
  columns,
  displayKey,
  renderLeading,
  mono,
  selectedKey,
  onPick,
}: {
  rows: readonly Row[];
  total: number;
  loading: boolean;
  keyLabel: string;
  valueLabel: string;
  valueOf: (row: Row) => number;
  columns: readonly SeeAllColumn<Row>[];
  displayKey: (key: string) => string;
  renderLeading: ((key: string) => ReactNode) | undefined;
  mono: boolean;
  selectedKey: string | undefined;
  onPick: ((key: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  const hasGlyph = renderLeading !== undefined;
  const columnCount = (hasGlyph ? 4 : 3) + columns.length;
  // Bars scale against the largest loaded row, not the total: mid-list rows
  // stay comparable and the share column carries the of-total truth.
  const maxValue = rows.reduce((m, row) => Math.max(m, valueOf(row)), 0);

  return (
    <div className="max-h-[60vh] min-h-48 overflow-y-auto rounded-md ring-1 ring-foreground/10">
      {/* A bare <table> rather than ui's <Table>: its wrapper is its own
          overflow container, which would swallow the sticky header. */}
      {/* Fixed layout: the key column takes whatever the numeric columns
          leave, and truncates; auto layout would let a long path push the
          share column out of the box. */}
      <table className="w-full table-fixed text-xs">
        <TableHeader className="sticky top-0 z-10 bg-popover">
          <TableRow className="hover:bg-transparent">
            {hasGlyph ? <TableHead className={cn(HEAD, "w-8")} aria-label={keyLabel} /> : null}
            <TableHead className={HEAD}>{keyLabel}</TableHead>
            <TableHead className={cn(HEAD, "w-16 text-right")}>{valueLabel}</TableHead>
            {columns.map((col) => (
              <TableHead key={col.id} className={cn(HEAD, "w-20 text-right")}>
                {col.label}
              </TableHead>
            ))}
            <TableHead className={cn(HEAD, "w-32 text-right")}>
              {t("analytics.overview.share")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <SkeletonRows columnCount={columnCount} />
          ) : rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columnCount} className="p-2">
                <Empty className="rounded-md border border-dashed bg-muted/20 py-10">
                  <EmptyHeader>
                    <EmptyTitle>{t("analytics.overview.noData")}</EmptyTitle>
                    <EmptyDescription className="text-xs">
                      {t("analytics.overview.noDataHint")}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const value = valueOf(row);
              const pickable = onPick !== undefined && row.key !== NONE_KEY;
              const label = displayKey(row.key);
              return (
                <TableRow
                  key={row.key}
                  onClick={pickable ? () => onPick(row.key) : undefined}
                  aria-selected={selectedKey !== undefined && row.key === selectedKey}
                  className={cn(
                    "h-9",
                    pickable && "cursor-pointer",
                    row.key === selectedKey && "bg-muted",
                  )}
                >
                  {renderLeading ? (
                    <TableCell className="px-2 py-0">
                      <span className="flex items-center justify-center">
                        {renderLeading(row.key)}
                      </span>
                    </TableCell>
                  ) : null}
                  <TableCell
                    className={cn("truncate px-2 py-0", mono && "font-mono")}
                    title={label === row.key ? row.key : `${label} (${row.key})`}
                  >
                    {label}
                  </TableCell>
                  <TableCell className={cn("px-2 py-0", NUMERIC_CELL)}>
                    {formatCount(value)}
                  </TableCell>
                  {columns.map((col) => (
                    <TableCell key={col.id} className={cn("px-2 py-0", NUMERIC_CELL)}>
                      {col.cell(row)}
                    </TableCell>
                  ))}
                  <TableCell className="px-2 py-0">
                    <span className="flex items-center justify-end gap-2">
                      <span className={cn(NUMERIC_CELL, "w-12 text-muted-foreground")}>
                        {formatShare(value, total)}
                      </span>
                      <span aria-hidden="true" className="block h-0.5 w-14">
                        <span
                          className="block h-full rounded-full bg-foreground/15"
                          style={{
                            width: maxValue > 0 ? `${Math.max((value / maxValue) * 100, 2)}%` : 0,
                          }}
                        />
                      </span>
                    </span>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </table>
    </div>
  );
}

function SkeletonRows({ columnCount }: { columnCount: number }) {
  return (
    <>
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <TableRow key={i} className="h-9 hover:bg-transparent">
          <TableCell colSpan={columnCount} className="px-2 py-0">
            <Skeleton className="h-3.5 w-full" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

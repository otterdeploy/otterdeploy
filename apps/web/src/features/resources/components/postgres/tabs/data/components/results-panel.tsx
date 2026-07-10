/**
 * Results pane for the data console. A sub-toolbar (grid / JSON view toggle +
 * export menu) sits above the body, which renders the active query's grid, a
 * JSON view, or loading / error / empty states. The owner passes a `leftSlot`
 * (filters in browse mode) and `footerSlot` (counts + pagination).
 *
 * Exports (CSV / JSON, all or selected rows) always carry EVERY column —
 * `hiddenColumns` only trims the grid.
 */
import { useMemo, useState } from "react";

import {
  Alert02Icon,
  Database01Icon,
  Download01Icon,
  SourceCodeIcon,
  Table01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { FkTarget } from "@/shared/components/data-grid/types";

import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { JsonView } from "@/shared/components/ui/json-view";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";
import { cn } from "@/shared/lib/utils";

import { type ColumnValue, type ColumnVariant, DiceResultGrid } from "./dice-grid";

export type ResultView = "grid" | "json";

interface ResultsPanelProps {
  resourceId: never;
  columns: string[];
  rows: (string | null)[][];
  columnVariants?: Record<string, ColumnVariant>;
  columnFks?: Record<string, FkTarget>;
  /** Collapsed display types (row-detail field labels). */
  columnTypes?: Record<string, string>;
  /** Columns hidden from the grid (never from exports). */
  hiddenColumns?: string[];
  onOpenRef?: (fk: FkTarget, value: string) => void;
  view: ResultView;
  onViewChange: (v: ResultView) => void;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  /** Has a result been produced yet (controls empty-vs-prompt states). */
  hasResult: boolean;
  emptyTitle: string;
  emptyBody: string;
  emptyIcon?: typeof Database01Icon;
  leftSlot?: React.ReactNode;
  footerSlot?: React.ReactNode;
  /** Suggested filename stem for exports. */
  exportName?: string;
  /** Inline edit / delete (table-browse mode, actor has write capability). */
  editable?: boolean;
  primaryKey?: string[];
  onUpdateRow?: (pk: ColumnValue[], set: ColumnValue[]) => Promise<void>;
  onDeleteRow?: (pk: ColumnValue[]) => Promise<void>;
  /** Multi-select checkbox column + selection mirror (table-browse mode). */
  selectable?: boolean;
  selectedRows?: number[];
  onSelectionChange?: (indices: number[]) => void;
  /** Per-row detail chevron + right-hand panel (table-browse mode). */
  enableRowDetail?: boolean;
}

function download(blobPart: string, mime: string, filename: string) {
  const blob = new Blob([blobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(columns: string[], rows: (string | null)[][]): string {
  const esc = (v: string | null) => {
    if (v == null) return "";
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return [columns.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

function toJson(columns: string[], rows: (string | null)[][]): string {
  return JSON.stringify(
    rows.map((r) => {
      const obj: Record<string, string | null> = {};
      columns.forEach((c, i) => (obj[c] = r[i] ?? null));
      return obj;
    }),
    null,
    2,
  );
}

export function ResultsPanel({
  resourceId,
  columns,
  rows,
  columnVariants,
  columnFks,
  columnTypes,
  hiddenColumns,
  onOpenRef,
  view,
  onViewChange,
  isLoading,
  isError,
  errorMessage,
  hasResult,
  emptyTitle,
  emptyBody,
  emptyIcon = Database01Icon,
  leftSlot,
  footerSlot,
  exportName = "query",
  editable = false,
  primaryKey,
  onUpdateRow,
  onDeleteRow,
  selectable = false,
  selectedRows,
  onSelectionChange,
  enableRowDetail = false,
}: ResultsPanelProps) {
  const jsonData = useMemo(
    () =>
      rows.map((r) => {
        const obj: Record<string, string | null> = {};
        columns.forEach((c, i) => (obj[c] = r[i] ?? null));
        return obj;
      }),
    [columns, rows],
  );

  const canExport = hasResult && columns.length > 0;
  const selectedCount = selectedRows?.length ?? 0;
  const rowsFor = (selection: boolean) =>
    selection
      ? (selectedRows ?? [])
          .map((i) => rows[i])
          .filter((r): r is (string | null)[] => r !== undefined)
      : rows;
  const exportAs = (format: "csv" | "json", selection: boolean) => {
    const subset = rowsFor(selection);
    if (format === "csv")
      download(toCsv(columns, subset), "text/csv;charset=utf-8;", `${exportName}.csv`);
    else download(toJson(columns, subset), "application/json;charset=utf-8;", `${exportName}.json`);
  };

  // Each query/page fully replaces the result, so remount the grid whenever the
  // rows array identity changes. The grid is heavily stateful (virtualizer
  // measurement cache keyed by row index, table row model, selection); without
  // a fresh mount, cycling 10-rows → 1-row → 10-rows left the virtualizer stuck
  // rendering a single row even though the data was correct. Bumping the key only
  // when `rows` actually changes is idempotent under StrictMode's double render:
  // setting state during render re-renders this component in place (no commit),
  // and the second pass is a no-op because the stored rows now match.
  const [gridKeyState, setGridKeyState] = useState<{ rows: unknown; key: number }>({
    rows: null,
    key: 0,
  });
  let gridKey = gridKeyState.key;
  if (gridKeyState.rows !== rows) {
    gridKey = gridKeyState.key + 1;
    setGridKeyState({ rows, key: gridKey });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sub-toolbar */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-2">
        <div className="flex min-w-0 items-center gap-2">{leftSlot}</div>
        <div className="flex items-center gap-1.5">
          <ToggleGroup
            size="sm"
            value={[view]}
            onValueChange={([v]) => v && onViewChange(v as ResultView)}
            className="gap-0.5"
          >
            <ToggleGroupItem value="grid" aria-label="Grid view" className="h-6 px-1.5">
              <HugeiconsIcon icon={Table01Icon} strokeWidth={2} className="size-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem value="json" aria-label="JSON view" className="h-6 px-1.5">
              <HugeiconsIcon icon={SourceCodeIcon} strokeWidth={2} className="size-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" disabled={!canExport} aria-label="Export" />
              }
            >
              <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => exportAs("csv", false)}>
                Export all to .csv
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportAs("json", false)}>
                Export all to .json
              </DropdownMenuItem>
              {selectable ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={selectedCount === 0}
                    onSelect={() => exportAs("csv", true)}
                  >
                    Export selected to .csv{selectedCount ? ` (${selectedCount})` : ""}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={selectedCount === 0}
                    onSelect={() => exportAs("json", true)}
                  >
                    Export selected to .json{selectedCount ? ` (${selectedCount})` : ""}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <CenterNote title="Loading…" body="Running query." />
      ) : isError ? (
        <CenterNote
          icon={Alert02Icon}
          title="Query failed"
          body={errorMessage ?? "Something went wrong."}
          tone="error"
        />
      ) : !hasResult ? (
        <CenterNote icon={emptyIcon} title={emptyTitle} body={emptyBody} />
      ) : view === "json" ? (
        <ScrollArea className="min-h-0 flex-1">
          <JsonView data={jsonData} className="p-3" />
        </ScrollArea>
      ) : (
        <DiceResultGrid
          key={gridKey}
          resourceId={resourceId}
          columns={columns}
          rows={rows}
          columnVariants={columnVariants}
          columnFks={columnFks}
          columnTypes={columnTypes}
          hiddenColumns={hiddenColumns}
          onOpenRef={onOpenRef}
          editable={editable}
          primaryKey={primaryKey}
          onUpdateRow={onUpdateRow}
          onDeleteRow={onDeleteRow}
          selectable={selectable}
          onSelectionChange={onSelectionChange}
          enableRowDetail={enableRowDetail}
        />
      )}

      {/* Footer */}
      {footerSlot}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
function CenterNote({
  title,
  body,
  icon = Database01Icon,
  tone,
}: {
  title: string;
  body: string;
  icon?: typeof Database01Icon;
  tone?: "error";
}) {
  return (
    <Empty className="min-h-0 flex-1">
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className={cn(
            "size-12 rounded-2xl border bg-muted/30",
            tone === "error" && "border-destructive/30 bg-destructive/5",
          )}
        >
          <HugeiconsIcon
            icon={icon}
            strokeWidth={1.5}
            className={cn("size-6 text-muted-foreground", tone === "error" && "text-destructive")}
          />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * Results pane for the data console. A sub-toolbar (grid / JSON view toggle +
 * export menu, see {@link ResultsToolbar}) sits above the body, which renders
 * the active query's grid, a JSON view, or loading / error / empty states. The
 * owner passes a `leftSlot` (filters in browse mode) and `footerSlot` (counts
 * + pagination).
 */
import type { ResourceId } from "@otterdeploy/shared/id";
import { useState } from "react";

import { Alert02Icon, Database01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { FkTarget } from "@/shared/components/data-grid/types";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { JsonView } from "@/shared/components/ui/json-view";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { cn } from "@/shared/lib/utils";

import { type ColumnValue, type ColumnVariant, DiceResultGrid } from "./dice-grid";
import { ResultsToolbar, type ResultView } from "./results-toolbar";

export type { ResultView };

interface ResultsPanelProps {
  resourceId: ResourceId;
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
  const jsonData = rows.map((r) => {
    const obj: Record<string, string | null> = {};
    columns.forEach((c, i) => (obj[c] = r[i] ?? null));
    return obj;
  });

  const canExport = hasResult && columns.length > 0;

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
      <ResultsToolbar
        columns={columns}
        rows={rows}
        view={view}
        onViewChange={onViewChange}
        canExport={canExport}
        exportName={exportName}
        selectable={selectable}
        selectedRows={selectedRows}
        leftSlot={leftSlot}
      />

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

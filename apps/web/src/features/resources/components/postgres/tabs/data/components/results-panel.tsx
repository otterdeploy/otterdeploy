/**
 * Results pane for the data console. A sub-toolbar (grid / JSON view toggle +
 * CSV export) sits above the body, which renders the active query's grid, a
 * JSON view, or loading / error / empty states. The owner passes a `leftSlot`
 * (filters in browse mode) and `footerSlot` (counts + pagination).
 */
import { useMemo, useRef } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Database01Icon,
  Download01Icon,
  SourceCodeIcon,
  Table01Icon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/shared/components/ui/button";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";

import type { FkTarget } from "@/shared/components/data-grid/types";

import { type ColumnValue, type ColumnVariant, DiceResultGrid } from "./dice-grid";

export type ResultView = "grid" | "json";

interface ResultsPanelProps {
  resourceId: never;
  columns: string[];
  rows: (string | null)[][];
  columnVariants?: Record<string, ColumnVariant>;
  columnFks?: Record<string, FkTarget>;
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
  /** Suggested filename stem for CSV export. */
  exportName?: string;
  /** Inline edit / delete (table-browse mode, actor has write capability). */
  editable?: boolean;
  primaryKey?: string[];
  onUpdateRow?: (pk: ColumnValue[], set: ColumnValue[]) => Promise<void>;
  onDeleteRow?: (pk: ColumnValue[]) => Promise<void>;
}

function downloadCsv(
  columns: string[],
  rows: (string | null)[][],
  name: string,
) {
  const esc = (v: string | null) => {
    if (v == null) return "";
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const csv = [
    columns.map(esc).join(","),
    ...rows.map((r) => r.map(esc).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ResultsPanel({
  resourceId,
  columns,
  rows,
  columnVariants,
  columnFks,
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

  // Each query/page fully replaces the result, so remount the grid whenever the
  // rows array identity changes. The grid is heavily stateful (virtualizer
  // measurement cache keyed by row index, table row model, selection); without
  // a fresh mount, cycling 10-rows → 1-row → 10-rows left the virtualizer stuck
  // rendering a single row even though the data was correct. Bumping a key only
  // when `rows` actually changes is idempotent under StrictMode's double render.
  const gridKeyRef = useRef<{ rows: unknown; key: number }>({
    rows: null,
    key: 0,
  });
  if (gridKeyRef.current.rows !== rows) {
    gridKeyRef.current = { rows, key: gridKeyRef.current.key + 1 };
  }
  const gridKey = gridKeyRef.current.key;

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
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canExport}
                  onClick={() => downloadCsv(columns, rows, exportName)}
                  aria-label="Export CSV"
                />
              }
            >
              <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Export CSV</TooltipContent>
          </Tooltip>
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
          onOpenRef={onOpenRef}
          editable={editable}
          primaryKey={primaryKey}
          onUpdateRow={onUpdateRow}
          onDeleteRow={onDeleteRow}
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
            className={cn(
              "size-6 text-muted-foreground",
              tone === "error" && "text-destructive",
            )}
          />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * The shared results panel for the Data studio — identical in both Table and
 * SQL modes; only the surrounding chrome differs. Wraps {@link ResultsPanel}
 * with a mode-aware left slot (Data/Structure toggle · filters · columns · add
 * record / open-in-SQL) and footer (row count + selection actions +
 * pagination). Table mode adds multi-select bulk delete (typed-confirm past 10
 * rows), the Add-record modal, and the read-only Structure view. Driven by the
 * {@link DataStudioController}.
 */

import { useEffect, useState } from "react";

import {
  Database01Icon,
  FilterIcon,
  Layers01Icon,
  PlayIcon,
  PlusSignIcon,
  Table01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";

import { AddRecordDialog } from "./components/add-record-dialog";
import { ColumnVisibilityPopover } from "./components/column-visibility-popover";
import { FilterPopover } from "./components/filter-popover";
import { ResultsPanel } from "./components/results-panel";
import { StructureView } from "./components/structure-view";
import { isFilterActive } from "./data/filters";
import { SQL_RESULT_CAP } from "./data/queries";
import { type DataStudioController, errMessage, PAGE_SIZES } from "./use-data-studio";
import { useBulkDelete } from "./use-data-studio-helpers";

type TableController = DataStudioController["table"];

/** Rows above this get the type-the-table-name gate instead of a plain confirm. */
const TYPED_CONFIRM_THRESHOLD = 10;

function resolveResultsProps(t: TableController) {
  const tableMode = t.mode === "table";
  const sqlMode = t.mode === "sql";
  return {
    columnVariants: tableMode ? t.columnVariants : undefined,
    columnFks: tableMode ? t.columnFks : undefined,
    columnTypes: tableMode ? t.columnTypes : undefined,
    hiddenColumns: tableMode ? t.hiddenColumns : undefined,
    primaryKey: tableMode ? t.primaryKey : undefined,
    onUpdateRow: tableMode ? t.onUpdateRow : undefined,
    onDeleteRow: tableMode ? t.onDeleteRow : undefined,
    exportName: tableMode && t.selected ? t.selected.name : "query",
    emptyIcon: sqlMode ? PlayIcon : Database01Icon,
    emptyTitle: sqlMode ? "Run a query" : "Select a table",
    emptyBody: sqlMode
      ? "Write read-only SQL above, then run a statement with its ▶ or ⌘↵."
      : "Pick a table from the left to browse its rows.",
  };
}

export function StudioResults({ studio }: { studio: DataStudioController }) {
  const t = studio.table;
  const p = resolveResultsProps(t);

  // Multi-select mirror (indices into the current result page). The grid owns
  // the checkbox state; this drives the footer actions + export-selected. Reset
  // whenever the page's rows change identity (new page / refetch / new table).
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const resultRows = t.result?.rows;
  useEffect(() => setSelectedRows([]), [resultRows]);

  const canMutateRows = t.editable && t.primaryKey.length > 0;
  const bulk = useBulkDelete({
    resourceId: String(t.resourceId),
    selected: t.selected,
    primaryKey: t.primaryKey,
    result: t.result,
    rowsQuery: t.rowsQuery,
  });
  // Pending bulk-delete confirmation (null = closed).
  const [confirmDelete, setConfirmDelete] = useState<number[] | null>(null);

  // Structure view replaces the whole results pane (read-only, no filters /
  // pagination); the Data/Structure toggle stays visible in both.
  if (t.mode === "table" && t.selected && t.tableView === "structure") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
          <DataStructureToggle t={t} />
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {t.selected.schema === "public"
              ? t.selected.name
              : `${t.selected.schema}.${t.selected.name}`}
          </span>
        </div>
        <StructureView resourceId={String(t.resourceId)} table={t.selected} />
      </div>
    );
  }

  return (
    <>
      <ResultsPanel
        resourceId={t.resourceId}
        columns={t.result?.columns ?? []}
        rows={t.result?.rows ?? []}
        columnVariants={p.columnVariants}
        columnFks={p.columnFks}
        columnTypes={p.columnTypes}
        hiddenColumns={p.hiddenColumns}
        onOpenRef={t.openRefTable}
        view={t.view}
        onViewChange={t.setView}
        isLoading={t.rowsQuery.isLoading}
        isError={t.rowsQuery.isError}
        errorMessage={errMessage(t.rowsQuery.error)}
        hasResult={Boolean(t.result)}
        exportName={p.exportName}
        editable={t.editable}
        primaryKey={p.primaryKey}
        onUpdateRow={p.onUpdateRow}
        onDeleteRow={p.onDeleteRow}
        selectable={t.mode === "table" && canMutateRows}
        selectedRows={selectedRows}
        onSelectionChange={setSelectedRows}
        enableRowDetail={t.mode === "table"}
        emptyIcon={p.emptyIcon}
        emptyTitle={p.emptyTitle}
        emptyBody={p.emptyBody}
        leftSlot={<TableActions studio={studio} />}
        footerSlot={
          <ResultsFooter
            studio={studio}
            selectedRows={selectedRows}
            deleteProgress={bulk.progress}
            onDeleteSelected={() => setConfirmDelete(selectedRows)}
          />
        }
      />

      {/* Bulk-delete confirm — typed table name past the threshold. */}
      <TypedConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title={`Delete ${confirmDelete?.length ?? 0} row${(confirmDelete?.length ?? 0) === 1 ? "" : "s"}?`}
        description={
          <>
            Each row is deleted by primary key from{" "}
            <span className="font-mono">{t.selected?.name}</span>. This can&apos;t be undone.
          </>
        }
        confirmPhrase={
          (confirmDelete?.length ?? 0) > TYPED_CONFIRM_THRESHOLD ? t.selected?.name : undefined
        }
        confirmLabel="Delete rows"
        onConfirm={() => {
          const indices = confirmDelete ?? [];
          setConfirmDelete(null);
          void bulk.deleteRows(indices);
        }}
      />
    </>
  );
}

/** Data ↔ Structure — the toolbar's view toggle for the open table. */
function DataStructureToggle({ t }: { t: TableController }) {
  return (
    <ToggleGroup
      size="sm"
      value={[t.tableView]}
      onValueChange={([v]) => v && t.setTableView(v as "data" | "structure")}
      className="gap-0.5"
    >
      <ToggleGroupItem value="data" aria-label="Data view" className="h-6 gap-1 px-1.5 text-[11px]">
        <HugeiconsIcon icon={Table01Icon} strokeWidth={2} className="size-3" />
        Data
      </ToggleGroupItem>
      <ToggleGroupItem
        value="structure"
        aria-label="Structure view"
        className="h-6 gap-1 px-1.5 text-[11px]"
      >
        <HugeiconsIcon icon={Layers01Icon} strokeWidth={2} className="size-3" />
        Structure
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

function TableActions({ studio }: { studio: DataStudioController }) {
  const t = studio.table;
  const [addOpen, setAddOpen] = useState(false);
  if (!(t.mode === "table" && t.selected)) return null;
  const selected = t.selected;
  const resultColumns = t.result?.columns ?? [];
  const activeFilterCount = t.filters.filter(isFilterActive).length;
  const canAdd = t.canWrite && t.primaryKey.length > 0;
  const visibleCount = resultColumns.length - t.hiddenColumns.length;
  return (
    <>
      <DataStructureToggle t={t} />
      <FilterPopover
        columns={resultColumns}
        filters={t.filters}
        onApply={t.changeFilters}
        trigger={
          <Button
            variant={activeFilterCount ? "secondary" : "outline"}
            size="sm"
            className="h-6 gap-1.5"
          >
            <HugeiconsIcon icon={FilterIcon} strokeWidth={2} className="size-3.5" />
            Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
          </Button>
        }
      />
      <ColumnVisibilityPopover
        columns={resultColumns}
        columnTypes={t.columnTypes}
        hidden={t.hiddenColumns}
        onChange={t.setHiddenColumns}
        trigger={
          <Button
            variant={t.hiddenColumns.length ? "secondary" : "outline"}
            size="sm"
            className="h-6 gap-1.5"
          >
            <HugeiconsIcon icon={ViewIcon} strokeWidth={2} className="size-3.5" />
            Columns{t.hiddenColumns.length ? ` · ${visibleCount}/${resultColumns.length}` : ""}
          </Button>
        }
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex">
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1.5"
                disabled={!canAdd}
                onClick={() => setAddOpen(true)}
              >
                <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
                Add record
              </Button>
            </span>
          }
        />
        <TooltipContent>
          {canAdd
            ? "Insert a row (audited)"
            : !t.canWrite
              ? "Requires the database:write capability."
              : "The table needs a primary key for safe writes."}
        </TooltipContent>
      </Tooltip>
      <Button variant="ghost" size="sm" className="h-6" onClick={studio.openInSql}>
        Open in SQL
      </Button>

      <AddRecordDialog
        resourceId={String(t.resourceId)}
        table={selected}
        open={addOpen}
        onOpenChange={setAddOpen}
        onInserted={() => {
          void t.rowsQuery.refetch();
          void t.tablesQuery.refetch();
        }}
      />
    </>
  );
}

function ResultsFooter({
  studio,
  selectedRows,
  deleteProgress,
  onDeleteSelected,
}: {
  studio: DataStudioController;
  selectedRows: number[];
  deleteProgress: { done: number; total: number } | null;
  onDeleteSelected: () => void;
}) {
  const t = studio.table;
  const result = t.result;
  if (!result) return null;
  const selectedCount = selectedRows.length;
  return (
    <div className="flex items-center justify-between gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-2 font-mono">
        <span>{result.rows.length} rows</span>
        <span className="text-muted-foreground/40">·</span>
        <span>{result.durationMs}ms</span>
        {t.mode === "sql" && result.truncated ? (
          <span className="text-amber-500">· capped at {SQL_RESULT_CAP}</span>
        ) : null}
        {deleteProgress ? (
          <span className="text-foreground">
            · deleting {deleteProgress.done}/{deleteProgress.total}…
          </span>
        ) : selectedCount > 0 ? (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-foreground">{selectedCount} selected</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[11px] text-destructive hover:text-destructive"
              onClick={onDeleteSelected}
            >
              Delete selected
            </Button>
          </>
        ) : null}
      </div>
      {t.mode === "table" ? (
        <div className="flex items-center gap-2">
          <span className="font-mono">
            {result.rows.length === 0
              ? "0"
              : `${t.page * t.pageSize + 1}–${t.page * t.pageSize + result.rows.length}`}
          </span>
          <Select
            value={String(t.pageSize)}
            onValueChange={(v) => {
              t.setPageSize(Number(v));
              t.setPage(0);
            }}
          >
            <SelectTrigger className="h-6 w-19 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}/page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={t.page === 0}
            onClick={() => t.setPage((prev) => Math.max(0, prev - 1))}
            aria-label="Previous page"
          >
            ‹
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={!t.hasNext}
            onClick={() => t.setPage((prev) => prev + 1)}
            aria-label="Next page"
          >
            ›
          </Button>
        </div>
      ) : null}
    </div>
  );
}

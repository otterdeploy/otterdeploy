/**
 * The shared results panel for the Data studio — identical in both Table and
 * SQL modes; only the surrounding chrome differs. Wraps {@link ResultsPanel}
 * with a mode-aware left slot (filters / open-in-SQL) and footer (row count +
 * pagination). Driven by the {@link DataStudioController}.
 */

import { Database01Icon, FilterIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import { FilterPopover } from "./components/filter-popover";
import { ResultsPanel } from "./components/results-panel";
import { isFilterActive } from "./data/filters";
import { SQL_RESULT_CAP } from "./data/queries";
import { type DataStudioController, errMessage, PAGE_SIZES } from "./use-data-studio";

type TableController = DataStudioController["table"];

function resolveResultsProps(t: TableController) {
  const tableMode = t.mode === "table";
  const sqlMode = t.mode === "sql";
  return {
    columnVariants: tableMode ? t.columnVariants : undefined,
    columnFks: tableMode ? t.columnFks : undefined,
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
  return (
    <ResultsPanel
      resourceId={t.resourceId}
      columns={t.result?.columns ?? []}
      rows={t.result?.rows ?? []}
      columnVariants={p.columnVariants}
      columnFks={p.columnFks}
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
      emptyIcon={p.emptyIcon}
      emptyTitle={p.emptyTitle}
      emptyBody={p.emptyBody}
      leftSlot={<TableActions studio={studio} />}
      footerSlot={<ResultsFooter studio={studio} />}
    />
  );
}

function TableActions({ studio }: { studio: DataStudioController }) {
  const t = studio.table;
  if (!(t.mode === "table" && t.selected)) return null;
  const resultColumns = t.result?.columns ?? [];
  const activeFilterCount = t.filters.filter(isFilterActive).length;
  return (
    <>
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
      <Button variant="ghost" size="sm" className="h-6" onClick={studio.openInSql}>
        Open in SQL
      </Button>
    </>
  );
}

function ResultsFooter({ studio }: { studio: DataStudioController }) {
  const t = studio.table;
  const result = t.result;
  if (!result) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-2 font-mono">
        <span>{result.rows.length} rows</span>
        <span className="text-muted-foreground/40">·</span>
        <span>{result.durationMs}ms</span>
        {t.mode === "sql" && result.truncated ? (
          <span className="text-amber-500">· capped at {SQL_RESULT_CAP}</span>
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

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

import { Database01Icon, PlayIcon } from "@hugeicons/core-free-icons";

import { ResultsPanel } from "./components/results-panel";
import { StructureView } from "./components/structure-view";
import { BulkDeleteConfirm, ResultsFooter } from "./studio-results-footer";
import { DataStructureToggle, TableActions } from "./studio-results-toolbar";
import { type DataStudioController, errMessage } from "./use-data-studio";
import { useBulkDelete } from "./use-data-studio-helpers";

type TableController = DataStudioController["table"];

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

      <BulkDeleteConfirm
        pending={confirmDelete}
        tableName={t.selected?.name}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={(indices) => {
          setConfirmDelete(null);
          void bulk.deleteRows(indices);
        }}
      />
    </>
  );
}

/**
 * Left-slot toolbar for {@link StudioResults}: the Data/Structure toggle and,
 * in table mode, the filter / column-visibility popovers, the Add-record
 * button (with its dialog), and the open-in-SQL shortcut.
 */

import { useState } from "react";

import {
  FilterIcon,
  Key01Icon,
  Layers01Icon,
  PlusSignIcon,
  SourceCodeIcon,
  Table01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { isFilterComplete } from "@otterdeploy/data-engine";

import { Button } from "@/shared/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";

import type { DataStudioController } from "./use-data-studio";

import { AddRecordDialog } from "./components/add-record-dialog";
import { ColumnVisibilityPopover } from "./components/column-visibility-popover";
import { FilterPopover } from "./components/filter-popover";

type TableController = DataStudioController["table"];

/** Data ↔ Structure: the toolbar's view toggle for the open table. */
export function DataStructureToggle({ t }: { t: TableController }) {
  return (
    <ToggleGroup
      size="sm"
      value={[t.tableView]}
      onValueChange={([v]) =>
        (v === "data" || v === "structure" || v === "definitions") && t.setTableView(v)
      }
      className="shrink-0 gap-0.5"
    >
      <ToggleGroupItem value="data" aria-label="Data view" className="h-6 gap-1 px-1.5 text-[11px]">
        <HugeiconsIcon icon={Table01Icon} strokeWidth={2} className="size-3" />
        <ToolbarLabel>Data</ToolbarLabel>
      </ToggleGroupItem>
      <ToggleGroupItem
        value="structure"
        aria-label="Structure view"
        className="h-6 gap-1 px-1.5 text-[11px]"
      >
        <HugeiconsIcon icon={Layers01Icon} strokeWidth={2} className="size-3" />
        <ToolbarLabel>Structure</ToolbarLabel>
      </ToggleGroupItem>
      {/* Whole-database rather than per-table: "which unused index is costing
          me writes" is a question about the database, not about a table. */}
      <ToggleGroupItem
        value="definitions"
        aria-label="Definitions view"
        className="h-6 gap-1 px-1.5 text-[11px]"
      >
        <HugeiconsIcon icon={Key01Icon} strokeWidth={2} className="size-3" />
        <ToolbarLabel>Definitions</ToolbarLabel>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/**
 * A control's word, dropped when the toolbar has no room for it.
 *
 * `sr-only` rather than `hidden`: the text IS the button's accessible name, so
 * removing it from the tree would leave a nameless icon. Keyed to the toolbar's
 * container (`/results`) and not the viewport, because this bar lives beside a
 * rail inside a split pane — the window's width tells it nothing.
 */
function ToolbarLabel({ children }: { children: React.ReactNode }) {
  return <span className="@max-3xl/results:sr-only">{children}</span>;
}

/** The count on a control, kept when its word is dropped. One badge, the same
 *  one the shared data table's Filters button uses. */
function ToolbarCount({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-primary/10 px-1.5 font-mono text-[10px] text-primary tabular-nums">
      {children}
    </span>
  );
}

export function TableActions({ studio }: { studio: DataStudioController }) {
  const t = studio.table;
  const [addOpen, setAddOpen] = useState(false);
  if (!(t.mode === "table" && t.selected)) return null;
  const selected = t.selected;
  const resultColumns = (t.result?.columns ?? []).map((c) => c.name);
  const activeFilterCount = t.filters.filter(isFilterComplete).length;
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
            aria-label="Filters"
            className="h-6 shrink-0 gap-1.5"
          >
            <HugeiconsIcon icon={FilterIcon} strokeWidth={2} className="size-3.5" />
            <ToolbarLabel>Filters</ToolbarLabel>
            {activeFilterCount ? <ToolbarCount>{activeFilterCount}</ToolbarCount> : null}
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
            aria-label="Columns"
            className="h-6 shrink-0 gap-1.5"
          >
            <HugeiconsIcon icon={ViewIcon} strokeWidth={2} className="size-3.5" />
            <ToolbarLabel>Columns</ToolbarLabel>
            {t.hiddenColumns.length ? (
              <ToolbarCount>
                {visibleCount}/{resultColumns.length}
              </ToolbarCount>
            ) : null}
          </Button>
        }
      />
      {/* Everything left of this narrows what you SEE; everything right of it
          changes the data or takes you elsewhere. A drawn rule, not the elastic
          `flex-1` gap this replaces: that gap collapsed to nothing exactly when
          the toolbar was crowded — the moment the separation was worth making —
          and it also defeated the scroll container the row now lives in. */}
      <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />

      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex shrink-0">
              <Button
                variant="outline"
                size="sm"
                aria-label="Insert a row"
                className="h-6 shrink-0 gap-1.5"
                disabled={!canAdd}
                onClick={() => setAddOpen(true)}
              >
                <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
                <ToolbarLabel>Row</ToolbarLabel>
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
      <Button
        variant="outline"
        size="sm"
        aria-label="Open in SQL"
        className="h-6 shrink-0 gap-1.5"
        onClick={studio.openInSql}
      >
        <HugeiconsIcon icon={SourceCodeIcon} strokeWidth={2} className="size-3.5" />
        <ToolbarLabel>Open in SQL</ToolbarLabel>
      </Button>

      <AddRecordDialog
        target={t.target}
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

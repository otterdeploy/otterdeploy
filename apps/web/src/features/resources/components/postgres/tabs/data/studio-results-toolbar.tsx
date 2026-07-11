/**
 * Left-slot toolbar for {@link StudioResults}: the Data/Structure toggle and,
 * in table mode, the filter / column-visibility popovers, the Add-record
 * button (with its dialog), and the open-in-SQL shortcut.
 */

import { useState } from "react";

import {
  FilterIcon,
  Layers01Icon,
  PlusSignIcon,
  Table01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";

import type { DataStudioController } from "./use-data-studio";

import { AddRecordDialog } from "./components/add-record-dialog";
import { ColumnVisibilityPopover } from "./components/column-visibility-popover";
import { FilterPopover } from "./components/filter-popover";
import { isFilterActive } from "./data/filters";

type TableController = DataStudioController["table"];

/** Data ↔ Structure — the toolbar's view toggle for the open table. */
export function DataStructureToggle({ t }: { t: TableController }) {
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

export function TableActions({ studio }: { studio: DataStudioController }) {
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

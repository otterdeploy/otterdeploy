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
      {/* Whole-database rather than per-table: "which unused index is costing
          me writes" is a question about the database, not about a table. */}
      <ToggleGroupItem
        value="definitions"
        aria-label="Definitions view"
        className="h-6 gap-1 px-1.5 text-[11px]"
      >
        <HugeiconsIcon icon={Key01Icon} strokeWidth={2} className="size-3" />
        Definitions
      </ToggleGroupItem>
    </ToggleGroup>
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
      {/* Everything above narrows what you SEE; everything below changes it or
          takes you elsewhere. The gap is the separation — same split, and the
          same button weight, as the approved layout. */}
      <span className="flex-1" />

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
                Row
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
      <Button variant="outline" size="sm" className="h-6 gap-1.5" onClick={studio.openInSql}>
        <HugeiconsIcon icon={SourceCodeIcon} strokeWidth={2} className="size-3.5" />
        Open in SQL
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

/**
 * The column menu: which columns are shown, and how dense the rows are.
 *
 * `getCanHide()` is the single source of truth for what may be turned off —
 * the select gutter declares `enableHiding: false` rather than being
 * special-cased here, so a new always-on column needs no edit to this file.
 */

import type { ReactTable, RowData } from "@tanstack/react-table";

import { Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { DataTableFeatures } from "@/shared/components/data-table/features";
import type { Density } from "@/shared/components/data-table/parts/table-view";

import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";

export function DataTableViewOptions<TRow extends RowData>({
  table,
  density,
  onDensityChange,
  onResetColumns,
  isCustomized,
}: {
  table: ReactTable<DataTableFeatures, TRow>;
  density: Density;
  onDensityChange: (density: Density) => void;
  onResetColumns: () => void;
  isCustomized: boolean;
}) {
  const columns = table.getAllColumns().filter((column) => column.getCanHide());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Columns and density">
            <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Density</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={density}
          onValueChange={(value) =>
            onDensityChange(value === "compact" ? "compact" : "comfortable")
          }
        >
          <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Columns</DropdownMenuLabel>
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.getIsVisible()}
            onCheckedChange={(checked) => column.toggleVisibility(checked === true)}
          >
            {column.columnDef.meta?.label ?? column.id}
          </DropdownMenuCheckboxItem>
        ))}

        {isCustomized ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onResetColumns}>Reset columns</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

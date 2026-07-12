/**
 * Sub-toolbar for {@link ResultsPanel}: the owner's `leftSlot`, the grid/JSON
 * view toggle, and the export menu. Exports (CSV / JSON, all or selected rows)
 * always carry EVERY column — column hiding only trims the grid.
 */

import { Download01Icon, SourceCodeIcon, Table01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/shared/components/ui/toggle-group";

export type ResultView = "grid" | "json";

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

export function ResultsToolbar({
  columns,
  rows,
  view,
  onViewChange,
  canExport,
  exportName,
  selectable,
  selectedRows,
  leftSlot,
}: {
  columns: string[];
  rows: (string | null)[][];
  view: ResultView;
  onViewChange: (v: ResultView) => void;
  canExport: boolean;
  exportName: string;
  selectable: boolean;
  selectedRows?: number[];
  leftSlot?: React.ReactNode;
}) {
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

  return (
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
  );
}

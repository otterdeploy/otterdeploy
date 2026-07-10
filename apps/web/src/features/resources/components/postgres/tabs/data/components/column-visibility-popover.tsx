/**
 * Columns popover — per-table show/hide checkboxes (type-colored labels, per
 * the reference viewer). Hidden columns are excluded from the grid only —
 * exports always include every column. Persistence (localStorage, per table)
 * is handled by the controller via ../data/column-prefs.
 */

import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";

import { TypeLabel } from "./type-label";

export function ColumnVisibilityPopover({
  columns,
  columnTypes,
  hidden,
  onChange,
  trigger,
}: {
  columns: string[];
  columnTypes?: Record<string, string>;
  hidden: string[];
  onChange: (next: string[]) => void;
  trigger: React.ReactElement;
}) {
  const hiddenSet = new Set(hidden);
  const toggle = (name: string) => {
    onChange(hiddenSet.has(name) ? hidden.filter((c) => c !== name) : [...hidden, name]);
  };

  return (
    <Popover>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-60 gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            Toggle columns
          </span>
          {hidden.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[11px]"
              onClick={() => onChange([])}
            >
              Show all
            </Button>
          ) : null}
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {columns.map((name) => {
            const visible = !hiddenSet.has(name);
            return (
              <label
                key={name}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
              >
                <Checkbox
                  checked={visible}
                  onCheckedChange={() => toggle(name)}
                  aria-label={`${visible ? "Hide" : "Show"} column ${name}`}
                />
                <span className="truncate font-mono text-[12px]">{name}</span>
                {columnTypes?.[name] ? (
                  <TypeLabel type={columnTypes[name]} className="ml-auto" />
                ) : null}
              </label>
            );
          })}
          {columns.length === 0 ? (
            <p className="px-2 py-1.5 text-[12px] text-muted-foreground">No columns yet.</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

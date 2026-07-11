/**
 * Filter rows for the "Filter Data" popover. One row per filter:
 * [✓ enable] [Column ▾] [Operator ▾] [Value] [×]. Operator is disabled until a
 * column is chosen; Value until a value-taking operator is chosen. Nothing is
 * hidden — controls disable in place. Add Filter / Cancel / Apply live in the
 * popover footer (./filter-popover).
 */

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import {
  type Filter,
  FILTER_OPS,
  type FilterOp,
  isNumericOp,
  isValidNumericValue,
  opNeedsValue,
} from "../data/filters";

export function FilterBar({
  columns,
  filters,
  onChange,
}: {
  columns: string[];
  filters: Filter[];
  onChange: (next: Filter[]) => void;
}) {
  const patch = (id: string, p: Partial<Filter>) =>
    onChange(filters.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const remove = (id: string) => onChange(filters.filter((f) => f.id !== id));

  return (
    <div className="flex flex-col">
      {filters.map((f) => (
        <div key={f.id} className="flex items-center gap-2 border-b px-3 py-2.5">
          <Checkbox
            checked={f.enabled}
            onCheckedChange={(checked) => patch(f.id, { enabled: Boolean(checked) })}
            aria-label="Enable filter"
          />
          <Select value={f.column} onValueChange={(v) => patch(f.id, { column: v ?? "" })}>
            <SelectTrigger size="sm" className="w-32 font-mono text-[12px]">
              <SelectValue placeholder="Column..." />
            </SelectTrigger>
            <SelectContent>
              {columns.map((c) => (
                <SelectItem key={c} value={c} className="font-mono text-[12px]">
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={f.op}
            disabled={!f.column}
            onValueChange={(v) => patch(f.id, { op: (v ?? "") as FilterOp | "" })}
          >
            <SelectTrigger size="sm" className="w-40 text-[12px]">
              <SelectValue placeholder="Operator..." />
            </SelectTrigger>
            {/* Let the dropdown size to its (long) labels instead of the
                trigger width, so "is not null (IS NOT NULL)" isn't clipped. */}
            <SelectContent alignItemWithTrigger={false} className="w-auto px-1">
              {FILTER_OPS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-[12px] whitespace-nowrap">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={f.value}
            onChange={(e) => patch(f.id, { value: e.target.value })}
            placeholder={isNumericOp(f.op) ? "Number..." : "Value..."}
            disabled={!f.column || !opNeedsValue(f.op)}
            inputMode={isNumericOp(f.op) ? "decimal" : undefined}
            // Numeric ops only compile with a numeric value — flag anything else.
            aria-invalid={
              isNumericOp(f.op) && f.value !== "" && !isValidNumericValue(f.value)
                ? true
                : undefined
            }
            className="h-8 flex-1 font-mono text-[12px]"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove filter"
            onClick={() => remove(f.id)}
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              strokeWidth={2}
              className="size-4 text-muted-foreground"
            />
          </Button>
        </div>
      ))}
    </div>
  );
}

/**
 * Filter rows for the "Filter Data" popover. One row per filter:
 * [✓ enable] [Column ▾] [Operator ▾] [Value…] [×]. Operator is disabled until a
 * column is chosen; the operand inputs until a value-taking operator is chosen.
 * Nothing is hidden: controls disable in place.
 *
 * The operator list and its arity come from `@otterdeploy/data-engine`, the
 * same module the server compiles with — so an operator can never appear here
 * that the server would not accept, and `between` gets two inputs because the
 * model says it takes two, not because this file remembered to special-case it.
 */
import type { FilterOp } from "@otterdeploy/data-engine";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { FILTER_OP_GROUPS, FILTER_OP_META, FILTER_OPS } from "@otterdeploy/data-engine";

import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import type { DraftFilter } from "../data/filter-draft";

import { isListOp, operandAt, operandCount, withOperand } from "../data/filter-draft";

/** Operators grouped for the picker, in the shared model's display order. */
const GROUPED_OPS = FILTER_OP_GROUPS.map((g) => ({
  ...g,
  ops: FILTER_OPS.filter((op) => FILTER_OP_META[op].group === g.group),
})).filter((g) => g.ops.length > 0);

export function FilterBar({
  columns,
  filters,
  onChange,
}: {
  columns: string[];
  filters: DraftFilter[];
  onChange: (next: DraftFilter[]) => void;
}) {
  const patch = (id: string, p: Partial<DraftFilter>) =>
    onChange(filters.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const patchOperand = (filter: DraftFilter, index: number, value: string) =>
    onChange(filters.map((f) => (f.id === filter.id ? withOperand(f, index, value) : f)));
  const remove = (id: string) => onChange(filters.filter((f) => f.id !== id));

  return (
    <div className="flex flex-col">
      {filters.map((f) => {
        const operands = operandCount(f.op);
        return (
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
              onValueChange={(v) => patch(f.id, { op: asFilterOp(v) })}
            >
              <SelectTrigger size="sm" className="w-36 text-[12px]">
                <SelectValue placeholder="Operator..." />
              </SelectTrigger>
              {/* Size to the labels, not the trigger, so long ones aren't clipped. */}
              <SelectContent alignItemWithTrigger={false} className="w-auto px-1">
                {GROUPED_OPS.map((group) => (
                  <SelectGroup key={group.group}>
                    <SelectLabel className="text-[10px] tracking-wide uppercase">
                      {group.label}
                    </SelectLabel>
                    {group.ops.map((op) => (
                      <SelectItem key={op} value={op} className="text-[12px] whitespace-nowrap">
                        {FILTER_OP_META[op].label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>

            <div className="flex flex-1 items-center gap-1.5">
              {operands === 0 ? (
                <Input
                  value=""
                  disabled
                  placeholder="No value needed"
                  className="h-8 flex-1 text-[12px]"
                />
              ) : (
                Array.from({ length: operands }).map((_, i) => (
                  <Input
                    key={i}
                    value={operandAt(f, i)}
                    onChange={(e) => patchOperand(f, i, e.target.value)}
                    placeholder={operandPlaceholder(f.op, i)}
                    disabled={!f.column}
                    className="h-8 min-w-0 flex-1 font-mono text-[12px]"
                  />
                ))
              )}
            </div>

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
        );
      })}
    </div>
  );
}

/** Narrow the Select's string back to an operator without an assertion. */
function asFilterOp(value: string | null): FilterOp {
  const hit = FILTER_OPS.find((op) => op === value);
  return hit ?? "eq";
}

function operandPlaceholder(op: FilterOp, index: number): string {
  if (isListOp(op)) return "a, b, c";
  if (FILTER_OP_META[op].arity === 2) return index === 0 ? "From..." : "To...";
  return "Value...";
}

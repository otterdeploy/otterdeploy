/**
 * Foreign-key reference popover. Clicking a FK cell's link icon opens this,
 * anchored to that cell: it looks up the referenced row
 * (`SELECT * FROM ref WHERE refcol = value LIMIT 1`, read-only) and shows its
 * fields, with an action to open that table pre-filtered to the row.
 */

import type { ResourceId } from "@otterdeploy/shared/id";
import { Link01Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { FkTarget } from "@/shared/components/data-grid/types";

import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent } from "@/shared/components/ui/popover";

import { useReferencedRow } from "../data/use-database";

export function FkRefPopover({
  resourceId,
  fk,
  value,
  anchor,
  onOpenChange,
  onOpenRef,
}: {
  resourceId: ResourceId;
  fk: FkTarget;
  value: string;
  anchor: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onOpenRef: (fk: FkTarget, value: string) => void;
}) {
  const q = useReferencedRow({ resourceId: String(resourceId), fk, value });
  const cols = q.data?.columns ?? [];
  const row = q.data?.rows?.[0];

  return (
    <Popover open onOpenChange={onOpenChange}>
      <PopoverContent
        anchor={anchor ?? undefined}
        align="start"
        side="bottom"
        className="w-[380px] max-w-[92vw] gap-0 p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium">
            <HugeiconsIcon
              icon={Link01Icon}
              strokeWidth={2}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="truncate font-mono">
              {fk.schema}.{fk.table}.{fk.column}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Open ${fk.table} filtered to this row`}
            onClick={() => {
              onOpenRef(fk, value);
              onOpenChange(false);
            }}
          >
            <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} className="size-4" />
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {q.isLoading ? (
            <p className="px-3 py-3 text-[12px] text-muted-foreground">Loading…</p>
          ) : !row ? (
            <p className="px-3 py-3 text-[12px] text-muted-foreground">No matching row.</p>
          ) : (
            cols.map((c, i) => (
              <div key={c} className="flex gap-3 px-3 py-1.5 text-[12px]">
                <span className="w-32 shrink-0 truncate text-muted-foreground">{c}</span>
                <span className="min-w-0 flex-1 truncate font-mono">
                  {row[i] == null ? (
                    <span className="text-muted-foreground/40 italic">NULL</span>
                  ) : (
                    row[i]
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

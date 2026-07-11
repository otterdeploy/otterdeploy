/**
 * Query-history popover — the SQL console's execution log (last ~50 statements
 * for this database, successes and failures, browser-local). Each entry shows a
 * one-line statement preview with rows · duration (or the error) and a status
 * dot; clicking loads the statement into the Playground buffer.
 */

import { Clock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";

import type { QueryHistoryEntry } from "../data/query-history";

function timeAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function HistoryPopover({
  entries,
  onPick,
  onClear,
  trigger,
}: {
  entries: QueryHistoryEntry[];
  onPick: (sql: string) => void;
  onClear: () => void;
  trigger: React.ReactElement;
}) {
  return (
    <Popover>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-96 max-w-[92vw] gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} className="size-3" />
            Query history
          </span>
          {entries.length > 0 ? (
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[11px]" onClick={onClear}>
              Clear
            </Button>
          ) : null}
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {entries.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-muted-foreground">
              Nothing yet — statements you run land here, including failures.
            </p>
          ) : (
            entries.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onPick(e.sql)}
                className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/60"
                title={e.sql}
              >
                <span className="w-full truncate font-mono text-[11.5px]">
                  {e.sql.replace(/\s+/g, " ")}
                </span>
                <span className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      e.ok ? "bg-emerald-500" : "bg-destructive",
                    )}
                  />
                  {e.ok ? (
                    <span className="font-mono">
                      {e.rowCount ?? 0} row{e.rowCount === 1 ? "" : "s"}
                      {e.durationMs !== null ? ` · ${e.durationMs}ms` : ""}
                    </span>
                  ) : (
                    <span className="truncate text-destructive/80">{e.error ?? "failed"}</span>
                  )}
                  <span className="ml-auto shrink-0">{timeAgo(e.at)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The other events from the same operation.
 *
 * One user action fans out into several audit rows — a deploy writes a build,
 * a container start and a route update — and they share a `correlationId`. An
 * audit reader almost never wants one row; they want the story it belongs to.
 *
 * Rendered inside the row sheet, and each entry opens that row in place, so
 * walking a correlation never leaves the table.
 */

import { useQuery } from "@tanstack/react-query";

import type { AuditFeedRow } from "@otterdeploy/api/routers/audit/contract";

import { Skeleton } from "@/shared/components/ui/skeleton";
import { CLOCK_STAMP, clockFormatter } from "@/shared/lib/clock";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

const stamp = clockFormatter(CLOCK_STAMP);

export function AuditCorrelated({
  row,
  onOpenRow,
}: {
  row: AuditFeedRow;
  onOpenRow: (rowId: string) => void;
}) {
  const hasLinks = Boolean(row.correlationId ?? row.causationId);

  const related = useQuery({
    ...orpc.audit.byCorrelation.queryOptions({
      input: {
        correlationId: row.correlationId ?? undefined,
        causationId: row.causationId ?? undefined,
        limit: 50,
      },
    }),
    enabled: hasLinks,
    staleTime: 60_000,
  });

  if (!hasLinks) return null;

  const siblings = (related.data?.items ?? []).filter((item) => item.id !== row.id);

  return (
    <section className="px-4 py-3">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">Same operation</h3>

      {related.isLoading ? (
        <div className="grid gap-1.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : siblings.length === 0 ? (
        // An operation that wrote exactly one row is a real answer, and saying
        // so beats an empty box that reads as a failure to load.
        <p className="text-xs text-muted-foreground">
          Nothing else was recorded for this operation.
        </p>
      ) : (
        <ul className="grid gap-0.5">
          {siblings.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpenRow(item.id)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    item.outcome === "denied"
                      ? "bg-destructive"
                      : item.outcome === "failure"
                        ? "bg-warning"
                        : "bg-success",
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{item.action}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {stamp(Date.parse(item.timestamp))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

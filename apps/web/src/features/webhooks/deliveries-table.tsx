/**
 * Recent outbound delivery attempts (org-wide, newest first). Append-only
 * server data — a plain polling query, not a collection. One row per ATTEMPT
 * (retries show as #2/#3 against the same target), matching the demo's
 * time / target / event / code / attempt / latency table.
 */
import { useQuery } from "@tanstack/react-query";

import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { codeTone } from "./shared";

const SLOW_MS = 1000;

function timeOf(d: Date): string {
  return new Date(d).toLocaleTimeString(undefined, { hour12: false });
}

export function DeliveriesTable() {
  const { data: deliveries, isLoading } = useQuery({
    ...orpc.webhooks.deliveries.list.queryOptions({ input: { limit: 50 } }),
    refetchInterval: 15_000,
  });

  return (
    <div>
      <div className="mb-2 text-[10px] tracking-wider text-muted-foreground uppercase">
        Recent deliveries
      </div>
      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Time</TableHead>
              <TableHead>Target</TableHead>
              <TableHead className="w-44">Event</TableHead>
              <TableHead className="w-16 text-right">Code</TableHead>
              <TableHead className="w-16 text-right">Attempt</TableHead>
              <TableHead className="w-20 text-right">Latency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : deliveries && deliveries.length > 0 ? (
              deliveries.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {timeOf(d.createdAt)}
                  </TableCell>
                  <TableCell className="font-mono text-[11.5px]">{d.target}</TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {d.event}
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      title={d.error ?? undefined}
                      className={cn("font-mono text-[11px] font-medium", codeTone(d.statusCode))}
                    >
                      {d.statusCode ?? "ERR"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] text-muted-foreground">
                    #{d.attempt}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-[11px]",
                      d.latencyMs > SLOW_MS
                        ? "text-amber-600 dark:text-amber-500"
                        : "text-muted-foreground",
                    )}
                  >
                    {d.latencyMs}ms
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-6 text-center text-[12px] text-muted-foreground"
                >
                  No deliveries yet — they'll appear here when a subscribed event fires or you send
                  a test.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

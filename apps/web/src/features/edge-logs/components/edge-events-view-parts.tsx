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

import { Detail } from "./edge-logs-shared";

export type EdgeEvent = Awaited<ReturnType<typeof orpc.edgeLogs.events.query.call>>["rows"][number];

export const CATEGORIES = ["cert", "upstream", "config", "other"] as const;
export const LEVELS = ["error", "warn", "info"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Level = (typeof LEVELS)[number];

export const LEVEL_TEXT: Record<string, string> = {
  error: "text-destructive",
  warn: "text-amber-500",
  info: "text-sky-500",
  debug: "text-muted-foreground",
};
export const CATEGORY_TEXT: Record<string, string> = {
  cert: "text-sky-500",
  upstream: "text-amber-500",
  config: "text-muted-foreground",
  other: "text-muted-foreground",
};

/** Event table — full bleed, separators only. */
export function EventsTable({
  rows,
  wrap,
  expanded,
  setExpanded,
  isLoading,
}: {
  rows: EdgeEvent[];
  wrap: boolean;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  isLoading: boolean;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <Table className="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
        <TableHeader>
          <TableRow className="border-b bg-muted/30 hover:bg-transparent">
            <TableHead className="w-8" />
            {["Time", "Level", "Category", "Host", "Message"].map((h) => (
              <TableHead
                key={h}
                className="h-8 text-[10px] font-semibold tracking-[0.06em] uppercase"
              >
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={6}
                className="py-10 text-center text-[13px] text-muted-foreground"
              >
                {isLoading
                  ? "Loading…"
                  : "No edge events in this window. Certificate activity and upstream errors for your domains appear here."}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <EventRow
                key={r.id}
                row={r}
                wrap={wrap}
                open={expanded === r.id}
                onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function EventRow({
  row,
  wrap,
  open,
  onToggle,
}: {
  row: EdgeEvent;
  wrap: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow className="cursor-pointer font-mono text-[12px]" onClick={onToggle}>
        <TableCell className="text-muted-foreground">
          <span className={cn("inline-block transition-transform", open && "rotate-90")}>›</span>
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {new Date(row.ts).toLocaleTimeString()}
        </TableCell>
        <TableCell>
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase",
              LEVEL_TEXT[row.level],
            )}
          >
            {row.level}
          </span>
        </TableCell>
        <TableCell className={cn("font-semibold", CATEGORY_TEXT[row.category])}>
          {row.category}
        </TableCell>
        <TableCell className="text-foreground/80">
          {row.host ?? (row.domains.length ? `${row.domains.length} domains` : "—")}
        </TableCell>
        <TableCell
          className={cn(
            "text-foreground/80",
            wrap ? "max-w-[520px] break-all" : "max-w-[360px] truncate",
          )}
        >
          {row.msg}
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={6} className="py-3">
            <div className="w-0 min-w-full overflow-hidden">
              <div className="grid grid-cols-2 gap-x-10 gap-y-1 font-mono text-[12px]">
                <Detail k="logger" v={row.logger} wrap={wrap} />
                {row.upstream ? <Detail k="upstream" v={row.upstream} wrap={wrap} /> : null}
                {row.error ? <Detail k="error" v={row.error} wrap={wrap} wide /> : null}
                {row.domains.length ? (
                  <Detail k="domains" v={row.domains.join(", ")} wrap={wrap} wide />
                ) : null}
              </div>
              <div className="mt-3">
                <div className="mb-1.5 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                  Raw
                </div>
                <pre
                  className={cn(
                    "max-h-64 overflow-auto rounded-md border bg-background/60 p-3 font-mono text-[11.5px] leading-relaxed",
                    wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre",
                  )}
                >
                  {row.raw}
                </pre>
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

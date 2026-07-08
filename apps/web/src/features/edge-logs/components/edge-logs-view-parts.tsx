import { useMemo } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

import { BUCKET_BG, type EdgeLog, type EdgeLogsData } from "./edge-logs-constants";
import { EdgeRow } from "./edge-logs-row";

function Bar({ n, total, cls }: { n: number; total: number; cls: string }) {
  if (n === 0 || total === 0) return null;
  return <div className={cls} style={{ height: `${(n / total) * 100}%` }} />;
}

/** Volume histogram, stacked by status bucket. */
export function LogHistogram({ data, range }: { data: EdgeLogsData | undefined; range: string }) {
  const maxBucket = useMemo(
    () => Math.max(1, ...(data?.histogram ?? []).map((b) => b.c2xx + b.c3xx + b.c4xx + b.c5xx)),
    [data?.histogram],
  );
  return (
    <div className="border-b px-4 pt-3 pb-2">
      <div className="mb-1.5 flex items-center">
        <span className="text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          Volume
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[11px] text-muted-foreground">
          {data?.total ?? 0} matched
        </span>
      </div>
      <div className="flex h-[52px] items-end gap-px">
        {(data?.histogram ?? []).map((b) => {
          const total = b.c2xx + b.c3xx + b.c4xx + b.c5xx;
          const h = (total / maxBucket) * 100;
          return (
            <div
              key={b.t}
              className="flex flex-1 flex-col-reverse"
              style={{ height: `${Math.max(2, h)}%`, minHeight: 1 }}
              title={`${new Date(b.t).toLocaleTimeString()} · ${total} req`}
            >
              <Bar n={b.c2xx} total={total} cls={BUCKET_BG["2xx"]} />
              <Bar n={b.c3xx} total={total} cls={BUCKET_BG["3xx"]} />
              <Bar n={b.c4xx} total={total} cls={BUCKET_BG["4xx"]} />
              <Bar n={b.c5xx} total={total} cls={BUCKET_BG["5xx"]} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex font-mono text-[10px] text-muted-foreground/70">
        <span>−{range}</span>
        <div className="flex-1" />
        <span>now</span>
      </div>
    </div>
  );
}

/** Log table — full bleed, separators only. */
export function LogTable({
  rows,
  wrap,
  expanded,
  setExpanded,
  isLoading,
  onBlockIp,
  blocking,
}: {
  rows: EdgeLog[];
  wrap: boolean;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  isLoading: boolean;
  onBlockIp: (ip: string) => void;
  blocking: boolean;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* Inset the first/last cells to 16px so content aligns with the
          other sections (px-4), while row borders/header bg stay full-bleed. */}
      <Table className="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
        <TableHeader>
          <TableRow className="border-b bg-muted/30 hover:bg-transparent">
            <TableHead className="w-8" />
            {["Time", "Method", "Status", "Host", "Path", "Latency", "Client IP", "Country"].map(
              (h) => (
                <TableHead
                  key={h}
                  className="h-8 text-[10px] font-semibold tracking-[0.06em] uppercase"
                >
                  {h}
                </TableHead>
              ),
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={9}
                className="py-10 text-center text-[13px] text-muted-foreground"
              >
                {isLoading
                  ? "Loading…"
                  : "No edge requests in this window. Traffic to your public domains appears here."}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <EdgeRow
                key={r.id}
                row={r}
                wrap={wrap}
                open={expanded === r.id}
                onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                onBlockIp={onBlockIp}
                blocking={blocking}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** Per-host footer — request rate and latency percentiles. */
export function HostFooter({ data }: { data: EdgeLogsData | undefined }) {
  const hostStats = data?.hostStats ?? [];
  if (hostStats.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2 border-t px-4 py-3 font-mono text-[11px] text-muted-foreground">
      {hostStats.map((s) => (
        <div key={s.host} className="flex items-center gap-2">
          <span className="text-foreground/80">{s.host}</span>
          <span>{s.rps} rps</span>
          <span className={cn(s.errorRate > 0.05 ? "text-destructive" : "")}>
            {(s.errorRate * 100).toFixed(1)}% err
          </span>
          <span>p50 {s.p50}ms</span>
          <span>p95 {s.p95}ms</span>
          <span>p99 {s.p99}ms</span>
        </div>
      ))}
    </div>
  );
}

export function exportCsv(rows: EdgeLog[]) {
  const header = "time,method,status,host,path,latency_ms,client_ip,country,user_agent";
  const body = rows
    .map((r) =>
      [
        r.ts,
        r.method,
        r.status,
        r.host,
        r.path,
        r.latencyMs,
        r.clientIp,
        r.country ?? "",
        `"${r.userAgent}"`,
      ].join(","),
    )
    .join("\n");
  const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "edge-logs.csv";
  a.click();
  URL.revokeObjectURL(url);
}

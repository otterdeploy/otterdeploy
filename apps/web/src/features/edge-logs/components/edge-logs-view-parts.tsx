import { useMemo, useState } from "react";

import { PublicHostLink } from "@/shared/components/public-host-link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

import {
  BUCKET_BG,
  type EdgeHostStat,
  type EdgeLog,
  type EdgeLogsData,
  errRateClass,
} from "./edge-logs-constants";
import { EdgeRow } from "./edge-logs-row";

function Bar({ n, total, cls }: { n: number; total: number; cls: string }) {
  if (n === 0 || total === 0) return null;
  return <div className={cls} style={{ height: `${(n / total) * 100}%` }} />;
}

/** Volume histogram, stacked by status bucket. */
export function LogHistogram({ data, range }: { data: EdgeLogsData | undefined; range: string }) {
  const maxBucket = Math.max(
    1,
    ...(data?.histogram ?? []).map((b) => b.c2xx + b.c3xx + b.c4xx + b.c5xx),
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
  bannedIps,
}: {
  rows: EdgeLog[];
  wrap: boolean;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  isLoading: boolean;
  /** Omitted when the viewer can't block — CrowdSec is install-scoped. */
  onBlockIp?: (ip: string) => void;
  blocking: boolean;
  /** Client IPs with an active CrowdSec ban — their rows get a blocked marker. */
  bannedIps: Set<string>;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* Inset the first/last cells to 16px so content aligns with the
          other sections (px-4), while row borders/header bg stay full-bleed. */}
      <Table className="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
        <TableHeader>
          <TableRow className="border-b bg-muted/30 hover:bg-transparent">
            <TableHead className="w-8" />
            {[
              "Time",
              "Method",
              "Status",
              "Host",
              "Path",
              "Latency",
              "Client IP",
              "Country",
              "UA",
            ].map((h) => (
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
                colSpan={10}
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
                banned={bannedIps.has(r.clientIp)}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** Hosts shown before the footer folds the remainder into one summary row. */
const HOST_FOOTER_VISIBLE = 2;

/**
 * Worst first: any host serving errors outranks any healthy one, then busiest,
 * then name (stable — `hostStats` arrives in first-seen order, which reshuffles
 * on every 2s poll). The two rows that survive the fold are the two an operator
 * would have scanned for anyway.
 */
function byUrgency(a: EdgeHostStat, b: EdgeHostStat): number {
  return b.errorRate - a.errorRate || b.rps - a.rps || a.host.localeCompare(b.host);
}

/** Numbers row, shared by a host row and the folded remainder. */
function HostStatCells({
  s,
}: {
  s: Pick<EdgeHostStat, "rps" | "errorRate" | "p50" | "p95" | "p99">;
}) {
  return (
    <>
      <span className="w-20 shrink-0 text-right tabular-nums">{s.rps} rps</span>
      {/* Two-tier tint per the demo: ≥2% red, ≥0.5% amber. */}
      <span className={cn("w-20 shrink-0 text-right tabular-nums", errRateClass(s.errorRate))}>
        {(s.errorRate * 100).toFixed(1)}% err
      </span>
      <span className="w-24 shrink-0 text-right tabular-nums">p50 {s.p50}ms</span>
      <span className="w-24 shrink-0 text-right tabular-nums">p95 {s.p95}ms</span>
      <span className="w-24 shrink-0 text-right tabular-nums">p99 {s.p99}ms</span>
    </>
  );
}

/**
 * Per-host footer — request rate and latency percentiles.
 *
 * One row per host, columns aligned. This used to be `flex flex-wrap gap-x-8`,
 * which packed as many hosts per line as fitted and let every number land at a
 * different x — so a host with a long name pushed its own figures somewhere no
 * other row's figures were, and two hosts sharing a line read as one sentence.
 * At four public hosts it was already unreadable.
 *
 * The list is capped at two rows because it grows with the org's public hosts
 * (preview deploys mint one per PR) and it is a sibling of the scrolling log
 * table — every extra row is a row taken off the table. The rest fold into one
 * summary row that expands.
 *
 * The summary is **worst-case, not averaged**: percentiles cannot be pooled
 * without the underlying samples, and a mean would hide the one bad host, which
 * is the only reason to look at this footer. `rps` sums (that one is additive),
 * everything else is a max — labelled `worst of` so the numbers aren't read as
 * one host's.
 *
 * The host is a link: a domain shown to an operator is a domain they want to
 * open, and this was previously inert text they had to select and paste.
 */
export function HostFooter({ data }: { data: EdgeLogsData | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const hostStats = useMemo(() => [...(data?.hostStats ?? [])].sort(byUrgency), [data?.hostStats]);

  if (hostStats.length === 0) return null;

  // Folding one host away costs a click and saves nothing — the summary row
  // occupies the height the host row would have.
  const folded = !expanded && hostStats.length > HOST_FOOTER_VISIBLE + 1;
  const shown = folded ? hostStats.slice(0, HOST_FOOTER_VISIBLE) : hostStats;
  const rest = folded ? hostStats.slice(HOST_FOOTER_VISIBLE) : [];

  return (
    <div className="border-t font-mono text-[11px] text-muted-foreground">
      <div className={cn(expanded && "max-h-[30vh] overflow-y-auto")}>
        {shown.map((s) => (
          <div
            key={s.host}
            className="flex items-center gap-3 border-b border-border/40 px-4 py-1.5 last:border-b-0"
          >
            <PublicHostLink host={s.host} className="min-w-0 flex-1 text-foreground/80" />
            <HostStatCells s={s} />
          </div>
        ))}
      </div>

      {rest.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          title={rest.map((s) => s.host).join("\n")}
          className="flex w-full items-center gap-3 border-t border-border/40 px-4 py-1.5 text-left hover:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="min-w-0 flex-1 truncate">
            +{rest.length} more hosts
            <span className="ml-1.5 text-muted-foreground/60">worst of</span>
          </span>
          <HostStatCells s={worstOf(rest)} />
        </button>
      ) : null}

      {expanded && hostStats.length > HOST_FOOTER_VISIBLE + 1 ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-expanded={true}
          className="w-full border-t border-border/40 px-4 py-1.5 text-left hover:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        >
          Show top {HOST_FOOTER_VISIBLE}
        </button>
      ) : null}
    </div>
  );
}

/** Additive for rate, max for everything else — see `HostFooter`. */
function worstOf(stats: EdgeHostStat[]) {
  return {
    rps: +stats.reduce((n, s) => n + s.rps, 0).toFixed(2),
    errorRate: Math.max(...stats.map((s) => s.errorRate)),
    p50: Math.max(...stats.map((s) => s.p50)),
    p95: Math.max(...stats.map((s) => s.p95)),
    p99: Math.max(...stats.map((s) => s.p99)),
  };
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

import { useMemo, useState } from "react";
import { Download01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
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

import { HostFilter } from "./host-filter";

type EdgeLog = Awaited<
  ReturnType<typeof orpc.edgeLogs.query.call>
>["rows"][number];

const RANGES = ["5m", "1h", "6h", "24h", "7d"] as const;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const BUCKETS = ["2xx", "3xx", "4xx", "5xx"] as const;
type Range = (typeof RANGES)[number];
type Method = (typeof METHODS)[number];
type Bucket = (typeof BUCKETS)[number];

const BUCKET_BG: Record<Bucket, string> = {
  "2xx": "bg-success",
  "3xx": "bg-sky-500",
  "4xx": "bg-amber-500",
  "5xx": "bg-destructive",
};
const BUCKET_TEXT: Record<Bucket, string> = {
  "2xx": "text-success",
  "3xx": "text-sky-500",
  "4xx": "text-amber-500",
  "5xx": "text-destructive",
};
const METHOD_TEXT: Record<string, string> = {
  GET: "text-sky-500",
  POST: "text-success",
  PUT: "text-amber-500",
  PATCH: "text-amber-500",
  DELETE: "text-destructive",
};

function statusBucket(s: number): Bucket {
  if (s >= 500) return "5xx";
  if (s >= 400) return "4xx";
  if (s >= 300) return "3xx";
  return "2xx";
}

/**
 * Edge access logs view. Scoped to one project's domains when `projectId` is
 * given, otherwise all the org's domains. Full-bleed table (no card box),
 * matching the design — sectioned by border-b separators.
 */
export function EdgeLogsView({ projectId }: { projectId?: string }) {
  const [range, setRange] = useState<Range>("1h");
  const [methods, setMethods] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [hostFilter, setHostFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = useQuery({
    ...orpc.edgeLogs.query.queryOptions({
      input: {
        projectId,
        range,
        methods: methods.size ? [...methods] : undefined,
        statuses: statuses.size
          ? ([...statuses] as ("2xx" | "3xx" | "4xx" | "5xx")[])
          : undefined,
        hosts: hostFilter.length ? hostFilter : undefined,
        search: search.trim() || undefined,
      },
    }),
    refetchInterval: live ? 2000 : false,
  });

  const data = query.data;
  const rows = data?.rows ?? [];
  const hostOptions = useMemo(
    () => (data?.hostStats ?? []).map((s) => s.host).sort(),
    [data?.hostStats],
  );
  const maxBucket = useMemo(
    () =>
      Math.max(
        1,
        ...(data?.histogram ?? []).map((b) => b.c2xx + b.c3xx + b.c4xx + b.c5xx),
      ),
    [data?.histogram],
  );

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold">Edge access logs</h1>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[11px]",
              live ? "text-success" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                live ? "animate-pulse bg-success" : "bg-muted-foreground",
              )}
            />
            {live ? "live tail" : "paused"}
          </span>
        </div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Every HTTP request that hit the Caddy edge proxy. Live-tailed from
          Caddy's structured access log.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Segmented options={RANGES} value={range} onChange={(v) => setRange(v as Range)} />
        <Chips
          options={METHODS}
          selected={methods}
          colors={METHOD_TEXT}
          onToggle={(v) => setMethods((s) => toggleSet(s, v))}
        />
        <Chips
          options={BUCKETS}
          selected={statuses}
          colors={BUCKET_TEXT}
          onToggle={(v) => setStatuses((s) => toggleSet(s, v))}
        />
        <HostFilter
          options={hostOptions}
          value={hostFilter}
          onChange={setHostFilter}
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search path, ip, status…"
          className="h-8 max-w-xs text-[12px]"
        />
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          className={cn(wrap && "bg-muted")}
          onClick={() => setWrap((v) => !v)}
          title="Wrap long values in expanded rows instead of truncating"
        >
          Wrap
        </Button>
        <Button variant="outline" size="sm" onClick={() => setLive((v) => !v)}>
          {live ? "Pause" : "Resume"}
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportCsv(rows)}>
          <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-3.5" />
          Export
        </Button>
      </div>

      {/* Volume histogram */}
      <div className="border-b px-4 pb-2 pt-3">
        <div className="mb-1.5 flex items-center">
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
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

      {/* Log table — full bleed, separators only */}
      <div className="min-h-0 flex-1 overflow-auto">
        {/* Inset the first/last cells to 16px so content aligns with the
            other sections (px-4), while row borders/header bg stay full-bleed. */}
        <Table className="[&_td:first-child]:pl-4 [&_th:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:last-child]:pr-4">
          <TableHeader>
            <TableRow className="border-b bg-muted/30 hover:bg-transparent">
              <TableHead className="w-8" />
              {["Time", "Method", "Status", "Host", "Path", "Latency", "Client IP"].map(
                (h) => (
                  <TableHead
                    key={h}
                    className="h-8 text-[10px] font-semibold uppercase tracking-[0.06em]"
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
                  colSpan={8}
                  className="py-10 text-center text-[13px] text-muted-foreground"
                >
                  {query.isLoading
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
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Per-host footer */}
      {(data?.hostStats ?? []).length > 0 ? (
        <div className="flex flex-wrap gap-x-8 gap-y-2 border-t px-4 py-3 font-mono text-[11px] text-muted-foreground">
          {data!.hostStats.map((s) => (
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
      ) : null}
    </div>
  );
}

function Bar({ n, total, cls }: { n: number; total: number; cls: string }) {
  if (n === 0 || total === 0) return null;
  return <div className={cls} style={{ height: `${(n / total) * 100}%` }} />;
}

function toggleSet(set: Set<string>, v: string): Set<string> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

/** Multi-select filter chips. Empty selection = no filter (all shown, chips
 *  dimmed); selecting any narrows to those, OR-combined. */
function Chips({
  options,
  selected,
  onToggle,
  colors,
}: {
  options: readonly string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  colors: Record<string, string>;
}) {
  const none = selected.size === 0;
  return (
    <div className="flex items-center gap-0.5 rounded-md border p-0.5">
      {options.map((o) => {
        const active = selected.has(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium transition-all",
              colors[o],
              active && "bg-muted",
              !active && !none && "opacity-40 hover:opacity-100",
              !active && none && "opacity-80 hover:opacity-100",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
  colors,
}: {
  options: readonly string[];
  value: string | null;
  onChange: (v: string) => void;
  /** Optional per-option text color (matches the design's tinted filters). */
  colors?: Record<string, string>;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border p-0.5">
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium transition-colors",
              colors?.[o] ?? (active ? "text-foreground" : "text-muted-foreground"),
              active ? "bg-muted" : "hover:bg-muted/60",
              !colors && !active && "hover:text-foreground",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function EdgeRow({
  row,
  wrap,
  open,
  onToggle,
}: {
  row: EdgeLog;
  wrap: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const b = statusBucket(row.status);
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
              "rounded border px-1.5 py-0.5 text-[10px] font-semibold",
              METHOD_TEXT[row.method],
            )}
          >
            {row.method}
          </span>
        </TableCell>
        <TableCell
          className={cn(
            "font-semibold",
            row.status === 0 ? "text-muted-foreground/70" : BUCKET_TEXT[b],
          )}
          title={
            row.status === 0
              ? "No response — the client aborted the request"
              : undefined
          }
        >
          {row.status === 0 ? "—" : row.status}
        </TableCell>
        <TableCell className="text-foreground/80">{row.host}</TableCell>
        <TableCell
          className={cn(
            "text-foreground/80",
            wrap ? "max-w-[420px] break-all" : "max-w-[280px] truncate",
          )}
        >
          {row.path}
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {row.latencyMs}ms
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">{row.clientIp}</TableCell>
      </TableRow>
      {open ? (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={8} className="py-3">
            {/* w-0 min-w-full: this colSpan cell is in an auto-layout table, so
                its content's intrinsic width drives column sizing — a single
                long value (next-router-state-tree, user-agent) blows the whole
                table past the viewport and makes truncate impossible. width:0
                stops the content from contributing that width; min-width:100%
                then re-expands the wrapper to the cell, giving the truncate
                children below a bounded width to shrink into. */}
            <div className="w-0 min-w-full overflow-hidden">
            <div className="grid grid-cols-2 gap-x-10 gap-y-1 font-mono text-[12px]">
              <Detail k="request_id" v={row.requestId ?? "—"} wrap={wrap} />
              <Detail k="cache" v={row.cache ?? "—"} wrap={wrap} />
              <Detail k="upstream" v={row.upstream ?? "—"} wrap={wrap} />
              <Detail
                k="tls"
                v={[row.tlsVersion, row.tlsCipher].filter(Boolean).join(" · ") || "—"}
                wrap={wrap}
              />
              <Detail k="req bytes" v={String(row.reqBytes)} wrap={wrap} />
              <Detail k="res bytes" v={String(row.resBytes)} wrap={wrap} />
              <Detail k="referer" v={row.referer} wrap={wrap} wide />
              {row.country ? <Detail k="country" v={row.country} wrap={wrap} /> : null}
              <Detail k="user-agent" v={row.userAgent} wrap={wrap} wide />
            </div>

            {Object.keys(row.headers).length > 0 ? (
              <div className="mt-3">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Headers preview
                </div>
                {/* Per-header rows (not one <pre>): a single long value like
                    next-router-state-tree gives a <pre> a huge min-content
                    width that expands the whole table past the viewport.
                    min-w-0 + truncate lets each value shrink instead; the
                    Wrap toggle expands to the full value, and the title
                    surfaces it on hover. Capped height with vertical scroll. */}
                <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border bg-background/60 p-3 font-mono text-[11.5px] leading-relaxed">
                  {Object.entries(row.headers).map(([k, v]) => (
                    <div key={k} className="flex min-w-0 gap-2">
                      <span className="shrink-0 text-muted-foreground">
                        {k.toLowerCase()}:
                      </span>
                      <span
                        className={cn(
                          "min-w-0 text-foreground/80",
                          wrap ? "break-all" : "truncate",
                        )}
                        title={v}
                      >
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function Detail({
  k,
  v,
  wide,
  wrap,
}: {
  k: string;
  v: string;
  wide?: boolean;
  wrap?: boolean;
}) {
  return (
    // min-w-0: without it this flex item (and grid cell) keeps its intrinsic
    // content width, so a long value (user-agent, referer) overflows instead of
    // truncating. With it, the value span can shrink and truncate/wrap kicks in.
    <div className={cn("flex min-w-0 gap-2", wide && "col-span-2")}>
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className={cn("min-w-0 text-foreground/90", wrap ? "break-all" : "truncate")}>
        {v}
      </span>
    </div>
  );
}

function exportCsv(rows: EdgeLog[]) {
  const header = "time,method,status,host,path,latency_ms,client_ip,user_agent";
  const body = rows
    .map((r) =>
      [r.ts, r.method, r.status, r.host, r.path, r.latencyMs, r.clientIp, `"${r.userAgent}"`].join(
        ",",
      ),
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

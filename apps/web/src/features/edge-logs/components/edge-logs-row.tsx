import { TableCell, TableRow } from "@/shared/components/ui/table";
import { flagEmoji } from "@/shared/lib/flag";
import { cn } from "@/shared/lib/utils";

import { classifyThreat } from "../threat";
import { BlockIpButton } from "./edge-logs-block-ip";
import {
  BUCKET_TEXT,
  cacheTextClass,
  type EdgeLog,
  latencyBarClass,
  latencyBarPct,
  METHOD_TEXT,
  statusBucket,
} from "./edge-logs-constants";
import { Detail } from "./edge-logs-shared";
import { shortUserAgent } from "./edge-logs-ua";

export function EdgeRow({
  row,
  wrap,
  open,
  onToggle,
  onBlockIp,
  blocking,
  banned,
}: {
  row: EdgeLog;
  wrap: boolean;
  open: boolean;
  onToggle: () => void;
  onBlockIp: (ip: string) => void;
  blocking: boolean;
  /** This client IP currently has an active CrowdSec ban. */
  banned: boolean;
}) {
  const b = statusBucket(row.status);
  const threat = classifyThreat(row.path);
  return (
    <>
      <TableRow
        className={cn(
          "cursor-pointer font-mono text-[12px]",
          threat && "bg-destructive/[0.04] hover:bg-destructive/[0.07]",
        )}
        onClick={onToggle}
      >
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
          title={row.status === 0 ? "No response — the client aborted the request" : undefined}
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
          {threat ? (
            <span
              className="mr-1.5 inline-block rounded-sm bg-destructive/15 px-1 py-px align-middle text-[9px] font-semibold tracking-[0.04em] text-destructive uppercase"
              title={`Suspicious request — ${threat.replace(/-/g, " ")}. Likely a vulnerability scanner.`}
            >
              {threat}
            </span>
          ) : null}
          {row.path}
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            {row.latencyMs}ms
            {/* 22px proportional mini-bar (1s full scale) — reads the row's
                latency at a glance without scanning digits. */}
            <span
              aria-hidden
              className="inline-block h-1 w-[22px] overflow-hidden rounded-full bg-muted"
            >
              <span
                className={cn("block h-full", latencyBarClass(row.latencyMs))}
                style={{ width: `${latencyBarPct(row.latencyMs)}%` }}
              />
            </span>
          </span>
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {row.clientIp}
          {banned ? (
            <span
              className="ml-1.5 inline-block rounded-sm bg-foreground/10 px-1 py-px align-middle text-[9px] font-semibold tracking-[0.04em] text-foreground/70 uppercase"
              title="This IP has an active CrowdSec ban — new requests are rejected at the edge."
            >
              blocked
            </span>
          ) : null}
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {row.country ? (
            <span title={row.country}>
              <span className="mr-1">{flagEmoji(row.country)}</span>
              {row.country}
            </span>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </TableCell>
        <TableCell
          className="max-w-[150px] truncate text-[11px] text-muted-foreground"
          title={row.userAgent}
        >
          {shortUserAgent(row.userAgent)}
        </TableCell>
      </TableRow>
      {open ? (
        <EdgeRowDetail
          row={row}
          wrap={wrap}
          onBlockIp={onBlockIp}
          blocking={blocking}
          banned={banned}
        />
      ) : null}
    </>
  );
}

/** Expanded per-request detail: client IP + block action, the field grid, and a
 *  headers preview. Split from EdgeRow to keep that row's branch count in check. */
function EdgeRowDetail({
  row,
  wrap,
  onBlockIp,
  blocking,
  banned,
}: {
  row: EdgeLog;
  wrap: boolean;
  onBlockIp: (ip: string) => void;
  blocking: boolean;
  banned: boolean;
}) {
  const headers = Object.entries(row.headers);
  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={10} className="py-3">
        {/* w-0 min-w-full: this colSpan cell is in an auto-layout table, so its
            content's intrinsic width drives column sizing — a single long value
            (next-router-state-tree, user-agent) blows the whole table past the
            viewport and makes truncate impossible. width:0 stops the content
            from contributing that width; min-width:100% then re-expands the
            wrapper to the cell, giving the truncate children a bounded width. */}
        <div className="w-0 min-w-full overflow-hidden">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="font-mono text-[12px] text-muted-foreground">
              {row.clientIp}
              {row.country ? (
                <span className="ml-2">
                  {flagEmoji(row.country)} {row.country}
                </span>
              ) : null}
            </span>
            {banned ? (
              <span className="rounded-md border px-2.5 py-1 text-[11px] text-muted-foreground">
                Blocked at the edge
              </span>
            ) : (
              <BlockIpButton ip={row.clientIp} onBlockIp={onBlockIp} blocking={blocking} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-10 gap-y-1 font-mono text-[12px]">
            <Detail k="request_id" v={row.requestId ?? "—"} wrap={wrap} />
            <Detail k="cache" v={row.cache ?? "—"} wrap={wrap} vClass={cacheTextClass(row.cache)} />
            {/* The demo also showed the upstream's own latency "(Xms)" here,
                but the edge log payload only carries total latencyMs — no
                per-upstream timing is stored, so we don't invent one. */}
            <Detail k="upstream" v={row.upstream ?? "—"} wrap={wrap} />
            <Detail
              k="tls"
              v={[row.tlsVersion, row.tlsCipher].filter(Boolean).join(" · ") || "—"}
              wrap={wrap}
            />
            <Detail k="req bytes" v={String(row.reqBytes)} wrap={wrap} />
            <Detail k="res bytes" v={String(row.resBytes)} wrap={wrap} />
            <Detail k="referer" v={row.referer} wrap={wrap} wide />
            <Detail k="user-agent" v={row.userAgent} wrap={wrap} wide />
          </div>

          {headers.length > 0 ? (
            <div className="mt-3">
              <div className="mb-1.5 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                Headers preview
              </div>
              {/* Per-header rows (not one <pre>): a single long value like
                next-router-state-tree gives a <pre> a huge min-content width
                that expands the whole table past the viewport. min-w-0 +
                truncate lets each value shrink instead; the Wrap toggle expands
                to the full value, and the title surfaces it on hover. */}
              <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border bg-background/60 p-3 font-mono text-[11.5px] leading-relaxed">
                {headers.map(([k, v]) => (
                  <div key={k} className="flex min-w-0 gap-2">
                    <span className="shrink-0 text-muted-foreground">{k.toLowerCase()}:</span>
                    <span
                      className={cn("min-w-0 text-foreground/80", wrap ? "break-all" : "truncate")}
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
  );
}

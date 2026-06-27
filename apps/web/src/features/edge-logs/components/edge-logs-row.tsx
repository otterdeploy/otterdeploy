import { TableCell, TableRow } from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

import { BUCKET_TEXT, type EdgeLog, METHOD_TEXT, statusBucket } from "./edge-logs-constants";
import { Detail } from "./edge-logs-shared";

export function EdgeRow({
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
          {row.path}
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">{row.latencyMs}ms</TableCell>
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
                  <div className="mb-1.5 text-[10px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
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
                        <span className="shrink-0 text-muted-foreground">{k.toLowerCase()}:</span>
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

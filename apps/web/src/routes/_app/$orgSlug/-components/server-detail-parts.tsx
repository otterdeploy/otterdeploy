/**
 * Small presentational pieces the server page's tabs share: a stat tile with
 * an inline sparkline, a key/value list, the filesystems table, and the
 * "needs attention" list built from the host's own recommendations.
 */
import type { ReactNode } from "react";

import { Link } from "@tanstack/react-router";

import type { HostHealth } from "@/features/servers/detail/use-server-detail";
import type { ServerMetricRow } from "@/features/servers/detail/use-server-metrics";

import { formatBytes } from "@otterdeploy/shared/format";

import { TimeSeriesChart } from "@/shared/components/charts/time-series-chart";
import { Card } from "@/shared/components/ui/card";
import { Meter } from "@/shared/components/ui/meter";
import { cn } from "@/shared/lib/utils";

export function SectionCard({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("min-w-0 gap-0 overflow-hidden rounded-md p-0", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {hint && <span className="text-[12px] text-muted-foreground">{hint}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </Card>
  );
}

/** A reading: label, number, threshold meter, one line of context and the
 *  last half hour as a sparkline. `value` null renders an honest dash. */
export function StatTile({
  label,
  value,
  unit,
  pct,
  foot,
  rows,
  dataKey,
  dim,
}: {
  label: string;
  value: string | null;
  unit?: string;
  /** Percentage for the meter; omit for readings with no ceiling (network). */
  pct?: number | null;
  foot?: ReactNode;
  rows: readonly ServerMetricRow[];
  dataKey: Extract<keyof ServerMetricRow, string>;
  /** Stale reading: greyed, not hidden. */
  dim?: boolean;
}) {
  return (
    <Card className={cn("min-w-0 gap-1.5 rounded-md p-4", dim && "opacity-60")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-2 font-mono text-[22px] leading-none font-semibold tracking-tight tabular-nums">
        {value ?? <span className="text-muted-foreground">–</span>}
        {unit && value !== null && (
          <span className="text-[12px] font-normal text-muted-foreground">{unit}</span>
        )}
      </div>
      {pct !== undefined && pct !== null && (
        <Meter value={pct} label={label} showValue={false} className="mt-0.5" />
      )}
      {foot && <div className="text-[11.5px] text-muted-foreground">{foot}</div>}
      {rows.length > 1 && (
        <TimeSeriesChart
          compact
          height={28}
          data={rows}
          ariaLabel={`${label}, last 30 minutes`}
          format={(v) => String(v)}
          series={[{ dataKey, label }]}
          className="mt-1 text-muted-foreground"
        />
      )}
    </Card>
  );
}

export function KeyValueList({
  items,
  className,
}: {
  items: ReadonlyArray<{ label: string; value: ReactNode }>;
  className?: string;
}) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 px-4 sm:grid-cols-2", className)}>
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-baseline justify-between gap-3 border-b py-2 text-[12.5px] last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0"
        >
          <dt className="shrink-0 text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 truncate text-right font-mono text-[12px]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FilesystemsTable({
  filesystems,
  dim,
}: {
  filesystems: NonNullable<HostHealth["filesystems"]>;
  dim?: boolean;
}) {
  if (filesystems.length === 0) {
    return <p className="px-4 py-3 text-[12.5px] text-muted-foreground">No mounts reported.</p>;
  }
  return (
    <div className="overflow-x-auto">
      {/* Every cell is one line: the wrapper scrolls sideways, so a long
          mount path pushes the table wider rather than folding "125.0 GB /
          926.4 GB" into four lines. */}
      <table className={cn("w-full text-[12.5px] whitespace-nowrap", dim && "opacity-60")}>
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="px-4 py-2 text-left font-medium">Mount</th>
            <th className="px-3 py-2 text-left font-medium">Device</th>
            <th className="px-3 py-2 text-left font-medium">Type</th>
            <th className="w-[34%] min-w-40 px-3 py-2 text-left font-medium">Used</th>
            <th className="px-4 py-2 text-right font-medium">Free</th>
          </tr>
        </thead>
        <tbody>
          {filesystems.map((fs) => (
            <tr key={`${fs.device}:${fs.mountPoint}`} className="border-b last:border-b-0">
              <td className="px-4 py-2 font-mono">{fs.mountPoint}</td>
              <td className="px-3 py-2 font-mono text-muted-foreground">{fs.device}</td>
              <td className="px-3 py-2 font-mono text-muted-foreground">{fs.fsType}</td>
              <td className="px-3 py-2">
                <Meter value={fs.usedPct} label={`${fs.mountPoint} used`} />
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums">
                {formatBytes(fs.freeBytes)}{" "}
                <span className="text-muted-foreground">/ {formatBytes(fs.totalBytes)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-destructive",
  warning: "bg-warning",
  info: "bg-info",
};

/** The host's own recommendations, each with the one tab that acts on it. */
export function AttentionList({
  recommendations,
  orgSlug,
  serverId,
}: {
  recommendations: HostHealth["recommendations"];
  orgSlug: string;
  serverId: string;
}) {
  return (
    <div className="flex flex-col divide-y">
      {recommendations.map((rec) => (
        <div key={rec.id} className="flex items-start gap-3 px-4 py-2.5">
          <span
            className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEVERITY_DOT[rec.severity])}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">{rec.title}</div>
            <div className="text-[12px] text-muted-foreground">{rec.detail}</div>
          </div>
          {rec.action && (
            <Link
              to="/$orgSlug/servers/$serverId"
              params={{ orgSlug, serverId }}
              search={{ tab: "storage" }}
              className="shrink-0 self-center text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Storage →
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

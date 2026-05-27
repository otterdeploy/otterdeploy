/**
 * Demo Metrics tab — sparklines, status distribution, per-replica usage.
 *
 * Values are hand-rolled placeholders pending the real per-container
 * stats stream. Lives in the demo cluster (rendered by DemoNodePanel,
 * not RealResourcePanel which currently shows a "coming soon" copy).
 */

import { useMemo, useState } from "react";

import { cn } from "@/shared/lib/utils";

export const METRIC_RANGES = ["15m", "1h", "6h", "24h", "7d"] as const;
export type MetricRange = (typeof METRIC_RANGES)[number];

export interface MetricsMeta {
  cpu: number;
  memory: number;
  rps: number | null;
}

interface MetricsTabBodyProps {
  meta: MetricsMeta;
  replicaName: string;
}

export function MetricsTabBody({ meta, replicaName }: MetricsTabBodyProps) {
  const [range, setRange] = useState<MetricRange>("1h");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
            Range
          </span>
          <div className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 p-0.5">
            {METRIC_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={cn(
                  "rounded px-2.5 py-1 font-mono text-xs transition-colors",
                  range === r
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          across 1 replica · {range} window
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="CPU" value={`${meta.cpu}%`} sub="46% avg · 63% peak" tone="success" />
        <MetricCard label="Memory" value={`${meta.memory}%`} sub="246 MB / 512 MB" tone="success" />
        <MetricCard label="Requests" value={`${meta.rps ?? 1180}/s`} sub="1086 avg · 1652 peak" tone="info" />
        <MetricCard label="Latency p95" value="88 ms" sub="64 ms p50 · 412 ms p99" tone="info" />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <SubPanel title="Per-replica usage">
          <PerReplicaUsage replicaName={replicaName} />
        </SubPanel>

        <SubPanel title="Status response distribution · last 1h">
          <StatusBarChart />
          <div className="mt-3 flex items-center gap-5 font-mono text-[11px]">
            <LegendDot color="bg-success" label="2xx" value="94.2%" />
            <LegendDot color="bg-info" label="3xx" value="3.1%" />
            <LegendDot color="bg-warning" label="4xx" value="2.4%" />
            <LegendDot color="bg-destructive" label="5xx" value="0.3%" />
          </div>
        </SubPanel>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "success" | "info";
}) {
  const valueClass = tone === "success" ? "text-success" : "text-info";
  return (
    <div className="rounded-lg border border-border/40 bg-muted/15 px-4 py-3">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
        {label}
      </div>
      <div className={cn("mt-1 text-[28px] font-semibold tracking-tight", valueClass)}>
        {value}
      </div>
      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/80">
        {sub}
      </div>
      <Sparkline tone={tone} />
    </div>
  );
}

/** Cheap inline SVG sparkline — pseudo-random but stable per render. */
function Sparkline({ tone }: { tone: "success" | "info" }) {
  const points = useMemo(() => {
    const arr: number[] = [];
    let v = 50;
    for (let i = 0; i < 40; i++) {
      v += (Math.random() - 0.5) * 12;
      v = Math.max(20, Math.min(80, v));
      arr.push(v);
    }
    return arr;
  }, []);
  const stroke = tone === "success" ? "stroke-success" : "stroke-info";
  const fill = tone === "success" ? "fill-success/15" : "fill-info/15";
  const w = 200;
  const h = 40;
  const stepX = w / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${i * stepX} ${h - ((p - 20) / 60) * h}`)
    .join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg className="mt-2 h-8 w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={area} className={fill} />
      <path d={path} fill="none" strokeWidth="1.5" className={stroke} />
    </svg>
  );
}

function SubPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/15 px-4 py-3.5">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
        {title}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function PerReplicaUsage({ replicaName }: { replicaName: string }) {
  return (
    <div className="grid grid-cols-[80px_1fr_50px] items-center gap-3 font-mono text-xs">
      <span className="row-span-2 self-start text-foreground/80">{replicaName}</span>
      <div className="flex flex-col gap-1.5">
        <UsageBar label="cpu" pct={49} />
        <UsageBar label="mem" pct={45} />
      </div>
      <div className="flex flex-col items-end gap-1.5 text-foreground/80">
        <span>49%</span>
        <span>45%</span>
      </div>
    </div>
  );
}

function UsageBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-8 text-muted-foreground">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground/70"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatusBarChart() {
  // 24 stacked bars, mostly 2xx success-green with thin tops for 3xx/4xx/5xx.
  const bars = useMemo(
    () =>
      Array.from({ length: 24 }, () => {
        const h = 30 + Math.random() * 70;
        return {
          total: h,
          s2xx: h * (0.9 + Math.random() * 0.08),
          s3xx: h * 0.03,
          s4xx: h * 0.025,
          s5xx: h * 0.005,
        };
      }),
    [],
  );
  return (
    <div className="flex h-24 items-end gap-1">
      {bars.map((b, i) => (
        <div key={i} className="flex h-full flex-1 flex-col-reverse justify-start">
          <div className="bg-success" style={{ height: `${b.s2xx}%` }} />
          <div className="bg-info" style={{ height: `${b.s3xx}%` }} />
          <div className="bg-warning" style={{ height: `${b.s4xx}%` }} />
          <div className="bg-destructive" style={{ height: `${b.s5xx}%` }} />
        </div>
      ))}
    </div>
  );
}

function LegendDot({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn("size-1.5 self-center rounded-full", color)} />
      <span className="text-foreground/80">{label}</span>
      <span className="text-muted-foreground">{value}</span>
    </span>
  );
}

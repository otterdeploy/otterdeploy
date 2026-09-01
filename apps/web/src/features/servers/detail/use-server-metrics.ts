/**
 * React-Query layer over `server.metrics`: the per-node host series the
 * health reports append to (one row per accepted report, nominally every
 * 60 s). Reshapes the API's nullable columns into chart rows; a null stays
 * null so the chart draws a break rather than a zero the host never
 * reported.
 */

import type { ServerId } from "@otterdeploy/shared/id";

import { useQuery } from "@tanstack/react-query";

import { epochMsOf } from "@/shared/lib/clock";
import { orpc } from "@/shared/server/orpc";

export const SERVER_METRIC_WINDOWS = [
  { label: "30m", title: "Last 30 minutes", minutes: 30, live: true },
  { label: "1h", title: "Last hour", minutes: 60, live: true },
  { label: "6h", title: "Last 6 hours", minutes: 360, live: false },
  { label: "24h", title: "Last 24 hours", minutes: 1440, live: false },
  { label: "7d", title: "Last 7 days", minutes: 10_080, live: false },
] as const;

export type ServerMetricWindowLabel = (typeof SERVER_METRIC_WINDOWS)[number]["label"];

/** Health reports land every 60 s (HEALTH_SAMPLE_INTERVAL_MS on the ingest
 *  side); live windows poll in step so a chart trails by at most one report. */
export const SERVER_SAMPLE_INTERVAL_MS = 60_000;
const HISTORY_REFETCH_MS = 5 * 60_000;

function serverMetricsRefetchMs(windowMinutes: number): number {
  return windowMinutes <= 60 ? SERVER_SAMPLE_INTERVAL_MS : HISTORY_REFETCH_MS;
}

/** One charted report. Null means the host did not report that section. */
export interface ServerMetricRow {
  ts: number;
  cpuPct: number | null;
  cpuUserPct: number | null;
  cpuSystemPct: number | null;
  cpuIowaitPct: number | null;
  cpuStealPct: number | null;
  memUsedPct: number;
  /** Page cache + buffers as a share of total, so "used" can be read
   *  against "reclaimable by the kernel". */
  memCachedPct: number | null;
  swapUsedPct: number | null;
  loadAvg1: number | null;
  loadAvg5: number | null;
  loadAvg15: number | null;
  diskUsedPct: number | null;
  diskReadBps: number | null;
  diskWriteBps: number | null;
  netRxBps: number | null;
  netTxBps: number | null;
}

export interface ServerMetricSummary {
  latest: ServerMetricRow | null;
  cpuPeak: number | null;
  cpuAvg: number | null;
  sampleCount: number;
}

export interface ServerMetrics {
  rows: ServerMetricRow[];
  summary: ServerMetricSummary;
  isLoading: boolean;
  isError: boolean;
  updatedAt: number;
}

type Point = Awaited<ReturnType<typeof orpc.server.metrics.call>>["points"][number];

function toRow(p: Point): ServerMetricRow {
  const cached =
    p.memCachedBytes === null && p.memBuffersBytes === null
      ? null
      : (p.memCachedBytes ?? 0) + (p.memBuffersBytes ?? 0);
  return {
    ts: epochMsOf(p.ts),
    cpuPct: p.cpuPct,
    cpuUserPct: p.cpuUserPct,
    cpuSystemPct: p.cpuSystemPct,
    cpuIowaitPct: p.cpuIowaitPct,
    cpuStealPct: p.cpuStealPct,
    memUsedPct: p.memUsedPct,
    memCachedPct: cached === null || p.memTotalBytes <= 0 ? null : (cached / p.memTotalBytes) * 100,
    swapUsedPct: p.swapUsedPct,
    loadAvg1: p.loadAvg1,
    loadAvg5: p.loadAvg5,
    loadAvg15: p.loadAvg15,
    diskUsedPct: p.diskUsedPct,
    diskReadBps: p.diskReadBytesPerSec,
    diskWriteBps: p.diskWriteBytesPerSec,
    netRxBps: p.netRxBytesPerSec,
    netTxBps: p.netTxBytesPerSec,
  };
}

function summarize(rows: ServerMetricRow[]): ServerMetricSummary {
  const cpu = rows.map((r) => r.cpuPct).filter((v): v is number => v !== null);
  return {
    latest: rows.at(-1) ?? null,
    cpuPeak: cpu.length ? Math.max(...cpu) : null,
    cpuAvg: cpu.length ? cpu.reduce((a, v) => a + v, 0) / cpu.length : null,
    sampleCount: rows.length,
  };
}

export function useServerMetrics(serverId: ServerId, windowMinutes: number): ServerMetrics {
  const query = useQuery({
    ...orpc.server.metrics.queryOptions({ input: { id: serverId, windowMinutes } }),
    refetchInterval: serverMetricsRefetchMs(windowMinutes),
    // Keep the previous series on screen while a window change refetches.
    placeholderData: (prev) => prev,
  });
  const rows = (query.data?.points ?? []).map(toRow);
  return {
    rows,
    summary: summarize(rows),
    isLoading: query.isLoading,
    isError: query.isError,
    updatedAt: query.dataUpdatedAt,
  };
}

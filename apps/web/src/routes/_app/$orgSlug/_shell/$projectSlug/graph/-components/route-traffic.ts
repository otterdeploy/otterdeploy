/**
 * Traffic rollup for the project graph's corner chip: pure helpers that
 * summarize the live edge-log stats (`edgeLogs.routeStats`) into total rps +
 * worst p95. Domains themselves are Networking-tab data — they don't render
 * on the graph.
 */

/** Per-host traffic over the window, as `edgeLogs.routeStats` returns it. */
export interface HostTraffic {
  host: string;
  resourceId: string | null;
  isPrimary: boolean;
  rps: number;
  errorRate: number;
  p50: number;
  p95: number;
}

/** "1.2k", "312", "42.1", "0.03" — compact rps for labels and the live chip. */
export function formatRps(rps: number): string {
  if (rps >= 10_000) return `${(rps / 1000).toFixed(0)}k`;
  if (rps >= 1000) return `${(rps / 1000).toFixed(1)}k`;
  if (rps >= 100) return rps.toFixed(0);
  if (rps >= 10) return rps.toFixed(1);
  return rps.toFixed(2);
}

/**
 * Corner-chip rollup: total rps + worst p95 across hosts that actually saw
 * traffic. `null` when nothing did — the chip is omitted entirely rather than
 * rendering zeros (no invented data).
 */
export function summarizeTraffic(
  stats: readonly HostTraffic[] | undefined,
): { totalRps: number; worstP95: number } | null {
  const live = (stats ?? []).filter((s) => s.rps > 0);
  if (live.length === 0) return null;
  return {
    totalRps: live.reduce((sum, s) => sum + s.rps, 0),
    worstP95: Math.max(...live.map((s) => s.p95)),
  };
}

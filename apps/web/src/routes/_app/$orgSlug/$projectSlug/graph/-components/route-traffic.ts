/**
 * Route-traffic model for the project graph: pure helpers that
 *
 *   1. synthesize the public-route topology (one pill node per public host,
 *      plus a host → service edge) from the resource list, and
 *   2. decorate those edges with live edge-log stats (rps/p95) — animation,
 *      log-scaled stroke width, and the hover label payload.
 *
 * Topology and stats are deliberately separate: topology derives from the
 * resource rows (stable across stat polls), stats re-style edges only — so a
 * 10s stat tick can never add/remove a node or trigger a dagre relayout.
 */

import type { Edge, Node } from "@xyflow/react";

import type { ResourceNodeData } from "@/features/projects/components/graph/resource-node";

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

/** The slice of a resource row the topology builder reads. */
export interface RouteSourceResource {
  type: string;
  name: string;
  stackId?: string | null;
  publicEnabled?: boolean;
  publicDomain?: string | null;
}

/** Payload a traffic edge carries for the hover/selected label. */
export interface TrafficEdgeData extends Record<string, unknown> {
  host: string;
  rps?: number;
  p95?: number;
  errorRate?: number;
}

/** Lowercase + strip a `:port` suffix so a stored domain matches the
 *  canonical host the edge-log pipeline keys stats by (see api edge-logs/host). */
export function canonicalHost(host: string): string {
  const lower = host.trim().toLowerCase();
  const m = lower.match(/^(\[[^\]]+\]|[^:]+):\d+$/);
  return m?.[1] ?? lower;
}

/**
 * Log-scaled stroke width for a traffic edge. Quiet edges keep the canvas
 * default (1.25px); width grows with log10(rps) and caps at 4px so a hot host
 * reads heavier without shouting.
 */
export function trafficStrokeWidth(rps: number): number {
  if (rps <= 0) return 1.25;
  return Math.min(4, 1.25 + Math.log10(rps + 1) * 1.4);
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
 * One pill node per publicly-exposed standalone service, plus the
 * host → service edge. Compose members and databases are skipped: members
 * render inside their group (no top-level node to target) and layer4 DB
 * hosts never produce HTTP access logs.
 */
export function buildRouteTopology(resources: readonly RouteSourceResource[]): {
  nodes: Node<ResourceNodeData, "route">[];
  edges: Edge<TrafficEdgeData>[];
} {
  const nodes: Node<ResourceNodeData, "route">[] = [];
  const edges: Edge<TrafficEdgeData>[] = [];
  for (const r of resources) {
    if (r.type !== "service" || r.stackId) continue;
    if (!r.publicEnabled || !r.publicDomain) continue;
    const host = canonicalHost(r.publicDomain);
    const target = `service:${r.name}`;
    nodes.push({
      id: `route:${host}`,
      type: "route",
      position: { x: 0, y: 0 },
      data: {
        kind: "route",
        name: host,
        description: `Public route → ${r.name}`,
      },
    });
    edges.push({
      id: `route:${host}->${target}`,
      source: `route:${host}`,
      target,
      type: "traffic",
      data: { host },
    });
  }
  return { nodes, edges };
}

/**
 * Re-style route edges with live stats. Edges without a `host` payload
 * (dependency / preview edges) pass through untouched; route edges with zero
 * traffic stay plain — only live edges animate, thicken, and carry the label
 * payload. `reducedMotion` swaps the marching dashes for a static dash
 * pattern so the "live" vocabulary survives without movement.
 */
export function decorateTrafficEdges(
  edges: readonly Edge[],
  statsByHost: ReadonlyMap<string, HostTraffic>,
  reducedMotion: boolean,
): Edge[] {
  return edges.map((edge) => {
    const host = (edge.data as TrafficEdgeData | undefined)?.host;
    if (!host) return edge;
    const s = statsByHost.get(host);
    if (!s || s.rps <= 0) return edge;
    return {
      ...edge,
      animated: !reducedMotion,
      style: {
        ...edge.style,
        strokeWidth: trafficStrokeWidth(s.rps),
        ...(reducedMotion ? { strokeDasharray: "6 4" } : {}),
      },
      data: { ...edge.data, host, rps: s.rps, p95: s.p95, errorRate: s.errorRate },
    };
  });
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

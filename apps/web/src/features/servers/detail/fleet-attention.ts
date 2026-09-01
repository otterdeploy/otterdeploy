/**
 * "What needs me" across the fleet, ranked most consequential first.
 *
 * Two sources, both already on the client: a server whose state is not
 * simply connected (down, stale, silent, failed provisioning) and the
 * recommendations each host ships in its own health report (disk pressure,
 * reclaimable images…). Paused and draining are the operator's own choice
 * and never appear here. Pure, so the ranking is testable.
 */

import type { ServerHealthEntry } from "../data/health";
import type { Server } from "../data/server";

import { deriveServerState } from "./server-state";

export type AttentionSeverity = "crit" | "warn" | "info";

export interface AttentionItem {
  id: string;
  serverId: string;
  serverName: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  /** The tab on the server page that acts on it. */
  tab: "overview" | "storage" | "services" | "settings";
}

/** The slice of a server row the ranking reads. Structural on purpose so a
 *  test can build one without pretending to be a whole row. */
export type AttentionServer = Pick<
  Server,
  "name" | "provisionStatus" | "status" | "availability" | "provisionError"
> & { id: string };

type Recommendation = NonNullable<ServerHealthEntry["health"]>["recommendations"][number];

export interface AttentionHealth extends Pick<ServerHealthEntry, "stale" | "receivedAt"> {
  health: { recommendations: readonly Recommendation[] } | null;
}

const RANK: Record<AttentionSeverity, number> = { crit: 0, warn: 1, info: 2 };

const REC_SEVERITY: Record<Recommendation["severity"], AttentionSeverity> = {
  critical: "crit",
  warning: "warn",
  info: "info",
};

function stateItem(server: AttentionServer, entry: AttentionHealth | null): AttentionItem | null {
  const state = deriveServerState(server, entry);
  const base = { id: `${server.id}:state`, serverId: server.id, serverName: server.name };
  switch (state.kind) {
    case "down":
      return {
        ...base,
        severity: "crit",
        title: `${server.name} is down`,
        detail: state.detail,
        tab: "services",
      };
    case "failed":
      return {
        ...base,
        severity: "crit",
        title: `${server.name}: provisioning failed`,
        detail: state.detail,
        tab: "overview",
      };
    case "stale":
      return {
        ...base,
        severity: "warn",
        title: `${server.name} missed its recent reports`,
        detail: state.detail,
        tab: "overview",
      };
    case "unreported":
      return {
        ...base,
        severity: "info",
        title: `${server.name} has not reported yet`,
        detail: state.detail,
        tab: "overview",
      };
    default:
      return null;
  }
}

export function fleetAttention(
  servers: readonly AttentionServer[],
  healthByServer: ReadonlyMap<string, AttentionHealth>,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const server of servers) {
    const entry = healthByServer.get(server.id) ?? null;
    const fromState = stateItem(server, entry);
    if (fromState) items.push(fromState);
    // A silent or down box's recommendations are as old as its last report;
    // the state item already says so, so they are not repeated.
    if (fromState && fromState.severity !== "info") continue;
    for (const rec of entry?.health?.recommendations ?? []) {
      items.push({
        id: `${server.id}:${rec.id}`,
        serverId: server.id,
        serverName: server.name,
        severity: REC_SEVERITY[rec.severity],
        title: rec.title,
        detail: rec.detail,
        tab: rec.action ? "storage" : "overview",
      });
    }
  }
  return items.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

/**
 * Everything the server page knows about one machine, read synchronously
 * off the collections the fleet page already keeps warm: the registered row,
 * its latest health report, its placement stats and its swarm node (when
 * the runtime is swarm). One hook, so every tab agrees on the same facts.
 */

import { useLiveQuery } from "@tanstack/react-db";

import { orpc } from "@/shared/server/orpc";

import type { ServerHealthEntry } from "../data/health";
import type { Server } from "../data/server";
import type { SwarmNode, SwarmNodesView } from "../data/swarm";
import type { ServerState } from "./server-state";

import { serverHealthCollection } from "../data/health";
import { serverCollection } from "../data/server";
import { serverNodeStatsCollection } from "../data/stats";
import { swarmNodesCollection } from "../data/swarm";
import { deriveServerState } from "./server-state";

export type HostHealth = NonNullable<ServerHealthEntry["health"]>;
export type ServerNodeStats = Awaited<
  ReturnType<typeof orpc.server.stats.call>
>["perServer"][number];

export interface ServerDetail {
  server: Server | null;
  entry: ServerHealthEntry | null;
  health: HostHealth | null;
  stats: ServerNodeStats | null;
  /** Live topology; `swarm: false` on the plain-docker runtime. Null while
   *  the first poll is in flight. */
  swarmView: SwarmNodesView | null;
  node: SwarmNode | null;
  state: ServerState | null;
  /** True until the servers collection has its first rows, so a cold load
   *  shows a skeleton rather than "no such server". */
  loading: boolean;
}

export function useServerDetail(serverId: string): ServerDetail {
  const { data: servers, isLoading } = useLiveQuery((q) => q.from({ s: serverCollection }));
  const { data: healthArr = [] } = useLiveQuery(() => serverHealthCollection);
  const { data: statsArr = [] } = useLiveQuery(() => serverNodeStatsCollection);
  const { data: swarmArr = [] } = useLiveQuery(() => swarmNodesCollection);

  const server = servers.find((s) => s.id === serverId) ?? null;
  const entry = healthArr.find((h) => h.serverId === serverId) ?? null;
  const stats = statsArr.find((s) => s.serverId === serverId) ?? null;
  const swarmView = swarmArr[0] ?? null;
  const node = swarmView?.swarm
    ? (swarmView.nodes.find((n) => n.serverId === serverId) ?? null)
    : null;

  return {
    server,
    entry,
    health: entry?.health ?? null,
    stats,
    swarmView,
    node,
    state: server ? deriveServerState(server, entry) : null,
    loading: isLoading,
  };
}

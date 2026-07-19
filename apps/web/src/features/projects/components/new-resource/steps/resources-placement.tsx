/**
 * Swarm-node loader + the Placement section for the Resources step. Split
 * out of resources.tsx so that file + its main component stay under the line
 * caps. `useSwarmNodes` is also consumed by the Size section's capacity copy.
 */

import { useEffect } from "react";

import { useLiveQuery } from "@tanstack/react-db";
import { useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";

import { serverCollection } from "@/features/servers/data/server";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { orpc } from "@/shared/server/orpc";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";

export interface SwarmNode {
  id: string;
  name: string;
  cpuTotal: number;
  cpuUsed: number;
  memTotalGb: number;
  memUsedGb: number;
}

export function useSwarmNodes() {
  const { data: servers = [], isLoading: serversLoading } = useLiveQuery(() => serverCollection);
  const { data: stats, isLoading: statsLoading } = useQuery({
    ...orpc.server.stats.queryOptions(),
    // Lightweight refresh so the placement preview stays current while the
    // operator is configuring — same cadence the servers page uses.
    refetchInterval: 5000,
  });
  type Row = NonNullable<typeof stats>["perServer"][number];
  const statsById = (stats?.perServer ?? []).reduce((acc, row) => {
    acc.set(row.serverId, row);
    return acc;
  }, new Map<string, Row>());
  const nodes: SwarmNode[] = servers.map((s) => {
    const live = statsById.get(s.id);
    return {
      id: s.id,
      name: s.name,
      cpuTotal: s.cpuTotal,
      cpuUsed: live?.cpuAllocatedVcpu ?? 0,
      memTotalGb: s.memTotalGb,
      memUsedGb: live?.memoryAllocatedGb ?? 0,
    };
  });
  return { nodes, loading: serversLoading || statsLoading };
}

/** How many replicas the chosen placement strategy lands on node `ni`. */
function replicasOnNode(
  placement: string,
  ni: number,
  replicas: number,
  nodeCount: number,
  isPinnedNode: boolean,
): number {
  if (placement === "spread") return ni < replicas ? 1 : 0;
  if (placement === "pack") return ni === 0 ? replicas : 0;
  if (placement === "pin") return isPinnedNode ? replicas : 0;
  return Math.ceil((replicas - ni) / nodeCount);
}

export function PlacementSection() {
  const form = useFormContext();
  const { orgSlug } = useParams({ strict: false });
  const placement = useStore(form.store, (s) => s.values.placement);
  const replicas = useStore(form.store, (s) => s.values.replicas);
  const pinnedNodeId = useStore(form.store, (s) => s.values.pinnedNodeId);
  const { nodes, loading: nodesLoading } = useSwarmNodes();

  // If the user has a pinned node selected but it's no longer in the cluster,
  // clear it so we don't submit a stale id.
  useEffect(() => {
    if (!pinnedNodeId) return;
    if (nodes.some((n) => n.id === pinnedNodeId)) return;
    form.setFieldValue("pinnedNodeId", null);
  }, [pinnedNodeId, nodes, form]);

  return (
    <>
      <div className="mt-4.5">
        <SectionHeader
          title="Placement"
          sub={
            nodesLoading
              ? "Reading swarm…"
              : nodes.length === 0
                ? "Where should this run? · 0 nodes in the swarm"
                : `Where should this run? · ${nodes.length} ${nodes.length === 1 ? "node" : "nodes"} available in the swarm`
          }
        />
      </div>
      <Card className="mt-2.5 rounded-md">
        <CardContent>
          <form.AppField name="placement">
            {(f) => (
              <f.SelectField
                label="Placement strategy"
                items={[
                  { label: "Any node — let scheduler decide", value: "any" },
                  {
                    label: "Spread across nodes — one replica per node",
                    value: "spread",
                  },
                  {
                    label: "Pack onto fewest nodes — minimize spread",
                    value: "pack",
                  },
                  { label: "Pin to specific node", value: "pin" },
                ]}
              />
            )}
          </form.AppField>

          <div className="mt-3.5 rounded-sm border border-border bg-muted p-3">
            <div className="mb-2 text-[10px] tracking-[0.06em] text-muted-foreground uppercase">
              {placement === "pin" ? "pick a node" : "predicted placement"}
            </div>
            {nodesLoading ? (
              <div className="text-[11px] text-muted-foreground">Loading nodes…</div>
            ) : nodes.length === 0 ? (
              <div className="flex items-center justify-between gap-3 text-[11px]">
                <span className="text-muted-foreground">
                  No swarm nodes registered yet — placement is unavailable.
                </span>
                {orgSlug && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    render={() => (
                      <Link to="/$orgSlug/servers" params={{ orgSlug }}>
                        Register a server
                      </Link>
                    )}
                  />
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {nodes.map((n, ni) => {
                  const isPinned = placement === "pin" && n.id === pinnedNodeId;
                  const onThis = replicasOnNode(placement, ni, replicas, nodes.length, isPinned);
                  const pct = n.cpuTotal > 0 ? Math.round((n.cpuUsed / n.cpuTotal) * 100) : 0;
                  return (
                    <div
                      key={n.id}
                      className="flex-1 rounded-sm border border-border bg-card p-2.5"
                    >
                      <div className="flex items-center gap-2 text-[11px]">
                        {placement === "pin" && (
                          <Checkbox
                            checked={isPinned}
                            onCheckedChange={(checked) => {
                              if (checked) form.setFieldValue("pinnedNodeId", n.id);
                            }}
                            aria-label={`Pin to ${n.name}`}
                          />
                        )}
                        <span className="font-mono text-muted-foreground">{n.name}</span>
                        <span className="flex-1" />
                        <span className="text-muted-foreground">
                          {n.cpuTotal > 0 ? `${pct}%` : "—"}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {Array.from({ length: Math.max(0, onThis) }).map((_, i) => (
                          <span key={i} className="inline-block size-2.5 rounded-xs bg-chart-2" />
                        ))}
                        {onThis === 0 && (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

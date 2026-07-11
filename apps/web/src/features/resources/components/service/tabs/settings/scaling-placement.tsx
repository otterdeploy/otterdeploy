/**
 * Read-only per-node placement readout for the scaling card. Swarm: this
 * service's running tasks grouped by node hostname. Plain docker: a single
 * implicit node, said honestly.
 */

import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/server/orpc";

import { groupRunningTasksByNode } from "./scaling-math";
import { rowClass } from "./scaling-parts";

type ServiceView = Awaited<ReturnType<typeof orpc.service.get.call>>;

export function PlacementReadout({ service }: { service: ServiceView }) {
  const nodesQuery = useQuery({
    ...orpc.docker.nodes.list.queryOptions({ input: {} }),
    refetchInterval: 10_000,
  });
  const swarm = nodesQuery.data?.swarm ?? false;
  const swarmServiceId = service.runtime.serviceId;
  const tasksQuery = useQuery({
    ...orpc.docker.tasks.list.queryOptions({ input: {} }),
    enabled: swarm && !!swarmServiceId,
    refetchInterval: 10_000,
  });

  let body: React.ReactNode;
  if (!nodesQuery.data) {
    body = (
      <span className="text-[11px] text-muted-foreground">
        {nodesQuery.isError ? "Couldn't read cluster placement." : "Reading placement…"}
      </span>
    );
  } else if (!swarm) {
    body = (
      <NodeBox
        hostname="this server"
        running={service.runtime.status === "running" ? 1 : 0}
        note="single-node runtime"
      />
    );
  } else if (!swarmServiceId || !tasksQuery.data) {
    body = (
      <span className="text-[11px] text-muted-foreground">
        {!swarmServiceId
          ? "Not provisioned on the cluster yet."
          : tasksQuery.isError
            ? "Couldn't read this service's tasks."
            : "Reading placement…"}
      </span>
    );
  } else {
    const placements = groupRunningTasksByNode(
      tasksQuery.data,
      nodesQuery.data.nodes,
      swarmServiceId,
    );
    body =
      placements.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">No running replicas.</span>
      ) : (
        placements.map((p) => (
          <NodeBox key={p.hostname} hostname={p.hostname} running={p.running} />
        ))
      );
  }

  return (
    <div className={rowClass}>
      <span className="text-[11px] text-muted-foreground">Currently running on</span>
      <div className="mt-1.5 flex flex-wrap items-stretch gap-1.5">{body}</div>
    </div>
  );
}

function NodeBox({
  hostname,
  running,
  note,
}: {
  hostname: string;
  running: number;
  note?: string;
}) {
  return (
    <div className="min-w-32 flex-1 rounded-sm border border-border bg-muted/40 p-2">
      <div className="flex items-baseline gap-2 text-[11px]">
        <span className="truncate font-mono text-muted-foreground">{hostname}</span>
        <span className="ml-auto shrink-0 font-mono text-foreground">{running}</span>
      </div>
      <div className="mt-1.5 flex min-h-2.5 flex-wrap items-center gap-1">
        {Array.from({ length: running }).map((_, i) => (
          <span key={i} className="inline-block size-2.5 rounded-xs bg-chart-2" />
        ))}
        {running === 0 && <span className="text-[10px] text-muted-foreground">—</span>}
      </div>
      {note && <div className="mt-1 text-[10px] text-muted-foreground">{note}</div>}
    </div>
  );
}

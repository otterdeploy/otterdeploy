/**
 * Fleet cards: the Servers overview rendered as one self-contained card per
 * node instead of table rows. Each card carries the node's identity and role,
 * its live health meters (memory / disk / branching pool from the per-server
 * health samples, CPU from placement stats), the row-level actions, and a
 * Docker-footprint footer, followed by a dashed add-a-server invitation.
 * Built to scale past one server without a redesign.
 */
import { HugeiconsIcon } from "@hugeicons/react";
import { ServerStack01Icon } from "@hugeicons/core-free-icons";

import type { ProvisionInitialValues } from "@/features/servers/components/server-provision-form";

import { type Server } from "@/features/servers/data/server";
import { type ServerHealthEntry } from "@/features/servers/data/health";
import { type SwarmNode } from "@/features/servers/data/swarm";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";

import { AvailabilitySelect, type ServerRowStats } from "./servers-row";
import { DockerFootprint, NodeMeters } from "./servers-fleet-meters";
import { RoleBadge, StatusBadge } from "./servers-row-cells";
import { ServerDeleteButton } from "./servers-row-delete";
import { ProvisionRetryCell } from "./servers-row-retry";

function NodeIdentity({
  server,
  node,
  entry,
  tasks,
}: {
  server: Server;
  node: SwarmNode | null;
  entry: ServerHealthEntry | null;
  tasks: number | null;
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="truncate font-mono text-[14px] font-medium">{server.name}</span>
        <StatusBadge status={server.status} availability={server.availability} />
        {entry?.stale && (
          <Badge
            variant="outline"
            className="h-5 border-warning/30 bg-warning/10 px-1.5 font-mono text-[10px] text-warning"
            title="No health report received recently; readings below may be old."
          >
            stale
          </Badge>
        )}
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
        <span className="truncate">{server.host}</span>
        {server.hostname && server.hostname !== server.name && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className="truncate">{server.hostname}</span>
          </>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <RoleBadge role={node?.role ?? server.role} leader={node?.leader ?? false} />
        {server.labels.map((label) => (
          <Badge
            key={label}
            variant="outline"
            className="h-5 px-1.5 font-mono text-[10px] font-normal text-muted-foreground"
          >
            {label}
          </Badge>
        ))}
      </div>
      <div className="mt-3.5 text-[12px] text-muted-foreground">
        {tasks === null ? (
          <span className="text-muted-foreground/40">no placement data yet</span>
        ) : (
          <>
            <span className="font-mono text-foreground tabular-nums">{tasks}</span> task
            {tasks === 1 ? "" : "s"} running
          </>
        )}
      </div>
    </div>
  );
}

function ServerFleetCard({
  server,
  stats,
  health,
  node,
  onOpen,
  onReAdd,
}: {
  server: Server;
  stats: ServerRowStats | null;
  health: ServerHealthEntry | null;
  node: SwarmNode | null;
  onOpen: () => void;
  onReAdd: (initial: ProvisionInitialValues) => void;
}) {
  return (
    <Card className="min-w-0 gap-0 overflow-hidden rounded-md p-0">
      <div className="grid grid-cols-1 gap-5 p-4 sm:p-5 md:grid-cols-[230px_minmax(0,1fr)_auto] md:gap-7">
        <NodeIdentity
          server={server}
          node={node}
          entry={health}
          tasks={stats?.tasksRunning ?? null}
        />
        <NodeMeters server={server} stats={stats} health={health?.health ?? null} />
        <div className="flex flex-row flex-wrap items-start gap-2 md:w-[130px] md:flex-col md:items-stretch">
          <Button type="button" variant="outline" size="sm" className="h-7" onClick={onOpen}>
            Details
          </Button>
          <AvailabilitySelect server={server} className="h-7 w-[130px]" />
          <ProvisionRetryCell server={server} onReAdd={onReAdd} />
          <ServerDeleteButton server={server} />
        </div>
      </div>
      <DockerFootprint health={health?.health ?? null} />
    </Card>
  );
}

function AddServerInvite({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed px-4 py-4 sm:px-5">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">Add a second server</div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">
          Join a worker or manager over SSH. Replicas rebalance automatically.
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" className="h-8" onClick={onCreate}>
        + Add server
      </Button>
    </div>
  );
}

export function ServerFleetCards({
  servers,
  statsByServer,
  healthByServer,
  nodesByServer,
  onOpenServer,
  onCreate,
  onReAdd,
}: {
  servers: Server[];
  statsByServer: ReadonlyMap<string, ServerRowStats>;
  healthByServer: ReadonlyMap<string, ServerHealthEntry>;
  /** Swarm node per server id: empty on the plain-docker runtime, where the
   *  role chip falls back to the registered (DB) role. */
  nodesByServer: ReadonlyMap<string, SwarmNode>;
  onOpenServer: (serverId: string) => void;
  onCreate: () => void;
  /** Re-open Add server prefilled, for failed runs that stored no credential. */
  onReAdd: (initial: ProvisionInitialValues) => void;
}) {
  if (servers.length === 0) {
    return (
      <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
        <EmptyHeader>
          <HugeiconsIcon
            icon={ServerStack01Icon}
            strokeWidth={1.5}
            className="size-10 text-muted-foreground/50"
          />
          <EmptyTitle>No servers registered</EmptyTitle>
          <EmptyDescription>
            Join a host to the swarm and register it here. The orchestrator will start scheduling
            services onto it once it appears.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" className="h-8" onClick={onCreate}>
            + Add server
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {servers.map((server) => (
        <ServerFleetCard
          key={server.id}
          server={server}
          stats={statsByServer.get(server.id) ?? null}
          health={healthByServer.get(server.id) ?? null}
          node={nodesByServer.get(server.id) ?? null}
          onOpen={() => onOpenServer(server.id)}
          onReAdd={onReAdd}
        />
      ))}
      <AddServerInvite onCreate={onCreate} />
    </div>
  );
}

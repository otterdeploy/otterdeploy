/**
 * The Overview tab's lower half: what is placed on the box (from
 * `server.stats`) and the machine's registered + reported facts. Split from
 * server-detail-overview.tsx for the file-size cap only.
 */
import { Link } from "@tanstack/react-router";

import type { Server } from "@/features/servers/data/server";
import type { HostHealth, ServerNodeStats } from "@/features/servers/detail/use-server-detail";

import { formatBytes } from "@otterdeploy/shared/format";

import { toProjectSlug } from "@/features/servers/detail/project-slug";
import { isControlPlaneRow } from "@/features/servers/detail/server-state";
import { timeAgo } from "@/shared/lib/time";
import { SERVER_TAB_PATHS } from "../../-components/server-tab-paths";

function ProjectChip({ slug, orgSlug }: { slug: string; orgSlug: string }) {
  const branded = toProjectSlug(slug);
  const className = "rounded-md bg-muted px-2 py-0.5 font-mono text-[11.5px]";
  if (!branded) return <span className={className}>{slug}</span>;
  return (
    <Link
      to="/$orgSlug/projects/$projectSlug"
      params={{ orgSlug, projectSlug: branded }}
      className={`${className} hover:bg-accent`}
    >
      {slug}
    </Link>
  );
}

export function PlacementSummary({
  server,
  stats,
  isSwarm,
  orgSlug,
}: {
  server: Server;
  stats: ServerNodeStats | null;
  /** Tasks and reservations are swarm's: plain Docker has neither, and the
   *  numbers read zero forever there. */
  isSwarm: boolean;
  orgSlug: string;
}) {
  if (!stats) {
    return <p className="px-4 py-3 text-[12.5px] text-muted-foreground">No placement data yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3 px-4 py-3 text-[12.5px]">
      {isSwarm ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span>
            <span className="font-mono tabular-nums">{stats.tasksRunning}</span> task
            {stats.tasksRunning === 1 ? "" : "s"} running
          </span>
          <span className="text-muted-foreground">
            <span className="font-mono tabular-nums">{stats.cpuAllocatedVcpu}</span> /{" "}
            {server.cpuTotal || "–"} vCPU reserved
          </span>
          <span className="text-muted-foreground">
            <span className="font-mono tabular-nums">{stats.memoryAllocatedGb.toFixed(1)}</span> /{" "}
            {server.memTotalGb || "–"} GB reserved
          </span>
        </div>
      ) : null}
      {stats.projects.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {stats.projects.map((slug) => (
            <ProjectChip key={slug} slug={slug} orgSlug={orgSlug} />
          ))}
        </div>
      ) : (
        <span className="text-muted-foreground">Nothing scheduled here.</span>
      )}
    </div>
  );
}

export function machineFacts(server: Server, health: HostHealth | null) {
  return [
    { label: "Host", value: server.host },
    { label: "Hostname", value: server.hostname ?? "–" },
    {
      label: "Mesh",
      value: server.meshAddress
        ? `${server.meshAddress} · ${server.meshProvider}`
        : server.meshProvider,
    },
    { label: "Region", value: server.region ?? "–" },
    { label: "Cores", value: health?.cpu ? String(health.cpu.coreCount) : server.cpuTotal || "–" },
    {
      label: "Memory",
      value: health ? formatBytes(health.memory.totalBytes) : `${server.memTotalGb || "–"} GB`,
    },
    { label: "Docker engine", value: server.daemonVersion ?? "–" },
    { label: "Role", value: isControlPlaneRow(server) ? "control plane" : server.role },
    { label: "Firewall", value: server.firewallStatus },
    { label: "Registered", value: timeAgo(server.createdAt.toISOString()) },
  ];
}

export function TabLink({
  orgSlug,
  serverId,
  tab,
  children,
}: {
  orgSlug: string;
  serverId: string;
  tab: "containers" | "storage";
  children: string;
}) {
  return (
    <Link
      to={SERVER_TAB_PATHS[tab]}
      params={{ orgSlug, serverId }}
      className="text-[12px] text-muted-foreground hover:text-foreground"
    >
      {children}
    </Link>
  );
}

/**
 * Overview tab: is this box healthy and what is on it. The four readings an
 * operator checks first (CPU, memory, disk, network) as tiles with the last
 * half hour behind each number, the host's own recommendations with the tab
 * that acts on them, what is placed here, the machine's facts, and every
 * mount it reported.
 *
 * Every tile reads the latest health report; the sparkline reads the
 * per-node series. A box that is not reporting shows a dash, never a zero.
 */
import type { Server } from "@/features/servers/data/server";
import type { ServerState } from "@/features/servers/detail/server-state";
import type { HostHealth, ServerNodeStats } from "@/features/servers/detail/use-server-detail";
import type { ServerMetricRow } from "@/features/servers/detail/use-server-metrics";

import { formatBytes } from "@otterdeploy/shared/format";

import { hasReadings } from "@/features/servers/detail/server-state";
import { useServerMetrics } from "@/features/servers/detail/use-server-metrics";

import {
  AttentionList,
  FilesystemsTable,
  KeyValueList,
  SectionCard,
  StatTile,
} from "./server-detail-parts";
import { machineFacts, PlacementSummary, TabLink } from "./server-detail-overview-parts";

interface TileSpec {
  label: string;
  value: string | null;
  unit?: string;
  pct?: number | null;
  foot?: string;
  dataKey: Extract<keyof ServerMetricRow, string>;
}

function formatRate(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

function cpuTile(server: Server, health: HostHealth | null): TileSpec {
  const cpu = health?.cpu ?? null;
  const load = health?.load ?? null;
  const cores = Math.max(1, cpu?.coreCount ?? server.cpuTotal);
  const iowait =
    cpu && cpu.breakdown.iowaitPct >= 5 ? ` · iowait ${Math.round(cpu.breakdown.iowaitPct)}%` : "";
  return {
    label: "CPU",
    value: cpu ? `${Math.round(cpu.usedPct)}%` : null,
    unit: cpu ? `${cpu.coreCount} cores` : undefined,
    pct: cpu?.usedPct ?? null,
    foot: load
      ? `load ${load.load1.toFixed(2)} · ${(load.load1 / cores).toFixed(2)} per core${iowait}`
      : undefined,
    dataKey: "cpuPct",
  };
}

function memoryTile(health: HostHealth | null): TileSpec {
  const mem = health?.memory ?? null;
  if (!mem) return { label: "Memory", value: null, dataKey: "memUsedPct" };
  const swapUsed =
    mem.swapTotalBytes !== null && mem.swapFreeBytes !== null
      ? mem.swapTotalBytes - mem.swapFreeBytes
      : null;
  const cache = mem.cachedBytes != null ? `cache ${formatBytes(mem.cachedBytes)} · ` : "";
  return {
    label: "Memory",
    value: formatBytes(mem.totalBytes - mem.availableBytes),
    unit: `of ${formatBytes(mem.totalBytes)}`,
    pct: mem.usedPct,
    foot: `${cache}${swapUsed !== null ? `swap ${formatBytes(swapUsed)}` : "no swap"}`,
    dataKey: "memUsedPct",
  };
}

function diskTile(health: HostHealth | null): TileSpec {
  const disk = health?.disk ?? null;
  const reclaimable = health?.docker
    ? health.docker.images.reclaimableBytes + health.docker.buildCache.reclaimableBytes
    : 0;
  return {
    label: disk ? `Disk ${disk.path}` : "Disk",
    value: disk ? `${Math.round(disk.usedPct)}%` : null,
    unit: disk ? `${formatBytes(disk.freeBytes)} free` : undefined,
    pct: disk?.usedPct ?? null,
    foot: reclaimable > 0 ? `${formatBytes(reclaimable)} reclaimable` : undefined,
    dataKey: "diskUsedPct",
  };
}

/** Host-wide throughput: every interface but loopback. */
function networkTile(health: HostHealth | null): TileSpec {
  const nics = (health?.network ?? []).filter((nic) => nic.name !== "lo");
  if (nics.length === 0) return { label: "Network", value: null, dataKey: "netRxBps" };
  const rx = nics.reduce((acc, nic) => acc + nic.rxBytesPerSec, 0);
  const tx = nics.reduce((acc, nic) => acc + nic.txBytesPerSec, 0);
  return {
    label: "Network",
    value: `↓ ${formatRate(rx)}`,
    foot: `↑ ${formatRate(tx)}`,
    dataKey: "netRxBps",
  };
}

function ReadingTiles({
  server,
  health,
  dim,
}: {
  server: Server;
  health: HostHealth | null;
  dim: boolean;
}) {
  const { rows } = useServerMetrics(server.id, 30);
  const tiles = [cpuTile(server, health), memoryTile(health), diskTile(health), networkTile(health)];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <StatTile key={tile.label} {...tile} rows={rows} dim={dim} />
      ))}
    </div>
  );
}

export function ServerOverviewTab({
  server,
  state,
  health,
  stats,
  orgSlug,
}: {
  server: Server;
  state: ServerState;
  health: HostHealth | null;
  stats: ServerNodeStats | null;
  orgSlug: string;
}) {
  const shown = hasReadings(state.kind) ? health : null;
  const dim = state.kind === "stale";
  const recommendations = shown?.recommendations ?? [];
  return (
    <>
      {recommendations.length > 0 && (
        <SectionCard title="Needs attention" hint="from this host's last report">
          <AttentionList
            recommendations={recommendations}
            orgSlug={orgSlug}
            serverId={server.id}
          />
        </SectionCard>
      )}
      <ReadingTiles server={server} health={shown} dim={dim} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <SectionCard
          title="Placed here"
          hint="reservations, not utilization"
          action={
            <TabLink orgSlug={orgSlug} serverId={server.id} tab="services">
              Services →
            </TabLink>
          }
        >
          <PlacementSummary server={server} stats={stats} orgSlug={orgSlug} />
        </SectionCard>
        <SectionCard title="About this machine" hint="as registered and as reported">
          <KeyValueList items={machineFacts(server, shown)} className="py-1" />
        </SectionCard>
      </div>
      {shown?.filesystems && (
        <SectionCard
          title="Filesystems"
          action={
            <TabLink orgSlug={orgSlug} serverId={server.id} tab="storage">
              Storage →
            </TabLink>
          }
        >
          <FilesystemsTable filesystems={shown.filesystems} dim={dim} />
        </SectionCard>
      )}
    </>
  );
}

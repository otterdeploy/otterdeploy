/**
 * The fleet: one card per server in a grid, each answering the same three
 * questions at a glance: is it up (one state badge), how full is it (three
 * utilization meters against the operator's thresholds), and what is on it
 * (one line of meta). Everything a box can DO lives on its page, which the
 * name opens.
 *
 * Meters are utilization from the host's own report. A box that has not
 * reported shows a dash, never a reservation dressed up as a reading.
 */
import { HugeiconsIcon } from "@hugeicons/react";
import { ServerStack01Icon } from "@hugeicons/core-free-icons";
import { Link } from "@tanstack/react-router";

import type { ProvisionInitialValues } from "@/features/servers/components/server-provision-form";
import type { ServerHealthEntry } from "@/features/servers/data/health";
import type { Server } from "@/features/servers/data/server";
import type { SwarmNode } from "@/features/servers/data/swarm";
import type { ServerNodeStats } from "@/features/servers/detail/use-server-detail";

import { formatBytes } from "@otterdeploy/shared/format";

import {
  deriveServerState,
  hasReadings,
  isControlPlaneRow,
} from "@/features/servers/detail/server-state";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { Meter } from "@/shared/components/ui/meter";
import { cn } from "@/shared/lib/utils";

import { ServerStateBadge } from "./server-detail-state";
import { ProvisionRetryCell } from "./servers-row-retry";

type HostHealth = NonNullable<ServerHealthEntry["health"]>;

interface Reading {
  label: string;
  value: number | null;
  text: string;
}

const ABSENT: Omit<Reading, "label"> = { value: null, text: "–" };

function pctReading(label: string, pct: number | undefined): Reading {
  return pct === undefined ? { label, ...ABSENT } : { label, value: pct, text: `${Math.round(pct)}%` };
}

function memReading(mem: HostHealth["memory"] | undefined): Reading {
  if (!mem) return { label: "Memory", ...ABSENT };
  const used = formatBytes(mem.totalBytes - mem.availableBytes, 1);
  return { label: "Memory", value: mem.usedPct, text: `${used} / ${formatBytes(mem.totalBytes, 0)}` };
}

/** The three meters, or a dash each when the box is not reporting. */
function readings(health: HostHealth | null): Reading[] {
  return [
    pctReading("CPU", health?.cpu?.usedPct),
    memReading(health?.memory),
    pctReading("Disk", health?.disk?.usedPct),
  ];
}

function MeterRow({ label, value, text }: Reading) {
  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_5.5rem] items-center gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {value === null ? (
        <span className="h-[0.8em] rounded-[3px] bg-muted" aria-hidden />
      ) : (
        <Meter value={value} label={label} showValue={false} />
      )}
      <span
        className={cn(
          "truncate text-right font-mono tabular-nums",
          value === null ? "text-muted-foreground/50" : "text-muted-foreground",
        )}
      >
        {text}
      </span>
    </div>
  );
}

/** "control plane · manager · leader": what the box is, in words. */
function roleText(server: Server, node: SwarmNode | null): string {
  if (isControlPlaneRow(server)) return "control plane";
  const role = node?.role ?? server.role;
  return node?.leader ? `${role} · leader` : role;
}

/** "3 tasks · 1 project · 100.64.0.2 · 1 to review": what is on it. */
function metaText(stats: ServerNodeStats | null, server: Server): string[] {
  const parts: string[] = [];
  if (stats) {
    parts.push(`${stats.tasksRunning} task${stats.tasksRunning === 1 ? "" : "s"}`);
    if (stats.projects.length > 0) {
      parts.push(`${stats.projects.length} project${stats.projects.length === 1 ? "" : "s"}`);
    }
  }
  if (server.meshAddress) parts.push(server.meshAddress);
  return parts;
}

function FleetCard({
  server,
  stats,
  entry,
  node,
  attention,
  orgSlug,
  onReAdd,
}: {
  server: Server;
  stats: ServerNodeStats | null;
  entry: ServerHealthEntry | null;
  node: SwarmNode | null;
  attention: number;
  orgSlug: string;
  onReAdd: (initial: ProvisionInitialValues) => void;
}) {
  const state = deriveServerState(server, entry);
  const health = hasReadings(state.kind) ? (entry?.health ?? null) : null;
  const meta = metaText(stats, server);

  return (
    // The whole card opens the server. A stretched link covers the card;
    // the content sits above it with pointer events off, and the few real
    // controls (the name, the retry buttons) turn them back on so they act
    // as themselves rather than as "open".
    <Card className="group relative flex min-w-0 flex-col gap-4 rounded-md p-4 transition-colors hover:bg-muted/30 focus-within:ring-foreground/20">
      <Link
        to="/$orgSlug/servers/$serverId"
        params={{ orgSlug, serverId: server.id }}
        search={{ tab: "overview" }}
        aria-label={`Open ${server.name}`}
        className="absolute inset-0 rounded-md outline-none"
      />
      <div className="pointer-events-none relative flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/$orgSlug/servers/$serverId"
            params={{ orgSlug, serverId: server.id }}
            search={{ tab: "overview" }}
            className="pointer-events-auto min-w-0 truncate font-mono text-sm font-medium underline-offset-4 group-hover:underline"
          >
            {server.name}
          </Link>
          <ServerStateBadge state={state} className="ml-auto" />
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {roleText(server, node)} · {state.detail}
        </div>
      </div>

      <div
        className={cn(
          "pointer-events-none relative flex flex-col gap-1.5",
          state.kind === "stale" && "opacity-60",
        )}
      >
        {readings(health).map((r) => (
          <MeterRow key={r.label} {...r} />
        ))}
      </div>

      <div className="pointer-events-none relative flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate font-mono">
          {meta.length > 0 ? meta.join(" · ") : "no placement data"}
        </span>
        {attention > 0 && (
          <span className="ml-auto shrink-0 text-warning">{attention} to review</span>
        )}
      </div>

      {server.provisionStatus === "failed" && (
        <div className="relative">
          <ProvisionRetryCell server={server} onReAdd={onReAdd} />
        </div>
      )}
    </Card>
  );
}

function AddServerInvite({ onCreate }: { onCreate: () => void }) {
  return (
    <button
      type="button"
      onClick={onCreate}
      className="flex min-h-40 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
    >
      <span className="text-sm font-medium">+ Add a server</span>
      <span className="text-xs">join a worker or manager over SSH</span>
    </button>
  );
}

export function ServerFleetGrid({
  servers,
  statsByServer,
  healthByServer,
  nodesByServer,
  attentionByServer,
  orgSlug,
  onCreate,
  onReAdd,
}: {
  servers: Server[];
  statsByServer: ReadonlyMap<string, ServerNodeStats>;
  healthByServer: ReadonlyMap<string, ServerHealthEntry>;
  /** Swarm node per server id: empty on the plain-docker runtime, where the
   *  role falls back to the registered (DB) role. */
  nodesByServer: ReadonlyMap<string, SwarmNode>;
  attentionByServer: ReadonlyMap<string, number>;
  orgSlug: string;
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
            Register a host and it appears here with its live health as soon as it reports.
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {servers.map((server) => (
        <FleetCard
          key={server.id}
          server={server}
          stats={statsByServer.get(server.id) ?? null}
          entry={healthByServer.get(server.id) ?? null}
          node={nodesByServer.get(server.id) ?? null}
          attention={attentionByServer.get(server.id) ?? 0}
          orgSlug={orgSlug}
          onReAdd={onReAdd}
        />
      ))}
      <AddServerInvite onCreate={onCreate} />
    </div>
  );
}

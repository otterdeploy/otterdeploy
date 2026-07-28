/**
 * The phone form of a Servers row.
 *
 * The desktop table carries ~790px of fixed columns; on a 390px screen that is
 * a horizontal scroller, which hides the two things an operator actually opens
 * this page for — is the node up, and how full is it. So under `md` the same
 * data is restacked as a list item instead of being scrolled sideways.
 *
 * One Card owns the whole list (see ServersTable) and these are its divided
 * rows — a card per server would nest cards, which this design system never
 * does. Ordering is by glanceability: identity, then state, then capacity,
 * then the controls.
 */
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, ServerStack01Icon } from "@hugeicons/core-free-icons";

import type { ProvisionInitialValues } from "@/features/servers/components/server-provision-form";

import { type Server } from "@/features/servers/data/server";
import { type ServerHealthEntry } from "@/features/servers/data/health";
import { type SwarmNode } from "@/features/servers/data/swarm";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";

import { AvailabilitySelect, type ServerRowStats } from "./servers-row";
import { RoleBadge, StatusBadge, UsageBars } from "./servers-row-cells";
import { ServerDeleteButton } from "./servers-row-delete";
import { LiveHealthCell } from "./servers-live-cell";
import { ProvisionRetryCell } from "./servers-row-retry";

/**
 * Icon, name/host, and status. The identity block is the button that opens the
 * health sheet: the ROW can't be one, because it contains a select and action
 * buttons and nesting interactive elements is invalid (a div-with-onClick
 * would also be unreachable by keyboard).
 */
function MobileIdentity({ server, onOpen }: { server: Server; onOpen: () => void }) {
  return (
    <div className="flex items-start gap-2.5">
      <HugeiconsIcon
        icon={ServerStack01Icon}
        strokeWidth={1.8}
        className="mt-0.5 size-4 shrink-0 text-muted-foreground/70"
      />
      <button
        type="button"
        className="min-w-0 flex-1 rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label={`Open ${server.name} details`}
        onClick={onOpen}
      >
        {/* [overflow-wrap:anywhere] — hostnames and IPs are single long tokens
            with no break opportunity; without it a long one widens the row
            past the viewport. */}
        <div className="font-mono text-[13px] font-medium [overflow-wrap:anywhere]">
          {server.name}
        </div>
        <div className="mt-0.5 font-mono text-[11px] [overflow-wrap:anywhere] text-muted-foreground">
          {server.host}
          {server.hostname && server.hostname !== server.name ? ` · ${server.hostname}` : ""}
        </div>
      </button>
      <StatusBadge status={server.status} availability={server.availability} />
    </div>
  );
}

function MobileLabels({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <Badge
          key={label}
          variant="outline"
          className="h-4 px-1.5 font-mono text-[10px] font-normal text-muted-foreground"
        >
          {label}
        </Badge>
      ))}
    </div>
  );
}

export function ServerMobileRow({
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
  const cpuUsed = stats?.cpuAllocatedVcpu ?? 0;
  const memUsed = stats?.memoryAllocatedGb ?? 0;
  const taskCount = stats?.tasksRunning ?? null;

  return (
    <div className="flex flex-col gap-3 p-4">
      <MobileIdentity server={server} onOpen={onOpen} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <RoleBadge role={node?.role ?? server.role} leader={node?.leader ?? false} />
        <LiveHealthCell health={health} />
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {taskCount === null ? "— tasks" : `${taskCount} ${taskCount === 1 ? "task" : "tasks"}`}
        </span>
      </div>

      <MobileLabels labels={server.labels} />

      <UsageBars
        cpuUsed={cpuUsed}
        cpuTotal={server.cpuTotal}
        memUsed={memUsed}
        memTotal={server.memTotalGb}
        draining={server.status === "draining" || server.availability === "drain"}
      />

      {/* Controls get their own row. The select stretches because it is the
          row's one real choice; the rest keep their standard sizes. No
          stopPropagation needed — nothing above them is clickable. */}
      <div className="flex items-center gap-2">
        <AvailabilitySelect server={server} className="flex-1" />
        <ProvisionRetryCell server={server} onReAdd={onReAdd} />
        <ServerDeleteButton server={server} />
        <Button
          variant="outline"
          size="icon-sm"
          className="shrink-0"
          aria-label={`Open ${server.name} details`}
          onClick={onOpen}
        >
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

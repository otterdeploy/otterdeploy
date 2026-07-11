import { useState } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";

import { serverCollection, type Server } from "@/features/servers/data/server";
import { type ServerHealthEntry } from "@/features/servers/data/health";
import { type SwarmNode } from "@/features/servers/data/swarm";
import { orpc } from "@/shared/server/orpc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  TableCell,
  TableRow,
} from "@/shared/components/ui/table";

import { LiveHealthCell } from "./servers-live-cell";
import { RoleBadge, ServerNameCell, StatusBadge, UsageBars } from "./servers-row-cells";

export interface ServerRowStats {
  tasksRunning: number;
  cpuAllocatedVcpu: number;
  memoryAllocatedGb: number;
  projects: string[];
}

export function ServerRow({
  server,
  stats,
  health,
  node,
  onOpen,
}: {
  server: Server;
  stats: ServerRowStats | null;
  health: ServerHealthEntry | null;
  /** Matching swarm node (null when plain docker / not joined) — the role
   *  column prefers swarm truth and marks the Raft leader. */
  node: SwarmNode | null;
  onOpen: () => void;
}) {
  // When stats haven't arrived yet (first paint, swarm unreachable, …) we
  // render zeros against capacity rather than fake values — honest about
  // missing live data without crashing the layout.
  const cpuUsed = stats?.cpuAllocatedVcpu ?? 0;
  const memUsed = stats?.memoryAllocatedGb ?? 0;
  const taskCount = stats?.tasksRunning ?? null;

  return (
    <TableRow className="group cursor-pointer" onClick={onOpen}>
      <TableCell className="pl-4">
        <ServerNameCell server={server} />
      </TableCell>

      <TableCell>
        <RoleBadge role={node?.role ?? server.role} leader={node?.leader ?? false} />
      </TableCell>

      {/* stopPropagation: the row opens the health sheet; interacting with
          the availability select shouldn't. */}
      <TableCell onClick={(e) => e.stopPropagation()}>
        <AvailabilitySelect server={server} />
      </TableCell>

      <TableCell>
        <UsageBars
          cpuUsed={cpuUsed}
          cpuTotal={server.cpuTotal}
          memUsed={memUsed}
          memTotal={server.memTotalGb}
          draining={server.status === "draining" || server.availability === "drain"}
        />
      </TableCell>

      <TableCell>
        <LiveHealthCell health={health} />
      </TableCell>

      <TableCell className="text-right font-mono text-[12px] tabular-nums">
        {taskCount === null ? (
          <span className="text-muted-foreground/40">—</span>
        ) : (
          taskCount
        )}
      </TableCell>

      <TableCell>
        <StatusBadge status={server.status} availability={server.availability} />
      </TableCell>

      <TableCell className="pr-3">
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className="size-4 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground"
        />
      </TableCell>
    </TableRow>
  );
}

function AvailabilitySelect({ server }: { server: Server }) {
  // Optimistic local override: shows the picked value immediately, then either
  // settles it into the collection (docker confirmed the node update) or clears
  // it so the select rolls back to the persisted value (typed error → toast).
  const [pending, setPending] = useState<Server["availability"] | null>(null);
  const value = pending ?? server.availability;

  const setAvailability = (next: Server["availability"]) => {
    if (next === value) return;
    setPending(next);
    orpc.server.setAvailability
      .call({ id: server.id, availability: next })
      .then((updated) => {
        // Write the confirmed row straight into the synced store — no refetch
        // round-trip, so clearing `pending` can't flash the stale value.
        serverCollection.utils.writeUpdate(updated);
        toast.success(`${server.name}: availability set to ${next}`);
      })
      .catch((err: unknown) => {
        toast.error(
          err instanceof Error ? err.message : `Couldn't set ${server.name} to ${next}`,
        );
      })
      .finally(() => setPending(null));
  };

  return (
    <Select
      value={value}
      disabled={pending !== null}
      onValueChange={(v) => {
        if (v === "active" || v === "drain" || v === "pause") setAvailability(v);
      }}
    >
      <SelectTrigger className="h-7 w-[120px] px-2 text-[12px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="active">active</SelectItem>
        <SelectItem value="drain">drain</SelectItem>
        <SelectItem value="pause">pause</SelectItem>
      </SelectContent>
    </Select>
  );
}

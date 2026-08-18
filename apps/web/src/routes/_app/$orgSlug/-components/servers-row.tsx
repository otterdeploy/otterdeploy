/**
 * The per-server availability control (active / drain / pause) and the stats
 * shape the overview cards read. The old table row that lived here was
 * replaced by the fleet cards (servers-fleet-cards.tsx).
 */
import { useState } from "react";

import { toast } from "sonner";

import { serverCollection, type Server } from "@/features/servers/data/server";
import { orpc } from "@/shared/server/orpc";
import { cn } from "@/shared/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

export interface ServerRowStats {
  tasksRunning: number;
  cpuAllocatedVcpu: number;
  memoryAllocatedGb: number;
  projects: string[];
}

export function AvailabilitySelect({
  server,
  className,
}: {
  server: Server;
  /** Sizing override: the phone list uses a taller, full-width trigger. */
  className?: string;
}) {
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
        // Write the confirmed row straight into the synced store, no refetch
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
      <SelectTrigger className={cn("h-7 w-[120px] px-2 text-[12px]", className)}>
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

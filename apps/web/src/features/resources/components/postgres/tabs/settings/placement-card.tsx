/**
 * Which machine this database runs on.
 *
 * The stakes are different from a service's placement control, and the copy
 * reflects it. A database's volume is local to its node: swarm will schedule
 * the engine elsewhere and hand it a fresh empty volume, the container comes
 * up healthy, and the data is gone from the application's point of view with
 * nothing in the runtime treating it as an error.
 *
 * So this card leads with the recommendation rather than the control. Pinning
 * a database to the node it is already on is the safe, correct action. It
 * converts an accident into a guarantee. Moving it is a different operation
 * entirely, and the confirm says what to do instead.
 */

import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { orpc, queryClient } from "@/shared/server/orpc";

/** Sentinel for "no pin": Select can't carry a null value. */
const ANYWHERE = "__anywhere__";

export function DatabasePlacementCard({
  resource,
}: {
  resource: { projectId: string; id: string; name: string; placementServerId?: string | null };
}) {
  const serversQuery = useQuery(orpc.server.list.queryOptions());
  const swarmQuery = useQuery(orpc.server.swarmNodes.queryOptions());
  const [pendingMove, setPendingMove] = useState<string | null>();

  const pinMut = useMutation({
    ...orpc.project.resource.database.postgres.setPlacement.mutationOptions(),
    onSettled: () => queryClient.invalidateQueries(),
  });

  // One machine means no choice to make. Hiding beats showing an inert picker
  // that implies the choice exists somewhere.
  if (swarmQuery.data && !swarmQuery.data.swarm) return null;

  const servers = serversQuery.data ?? [];
  const current = resource.placementServerId ?? ANYWHERE;
  const pinnedServer = servers.find((s) => s.id === resource.placementServerId);

  const move = (serverId: string | null, acknowledgeDataLoss?: boolean) => {
    pinMut.mutate(
      {
        projectId: resource.projectId,
        resourceId: resource.id,
        serverId,
        ...(acknowledgeDataLoss ? { acknowledgeDataLoss: true } : {}),
      },
      {
        onSuccess: (result) => {
          setPendingMove(undefined);
          toast.success(
            result.restarted
              ? "Placement applied. Database restarting."
              : "Placement saved. It applies on the first deploy.",
          );
        },
        onError: (err: unknown) => {
          if (isDataLossRefusal(err)) {
            setPendingMove(serverId);
            return;
          }
          toast.error(err instanceof Error ? err.message : "Failed to change placement");
        },
      },
    );
  };

  return (
    <>
      <SettingsCard
        title="Placement"
        description="Which machine this database runs on. Its storage lives on that machine and does not move with it."
      >
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[12px] text-foreground">
              {resource.placementServerId
                ? `Pinned to ${pinnedServer?.name ?? "an unregistered server"}`
                : "Not pinned"}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {resource.placementServerId
                ? "It will not fail over. If this machine goes down the database waits rather than starting elsewhere without its data."
                : "The scheduler may start this database on any machine. If it ever moves, it starts with empty storage. Pin it to the machine it runs on now."}
            </div>
          </div>
          <Select
            value={current}
            disabled={pinMut.isPending || serversQuery.isLoading}
            onValueChange={(next) => move(next === ANYWHERE ? null : next)}
          >
            <SelectTrigger className="w-52 shrink-0" size="sm">
              <SelectValue placeholder="Not pinned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANYWHERE}>Not pinned (scheduler decides)</SelectItem>
              {servers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {resource.placementServerId && !pinnedServer && !serversQuery.isLoading && (
          <div className="border-t px-3 py-2 text-[11px] text-destructive">
            Pinned to a server that is no longer registered. This database will refuse to deploy
            until you pin it to an existing machine.
          </div>
        )}
      </SettingsCard>

      <AlertDialog
        open={pendingMove !== undefined}
        onOpenChange={(open) => !open && setPendingMove(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This moves the database, not its data</AlertDialogTitle>
            <AlertDialogDescription>
              {resource.name} will restart on the new machine with empty storage. Its current data
              stays on the old machine. Nothing is deleted, but this database will no longer see it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="text-[12px] text-muted-foreground">
            To move the data too: take a backup first, move it, then restore that backup into this
            database once it is running on the new machine.
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => move(pendingMove ?? null, true)}
              disabled={pinMut.isPending}
            >
              Move empty
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function isDataLossRefusal(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "DATABASE_MOVE_DATA_LOSS"
  );
}

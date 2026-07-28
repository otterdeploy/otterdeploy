/**
 * Pin this service to one machine, or let the scheduler place it.
 *
 * Sits directly above the read-only "Currently running on" readout, which is
 * the pairing that makes it legible: intent on top, reality underneath. When
 * they disagree — pinned to a node the task isn't on — that gap IS the useful
 * signal, so the two are deliberately not merged into one line.
 *
 * The cost of pinning is stated before the control, not after: a pinned
 * service does not fail over. Swarm leaves the task Pending rather than moving
 * it, which is correct when its data is on that disk and wrong when it isn't.
 * That sentence is the difference between an operator choosing this and an
 * operator discovering it during an outage.
 *
 * Plain docker has one machine, so the control is hidden rather than shown
 * disabled — an inert picker implies a choice exists somewhere.
 */

import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
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

import { rowClass } from "./scaling-parts";

type ServiceView = Awaited<ReturnType<typeof orpc.service.get.call>>;

/** Sentinel for "no pin" — Select can't carry a null value. */
const ANYWHERE = "__anywhere__";

export function PlacementPin({
  resource,
  service,
  plainDocker,
}: {
  resource: { projectId: string; resourceId: string };
  service: ServiceView;
  plainDocker: boolean;
}) {
  const serversQuery = useQuery(orpc.server.list.queryOptions());
  // Mounts named by the server when it refuses a move, so the confirm can say
  // exactly what gets left behind instead of asking in the abstract.
  const [pendingMove, setPendingMove] = useState<{ serverId: string | null; mounts: string[] }>();

  const pinMut = useMutation({
    ...orpc.service.setPlacement.mutationOptions(),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.service.get.queryKey({
            input: { projectId: resource.projectId, resourceId: resource.resourceId },
          }),
        }),
        queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY }),
      ]);
    },
  });

  if (plainDocker) return null;

  const current = service.placementServerId ?? ANYWHERE;
  const servers = serversQuery.data ?? [];
  const pinnedServer = servers.find((s) => s.id === service.placementServerId);

  const move = (serverId: string | null, acknowledgeVolumeLoss?: boolean) => {
    pinMut.mutate(
      {
        projectId: resource.projectId,
        resourceId: resource.resourceId,
        serverId,
        ...(acknowledgeVolumeLoss ? { acknowledgeVolumeLoss: true } : {}),
      },
      {
        onSuccess: () => {
          setPendingMove(undefined);
          toast.success(
            serverId
              ? `Pinned — redeploying on ${servers.find((s) => s.id === serverId)?.name ?? "the selected server"}`
              : "Unpinned — the scheduler will place this service",
          );
        },
        onError: (err: unknown) => {
          // The server refuses a move that abandons volumes until it's
          // acknowledged. Surface WHICH mounts, then let the operator decide.
          const mounts = volumeLossMounts(err);
          if (mounts) {
            setPendingMove({ serverId, mounts });
            return;
          }
          toast.error(err instanceof Error ? err.message : "Failed to change placement");
        },
      },
    );
  };

  return (
    <>
      <div className={rowClass}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground">Pinned to</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground/80">
              {service.placementServerId
                ? "This service will not fail over — if this machine goes down its task waits rather than moving."
                : "The scheduler places this service on any healthy machine."}
            </div>
          </div>
          <Select
            value={current}
            disabled={pinMut.isPending || serversQuery.isLoading}
            onValueChange={(next) => move(next === ANYWHERE ? null : next)}
          >
            <SelectTrigger className="w-52 shrink-0" size="sm">
              <SelectValue placeholder="Anywhere" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANYWHERE}>Anywhere (scheduler decides)</SelectItem>
              {servers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* A pin naming a server that no longer exists would otherwise show as
            a blank select — say it instead. */}
        {service.placementServerId && !pinnedServer && !serversQuery.isLoading && (
          <div className="mt-1.5 text-[11px] text-destructive">
            Pinned to a server that is no longer registered. This service will deploy unpinned until
            you choose another.
          </div>
        )}
      </div>

      <AlertDialog
        open={pendingMove !== undefined}
        onOpenChange={(open) => !open && setPendingMove(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Moving this service leaves its data behind</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingMove?.mounts.length === 1 ? "This volume lives" : "These volumes live"} on the
              current machine and will not follow the service. It will start with{" "}
              {pendingMove?.mounts.length === 1 ? "an empty volume" : "empty volumes"} on the new
              one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 text-[12px] text-muted-foreground">
            <ul className="font-mono text-[11px]">
              {pendingMove?.mounts.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <p>
              The old data stays on the old machine — nothing is deleted, but this service will no
              longer see it. Restore from a backup afterwards if you need it.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingMove && move(pendingMove.serverId, true)}
              disabled={pinMut.isPending}
            >
              Move anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The mounts an oRPC PLACEMENT_VOLUME_LOSS carries, or undefined for any
 *  other failure. */
function volumeLossMounts(err: unknown): string[] | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { code?: string; data?: { mounts?: unknown } };
  if (e.code !== "PLACEMENT_VOLUME_LOSS") return undefined;
  const mounts = e.data?.mounts;
  return Array.isArray(mounts) ? mounts.filter((m): m is string => typeof m === "string") : [];
}

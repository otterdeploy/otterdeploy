/**
 * Live `service.get` view + pause/resume actions for the service panel.
 *
 * The panel's `resource` prop comes from the polled resource-list collection,
 * which doesn't carry runtime status or the pause marker — this hook layers
 * the richer service view (runtime state, ports, healthcheck, pausedReplicas)
 * on top, polling on the same cadence family as the other panel collections.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc, queryClient } from "@/shared/server/orpc";

import type { PauseControl } from "./panel-parts";

import { isServicePaused } from "./service-status";

export type LiveServiceView = Awaited<ReturnType<typeof orpc.service.get.call>>;

export function useLiveService({
  projectId,
  resourceId,
  enabled,
}: {
  projectId: string;
  resourceId: string;
  enabled: boolean;
}): LiveServiceView | undefined {
  const query = useQuery({
    ...orpc.service.get.queryOptions({
      input: { projectId: projectId as never, resourceId: resourceId as never },
    }),
    enabled,
    // Runtime status/pause can change under us (webhooks, other operators).
    // 10s keeps the header honest without hammering docker inspect.
    refetchInterval: 10_000,
  });
  return query.data;
}

/**
 * Pause/resume mutations shaped as the header's {@link PauseControl}.
 * Returns null until the live view is loaded — the header renders no
 * pause button on guessed state.
 */
export function usePauseControl({
  projectId,
  resourceId,
  service,
}: {
  projectId: string;
  resourceId: string;
  service: LiveServiceView | undefined;
}): PauseControl | null {
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.service.get.queryKey({
          input: { projectId: projectId as never, resourceId: resourceId as never },
        }),
      }),
      // The graph node + panel prop read replicas/status from the resource
      // collection — refresh it now instead of waiting for the 5s poll.
      queryClient.invalidateQueries({ queryKey: ["resource"] }),
      queryClient.invalidateQueries({
        queryKey: orpc.project.resource.list.queryKey({
          input: { projectId: projectId as never },
        }),
      }),
    ]);
  };

  const pauseMut = useMutation({
    ...orpc.service.pause.mutationOptions(),
    onSuccess: () => toast.success("Service paused — replicas scaled to zero"),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to pause service"),
    onSettled: invalidate,
  });

  const resumeMut = useMutation({
    ...orpc.service.resume.mutationOptions(),
    onSuccess: () => toast.success("Service resuming"),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to resume service"),
    onSettled: invalidate,
  });

  if (!service) return null;

  const input = {
    projectId: projectId as never,
    resourceId: resourceId as never,
  };

  return {
    paused: isServicePaused(service),
    onPause: () => pauseMut.mutate(input),
    onResume: () => resumeMut.mutate(input),
    busy: pauseMut.isPending || resumeMut.isPending,
  };
}

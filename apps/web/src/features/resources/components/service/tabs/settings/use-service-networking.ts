/**
 * The writes behind {@link ServiceNetworkingCard} — add a custom host,
 * generate the platform one, re-publish an already-populated but unexposed
 * service — plus the one invalidation set they all share.
 *
 * Split out of ./networking-card so that component stays about layout. The
 * invalidations matter more than they look: adding the first host and
 * removing the last flip `publicEnabled`, which the graph node, the panel
 * header, and the Protection card all read from their own caches.
 */

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { SERVICE_DOMAINS_COLLECTION_KEY } from "@/features/resources/data/service-domains";
import { orpc, queryClient } from "@/shared/server/orpc";

export function useServiceNetworking({
  input,
  onAdded,
}: {
  input: { projectId: ProjectId; resourceId: ResourceId };
  /** Closes the add form once the host is accepted. */
  onAdded: () => void;
}) {
  const onSettled = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.service.domains.list.queryKey({ input }),
      }),
      queryClient.invalidateQueries({ queryKey: SERVICE_DOMAINS_COLLECTION_KEY }),
      // The primary mirrors into the resource list (panel header, graph), and
      // adding/removing the last host flips `publicEnabled` with it.
      queryClient.invalidateQueries({
        queryKey: orpc.project.resource.list.queryKey({
          input: { projectId: input.projectId },
        }),
      }),
      queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY }),
      queryClient.invalidateQueries({ queryKey: orpc.service.get.queryKey({ input }) }),
      // The Protection card gates on this resource's proxy routes ("expose
      // first" copy), so it goes stale the moment the host set changes.
      queryClient.invalidateQueries({
        queryKey: orpc.project.proxyRoute.list.queryKey({
          input: { projectId: input.projectId },
        }),
      }),
    ]);
  };

  const add = useMutation({
    ...orpc.service.domains.add.mutationOptions(),
    onSuccess: (domain) => {
      onAdded();
      toast.success(
        domain.status === "live"
          ? `${domain.domain} is live`
          : `${domain.domain} added — publish its DNS records to take it live`,
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to add domain"),
    onSettled,
  });

  const generate = useMutation({
    ...orpc.service.domains.generate.mutationOptions(),
    onSuccess: (domain) => toast.success(`Published on ${domain.domain}`),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to generate domain"),
    onSettled,
  });

  // Re-publishing hosts that already exist. Nothing in the card can reach that
  // state — removing the last host is the only way out of public — but a
  // service unexposed by the old toggle (or through the API) still has its
  // rows, and without this they'd sit disabled with no way back.
  const republish = useMutation({
    ...orpc.service.expose.mutationOptions(),
    onSuccess: () => toast.success("Public access restored"),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to publish"),
    onSettled,
  });

  return {
    onSettled,
    add: {
      run: (value: { domain: string; port: number | undefined }) =>
        add.mutate({ ...input, ...value }),
      pending: add.isPending,
    },
    generate: { run: () => generate.mutate(input), pending: generate.isPending },
    republish: {
      run: () => republish.mutate({ ...input, allowGeneratedDomain: true }),
      pending: republish.isPending,
    },
  };
}

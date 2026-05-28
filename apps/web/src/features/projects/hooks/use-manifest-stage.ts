/**
 * Stage a manifest change on the server without applying.
 *
 * Replaces the duplicated `manifest.get → mutate → manifest.save →
 * invalidate diff/get/resource.list` boilerplate that lived in the
 * wizard (service create + database create) and the postgres
 * danger-zone delete. The pending-changes bar then surfaces the
 * staged change; the operator clicks Deploy to reconcile.
 *
 * Usage:
 *   const stage = useStageManifestChange(projectId);
 *   await stage((manifest) => ({
 *     ...manifest,
 *     services: { ...manifest.services, web: { ... } },
 *   }));
 */

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Manifest } from "@otterdeploy/api/manifest";
import type { Id, ID_PREFIX } from "@otterdeploy/shared/id";

import { orpc, queryClient } from "@/shared/server/orpc";

type ProjectId = Id<typeof ID_PREFIX.project>;

/** A pure transform producing the next manifest from the current one. */
export type ManifestMutator = (current: Manifest) => Manifest;

interface UseStageManifestChangeOptions {
  /**
   * Toast on success. Default `null` — the staging bar is the feedback
   * surface, not a toast. Pass a string to surface confirmation.
   */
  successToast?: string | null;
}

export function useStageManifestChange(
  projectId: ProjectId,
  options: UseStageManifestChangeOptions = {},
) {
  const { successToast = null } = options;

  return useMutation({
    mutationFn: async (mutate: ManifestMutator) => {
      const current = await orpc.project.manifest.get.call({ id: projectId });
      // First-stage on a fresh project — seed an empty manifest so the
      // caller's mutator doesn't have to special-case `current.manifest
      // === null`.
      const base: Manifest =
        current.manifest ??
        ({
          version: 1 as const,
          project: "" as Manifest["project"],
          services: {},
          databases: {},
        } as Manifest);
      const next = mutate(base);
      await orpc.project.manifest.save.call({
        projectId,
        manifest: next,
        expectedVersion: current.version,
      });
      return { version: current.version + 1, manifest: next };
    },
    onSuccess: async () => {
      if (successToast) toast.success(successToast);
      // Invalidate everything the pending-changes bar + graph + panel
      // consume so the staged change becomes visible immediately
      // without a manual refresh.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.project.manifest.diff.queryKey({ input: { projectId } }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.project.manifest.get.queryKey({ input: { id: projectId } }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.project.resource.list.queryKey({ input: { projectId } }),
        }),
      ]);
    },
    onError: (err) => toast.error(err.message ?? "Failed to stage change"),
  });
}

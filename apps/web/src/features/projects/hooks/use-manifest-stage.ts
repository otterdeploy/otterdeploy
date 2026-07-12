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

import type { Manifest } from "@otterdeploy/api/manifest";
import type { Id, ID_PREFIX } from "@otterdeploy/shared/id";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { DEPENDENCIES_COLLECTION_KEY } from "@/features/projects/data/dependencies";
import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { SERVICE_TASKS_COLLECTION_KEY } from "@/features/resources/data/service-tasks";
import { orpc, queryClient } from "@/shared/server/orpc";

type ProjectId = Id<typeof ID_PREFIX.project>;

/** A pure transform producing the next manifest from the current one. */
export type ManifestMutator = (current: Manifest) => Manifest;

/** Seed an empty manifest so a mutator never has to special-case the
 *  first-ever change on a fresh project. */
const emptyManifest = (): Manifest =>
  ({
    version: 1 as const,
    project: "" as Manifest["project"],
    services: {},
    databases: {},
  }) as Manifest;

/** Invalidate everything the pending-changes bar, graph, and resource
 *  panels read so a manifest write is reflected without a manual refresh.
 *  Partial-input keys (projectId only) catch the graph's diff query and
 *  the bar's (projectId, environment) query alike. */
async function invalidateManifestConsumers(projectId: ProjectId) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: orpc.project.manifest.diff.queryKey({ input: { projectId } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.project.manifest.get.queryKey({ input: { id: projectId } }),
    }),
    // The graph reads resources / edges / task rollup from TanStack DB
    // collections keyed by a PREFIX — a bare `resource.list` orpc key never
    // matches, so invalidate the collections' own exported keys to refetch it.
    queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY }),
    queryClient.invalidateQueries({ queryKey: DEPENDENCIES_COLLECTION_KEY }),
    queryClient.invalidateQueries({ queryKey: SERVICE_TASKS_COLLECTION_KEY }),
  ]);
}

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
      const next = mutate(current.manifest ?? emptyManifest());
      await orpc.project.manifest.save.call({
        projectId,
        manifest: next,
        expectedVersion: current.version,
      });
      return { version: current.version + 1, manifest: next };
    },
    onSuccess: async () => {
      if (successToast) toast.success(successToast);
      await invalidateManifestConsumers(projectId);
    },
    onError: (err) => toast.error(err.message ?? "Failed to stage change"),
  });
}

/** Per-resource failures the reconciler reports instead of throwing. */
interface SkippedChange {
  resource: "service" | "database" | "env" | "compose";
  name: string;
  reason: string;
}

export interface ApplyManifestResult {
  appliedCount: number;
  skipped: SkippedChange[];
  /** True when at least one change reconciled — the caller can treat this
   *  as "the resource exists / a deploy started" and e.g. navigate to the
   *  graph. False means everything landed in `skipped` (nothing deployed). */
  applied: boolean;
}

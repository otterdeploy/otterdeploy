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
import { projectSlugById } from "@/features/projects/data/project";
import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { SERVICE_TASKS_COLLECTION_KEY } from "@/features/resources/data/service-tasks";
import { orpc, queryClient } from "@/shared/server/orpc";

type ProjectId = Id<typeof ID_PREFIX.project>;

/**
 * A manifest as the save endpoint accepts it: the project slug is a plain
 * string (the schema brands it server-side on parse). Every read `Manifest`
 * is assignable to this, and it lets the empty seed carry the deliberate
 * falsy `""` slug (which mutators replace via `current.project || slug`)
 * without asserting a brand it doesn't have.
 */
type ManifestDraft = Omit<Manifest, "project"> & { project: string };

/** A pure transform producing the next manifest from the current one. */
type ManifestMutator = (current: ManifestDraft) => ManifestDraft;

/** Seed an empty manifest so a mutator never has to special-case the
 *  first-ever change on a fresh project. `project` is filled in by the hook
 *  below, not here: the seed has no access to the slug. */
const emptyManifest = (): ManifestDraft => ({
  version: 1,
  project: "",
  services: {},
  databases: {},
  composes: {},
});

/** Invalidate everything the pending-changes bar, graph, stack-code drawer,
 *  and resource panels read so a manifest write (stage OR apply) is reflected
 *  without a manual refresh. Partial-input keys (projectId only) catch the
 *  graph's diff query and the bar's (projectId, environment) query alike.
 *  Exported as the single post-manifest-write refresh. The pending-changes
 *  bar's Deploy/Discard reuse it instead of re-listing (and drifting from)
 *  these keys. */
export async function invalidateManifestConsumers(projectId: ProjectId) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: orpc.project.manifest.diff.queryKey({ input: { projectId } }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.project.manifest.get.queryKey({ input: { id: projectId } }),
    }),
    // The stack-code drawer renders `project.stack.diff` (rendered + saved
    // yaml). Both stage and apply change what it should show. Without this
    // it kept the day-0 yaml until a hard reload.
    queryClient.invalidateQueries({
      queryKey: orpc.project.stack.diff.queryKey({ input: { projectId } }),
    }),
    // The graph reads resources / edges / task rollup from TanStack DB
    // collections keyed by a PREFIX: a bare `resource.list` orpc key never
    // matches, so invalidate the collections' own exported keys to refetch it.
    queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY }),
    queryClient.invalidateQueries({ queryKey: DEPENDENCIES_COLLECTION_KEY }),
    queryClient.invalidateQueries({ queryKey: SERVICE_TASKS_COLLECTION_KEY }),
    // The header activity pill idles at a slow tick (it's a dead-stream
    // backstop, see use-deploy-activity). An apply is the moment it must
    // flip to "building" NOW, so refresh it explicitly rather than waiting
    // out the idle interval.
    queryClient.invalidateQueries({ queryKey: orpc.deployment.activity.key() }),
  ]);
}

interface UseStageManifestChangeOptions {
  /**
   * Toast on success. Default `null`: the staging bar is the feedback
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
      // `project` is a SLUG with a 2-char minimum, so the `""` the empty seed
      // carries is not merely cosmetic: the server rejects it, and the operator
      // gets "Too small: expected string to have >=2 characters" as a toast.
      // Filling it here rather than in each mutator is what makes every
      // staging surface correct — only 2 of the 13 call sites remembered to do
      // it, and the other 11 were relying on a manifest already existing.
      const project = next.project || projectSlugById(projectId) || "";
      await orpc.project.manifest.save.call({
        projectId,
        manifest: { ...next, project },
        expectedVersion: current.version,
      });
      return { version: current.version + 1, manifest: { ...next, project } };
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

interface ApplyManifestResult {
  appliedCount: number;
  skipped: SkippedChange[];
  /** True when at least one change reconciled. The caller can treat this
   *  as "the resource exists / a deploy started" and e.g. navigate to the
   *  graph. False means everything landed in `skipped` (nothing deployed). */
  applied: boolean;
}

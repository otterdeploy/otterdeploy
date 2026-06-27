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
    queryClient.invalidateQueries({
      queryKey: orpc.project.resource.list.queryKey({ input: { projectId } }),
    }),
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

/**
 * One-shot create + deploy. Mirrors {@link useStageManifestChange} but
 * calls `manifest.applyChange` (atomic save + reconcile) so a single
 * action both records the change AND provisions it — no separate trip to
 * the pending-changes bar's Deploy button.
 *
 * The reconciler reports per-resource failures in `skipped[]` rather than
 * throwing (a git create with no build binding, an unresolved `${secret}`,
 * …). We surface those as toasts and return them so the caller can decide
 * whether to navigate. The change is still saved on partial/total failure,
 * so the pending-changes bar + graph ghost remain as a recovery surface.
 */
function useApplyManifestChange(projectId: ProjectId) {
  return useMutation({
    mutationFn: async (mutate: ManifestMutator): Promise<ApplyManifestResult> => {
      const current = await orpc.project.manifest.get.call({ id: projectId });
      const next = mutate(current.manifest ?? emptyManifest());
      const result = await orpc.project.manifest.applyChange.call({
        projectId,
        manifest: next,
        expectedVersion: current.version,
      });
      return {
        appliedCount: result.appliedCount,
        skipped: result.skipped,
        applied: result.appliedCount > 0,
      };
    },
    onSuccess: async (result) => {
      await invalidateManifestConsumers(projectId);
      const detail = result.skipped.map((s) => `${s.resource} ${s.name}: ${s.reason}`).join("; ");
      if (result.skipped.length === 0) {
        toast.success(
          `Deployed ${result.appliedCount} change${result.appliedCount === 1 ? "" : "s"}`,
        );
      } else if (result.appliedCount === 0) {
        // Nothing landed — the change is saved (pending) but couldn't be
        // provisioned. Point the operator at the actionable reason.
        toast.error(`Nothing deployed — ${detail}`);
      } else {
        toast.warning(
          `Deployed ${result.appliedCount}, skipped ${result.skipped.length} — ${detail}`,
        );
      }
    },
    onError: (err) => toast.error(err.message ?? "Failed to deploy change"),
  });
}

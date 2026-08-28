/**
 * Every server interaction the pending-changes bar has: the diff poll, apply,
 * discard, and the cache invalidation each one owes.
 *
 * Split from the component so that file is layout and this one is behaviour —
 * and because all three inline kept `PendingChangesBar` over the repo's
 * function-length cap.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  clearAppliedCreatesForProject,
  markAppliedCreates,
} from "@/features/projects/components/graph/applied-creates-store";
import { clearPendingFrameworksForProject } from "@/features/projects/components/graph/pending-framework-store";
import { invalidateManifestConsumers } from "@/features/projects/hooks/use-manifest-stage";
import { toastMessage } from "@/shared/lib/errors";
import { orpc } from "@/shared/server/orpc";

/** A resource the apply or discard should be limited to. Module-private: the
 *  callers pass object literals and let inference do the work. */
interface ChangeRef {
  resource: "service" | "database" | "compose";
  name: string;
}

export function usePendingChanges(projectId: ProjectId, environment: string | undefined) {
  // While an apply is in flight we poll hard so the bar observes "manifest
  // applied" (an empty diff) within a couple of seconds of the rows landing —
  // that empty diff is the bar's close signal. 60s is the dead-stream backstop;
  // manifest writes normally push a resync over the event stream. Input +
  // interval MUST stay in sync with the graph's diff query (graph-model.ts) so
  // the two share one cache entry instead of running parallel pollers.
  const [applying, setApplying] = useState(false);

  const diff = useQuery(
    orpc.project.manifest.diff.queryOptions({
      input: { projectId, environment },
      refetchInterval: applying ? 2_000 : 60_000,
    }),
  );

  // Invalidates the diff, the manifest, the stack yaml AND the prefix-keyed
  // resource/dependency/task collections the graph and detail panels read. An
  // earlier version invalidated the bare `orpc.project.resource.list` key,
  // which never matches the collection's ["resource", …] prefix, so a freshly
  // applied resource stayed missing from the graph until a hard reload.
  const refreshAll = () => invalidateManifestConsumers(projectId);

  const applyMut = useMutation({
    mutationFn: (only?: ChangeRef[]) =>
      orpc.project.manifest.apply.call({ projectId, environment, only }),
    // Bridge the graph's ghost nodes BEFORE apply starts. apply() drains each
    // resource's create stream, so it runs for seconds while the diff keeps
    // polling. The instant a create's row inserts mid-stream the diff stops
    // reporting it, and if the resource-list poll hasn't landed the row yet the
    // node belongs to neither source and blinks out. Recording the create keys
    // up front pins those ghosts across the whole apply.
    onMutate: () => {
      const changes = diff.data?.changes ?? [];
      markAppliedCreates(
        projectId,
        changes.flatMap((c) =>
          c.kind === "create" && c.resource !== "env" ? [`${c.resource}:${c.name}`] : [],
        ),
      );
      setApplying(true);
    },
    onSuccess: async (result) => {
      setApplying(false);
      await refreshAll();
      // The reconciler reports per-resource failures in `skipped[]` rather than
      // throwing, and a deliberately deferred row arrives on that same channel.
      // Whatever was skipped is still in the diff, so the bar re-surfaces by
      // itself.
      if (result.skipped.length > 0) {
        const detail = result.skipped.map((s) => `${s.resource} ${s.name}: ${s.reason}`).join("; ");
        if (result.appliedCount === 0) {
          toast.error(`Nothing applied: ${detail}`);
          return;
        }
        toast.warning(
          `Applied ${result.appliedCount}, skipped ${result.skipped.length}: ${detail}`,
        );
        return;
      }
      toast.success(`Applied ${result.appliedCount} change(s)`);
    },
    onError: (err) => {
      setApplying(false);
      toast.error(toastMessage(err, "Apply failed"));
    },
  });

  const discardMut = useMutation({
    mutationFn: (only?: ChangeRef[]) => orpc.project.manifest.discard.call({ projectId, only }),
    // Clear the ghost stores up front so a create-ghost from a prior apply
    // vanishes the instant the operator discards; otherwise `computePendingByName`
    // keeps re-synthesizing it until the TTL — the "ghost that won't die".
    onMutate: () => {
      clearAppliedCreatesForProject(projectId);
      clearPendingFrameworksForProject(projectId);
    },
    onSuccess: async (_res, only) => {
      toast.success(
        only?.length ? `Discarded the change to ${only[0].name}` : "Pending changes discarded",
      );
      await refreshAll();
    },
    onError: (err) => toast.error(toastMessage(err, "Discard failed")),
  });

  return { diff, applyMut, discardMut };
}

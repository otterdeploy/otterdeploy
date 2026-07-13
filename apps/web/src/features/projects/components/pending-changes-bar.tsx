/**
 * Floating "Apply N change(s)" pill — sits below the top nav whenever
 * the saved manifest diverges from current resources.
 *
 * Reads from manifest.diff (same diff CLI `status` uses), so the UI
 * and CLI agree on what "pending" means:
 *   - wizard create staged (no apply)
 *   - postgres delete staged (no apply)
 *   - CLI `sync --preview` saved without apply
 *   - resources drifted out-of-band
 *
 * Click the count to expand into a per-resource diff view that names
 * the change (create / update / delete), lists the field-level
 * current → new values for updates, and surfaces per-resource discard.
 * Deploy = manifest.apply. Discard = manifest.discard.
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
import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { toastMessage } from "@/shared/lib/errors";
import { orpc, queryClient } from "@/shared/server/orpc";

import { ChangeGroupCard, type DiffChange, groupChanges } from "./pending-changes-diff";

interface PendingChangesBarProps {
  projectId: ProjectId;
  environment?: string;
}

export function PendingChangesBar({ projectId, environment }: PendingChangesBarProps) {
  const [expanded, setExpanded] = useState(false);

  const diff = useQuery(
    orpc.project.manifest.diff.queryOptions({
      input: { projectId, environment },
      refetchInterval: 5_000,
    }),
  );

  const refreshAll = async () => {
    await Promise.all([
      // Partial-input invalidation — the graph layout queries diff
      // without `environment` in its input, so a key matching only
      // projectId catches both that query and the bar's own
      // (projectId, environment) query. Otherwise the graph keeps the
      // ghost create-node until its 5s refetchInterval catches up.
      queryClient.invalidateQueries({
        queryKey: orpc.project.manifest.diff.queryKey({
          input: { projectId },
        }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.project.manifest.get.queryKey({ input: { id: projectId } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.project.resource.list.queryKey({ input: { projectId } }),
      }),
    ]);
  };

  const applyMut = useMutation({
    mutationFn: () => orpc.project.manifest.apply.call({ projectId, environment }),
    // Bridge the graph's ghost nodes BEFORE kicking off apply, not after.
    // apply() drains each resource's create stream, so the call runs for
    // seconds — and manifest.diff keeps polling on its 5s cadence the whole
    // time. The instant a create's DB row inserts (mid-stream), the next diff
    // poll stops reporting it as a create; if the resource-list poll hasn't
    // landed the row yet, the node belongs to neither source and blinks out,
    // then back when the row arrives. Recording the create keys up front keeps
    // those ghosts pinned across the entire apply + the post-apply refetch gap.
    onMutate: () => {
      const appliedCreateKeys = (diff.data?.changes ?? []).flatMap((c) =>
        c.kind === "create" && c.resource !== "env" ? [`${c.resource}:${c.name}`] : [],
      );
      markAppliedCreates(projectId, appliedCreateKeys);
    },
    onSuccess: async (result) => {
      await refreshAll();
      // The reconciler reports per-resource failures in `skipped[]` rather
      // than throwing — a create that hits a missing build binding or an
      // unresolved ${secret} lands here, not in the catch.
      if (result.skipped.length > 0) {
        const detail = result.skipped.map((s) => `${s.resource} ${s.name}: ${s.reason}`).join("; ");
        if (result.appliedCount === 0) {
          // Nothing landed — keep the bar open so the operator can fix the
          // cause (e.g. bind the project's repo/registry) and retry.
          toast.error(`Nothing deployed — ${detail}`);
          return;
        }
        toast.warning(
          `Applied ${result.appliedCount}, skipped ${result.skipped.length} — ${detail}`,
        );
      } else {
        toast.success(`Applied ${result.appliedCount} change(s)`);
      }
      setExpanded(false);
    },
    onError: (err) => toast.error(toastMessage(err, "Apply failed")),
  });

  const discardMut = useMutation({
    mutationFn: () => orpc.project.manifest.discard.call({ projectId }),
    // Clear the graph's ghost-bridge stores up front so a create-ghost recorded
    // by a prior Deploy (whose resource never landed) vanishes THE INSTANT the
    // operator discards — otherwise `computePendingByName` keeps re-synthesizing
    // it from applied-creates until the 30s TTL, the "ghost that won't die". The
    // diff (the other ghost source) is refreshed in onSuccess. Safe optimistic:
    // Discard is disabled while a Deploy is in flight, and if discard itself
    // fails the still-pending change re-renders its ghost from the diff.
    onMutate: () => {
      clearAppliedCreatesForProject(projectId);
      clearPendingFrameworksForProject(projectId);
    },
    onSuccess: async () => {
      toast.success("Pending changes discarded");
      await refreshAll();
      setExpanded(false);
    },
    onError: (err) => toast.error(toastMessage(err, "Discard failed")),
  });

  const busy = applyMut.isPending || discardMut.isPending;
  const meaningful = (diff.data?.changes ?? []).filter((c): c is DiffChange => c.kind !== "no-op");
  // Keep the bar mounted while deploying — otherwise the moment the diff poll
  // sees a create's row land mid-apply it would report 0 changes and the bar
  // (and its progress) would vanish before the deploy finishes.
  if (meaningful.length === 0 && !applyMut.isPending) return null;

  // Group by (resource kind + name). One named resource may produce
  // multiple `env` rows; they all roll up under the parent service for
  // display so the user sees "service api will be updated · 2 vars".
  const groups = groupChanges(meaningful);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-40 flex justify-center">
      <div
        className={`pointer-events-auto flex flex-col items-stretch overflow-hidden rounded-2xl border bg-card/95 shadow-lg backdrop-blur ${
          expanded ? "w-[min(640px,calc(100vw-2rem))]" : ""
        }`}
      >
        <div className="flex items-center gap-3 px-4 py-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:opacity-80"
            aria-expanded={expanded}
          >
            <span
              className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`}
              aria-hidden
            >
              ▸
            </span>
            {applyMut.isPending
              ? "Deploying…"
              : `Apply ${meaningful.length} change${meaningful.length === 1 ? "" : "s"}`}
          </button>
          <Button size="sm" variant="ghost" onClick={() => discardMut.mutate()} disabled={busy}>
            Discard
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={() => applyMut.mutate()}
            disabled={busy}
            className="gap-1.5"
          >
            {applyMut.isPending ? (
              <>
                <Spinner className="size-3.5" />
                Deploying…
              </>
            ) : (
              "Deploy"
            )}
          </Button>
        </div>
        {expanded && (
          <div className="max-h-[60vh] overflow-auto border-t bg-muted/30">
            <ul className="flex flex-col gap-3 p-3">
              {groups.map((g, i) => (
                <li key={`${g.resource}-${g.name}-${i}`}>
                  <ChangeGroupCard group={g} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

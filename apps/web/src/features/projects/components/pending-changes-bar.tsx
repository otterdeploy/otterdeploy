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
 * Apply = manifest.apply. Discard = manifest.discard.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, type Transition, useReducedMotion } from "motion/react";
import * as m from "motion/react-client";
import { toast } from "sonner";

import {
  clearAppliedCreatesForProject,
  markAppliedCreates,
} from "@/features/projects/components/graph/applied-creates-store";
import { clearPendingFrameworksForProject } from "@/features/projects/components/graph/pending-framework-store";
import { invalidateManifestConsumers } from "@/features/projects/hooks/use-manifest-stage";
import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { toastMessage } from "@/shared/lib/errors";
import { orpc } from "@/shared/server/orpc";

import { ChangeGroupCard, type DiffChange, groupChanges } from "./pending-changes-diff";

interface PendingChangesBarProps {
  projectId: ProjectId;
  environment?: string;
}

export function PendingChangesBar({ projectId, environment }: PendingChangesBarProps) {
  const [expanded, setExpanded] = useState(false);

  // Calm, fast morph (DESIGN: 150–250ms). Framer's JS animations aren't covered
  // by the CSS prefers-reduced-motion reset, so collapse to instant ourselves.
  const reduce = useReducedMotion();
  const morph: Transition = reduce ? { duration: 0 } : { duration: 0.28, ease: [0.2, 0.7, 0.2, 1] };

  const diff = useQuery(
    orpc.project.manifest.diff.queryOptions({
      input: { projectId, environment },
      refetchInterval: 5_000,
    }),
  );

  // Shared post-manifest-write refresh (diff / manifest / stack yaml + the
  // prefix-keyed resource, dependency and task collections the graph and
  // detail panels read). The previous local version invalidated the bare
  // `orpc.project.resource.list` key, which NEVER matches the resource
  // collection's ["resource", …] prefix key — so a freshly applied resource
  // stayed missing from the graph/panel until a hard reload.
  const refreshAll = () => invalidateManifestConsumers(projectId);

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
          toast.error(`Nothing applied — ${detail}`);
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
    // by a prior Apply (whose resource never landed) vanishes THE INSTANT the
    // operator discards — otherwise `computePendingByName` keeps re-synthesizing
    // it from applied-creates until the 30s TTL, the "ghost that won't die". The
    // diff (the other ghost source) is refreshed in onSuccess. Safe optimistic:
    // Discard is disabled while an Apply is in flight, and if discard itself
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
  // Keep the bar mounted while applying — otherwise the moment the diff poll
  // sees a create's row land mid-apply it would report 0 changes and the bar
  // (and its progress) would vanish before the apply finishes.
  if (meaningful.length === 0 && !applyMut.isPending) return null;

  // Group by (resource kind + name). One named resource may produce
  // multiple `env` rows; they all roll up under the parent service for
  // display so the user sees "service api will be updated · 2 vars".
  const groups = groupChanges(meaningful);

  return (
    // Own layer below the site header AND the project tab row (h-10), never
    // on top of either — the pill used to sit at a fixed `top-20` that fell
    // inside the tab row's band and covered Deployments/Logs/Metrics.
    <div
      // px-3 so the pill can never touch (or overrun) the screen edges — the
      // collapsed bar is ~290px of content and a phone is 375px.
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3"
      style={{ top: "calc(var(--header-height) + 2.5rem + 0.75rem)" }}
    >
      {/* `layout` morphs the pill↔panel width; the body handles its own height
          reveal below. No backdrop-blur — it flickers while the box resizes and
          is invisible at bg-card/95 anyway. */}
      <m.div
        layout
        transition={morph}
        className={`pointer-events-auto flex max-w-full flex-col items-stretch overflow-hidden rounded-2xl border bg-card/95 shadow-lg ${
          expanded ? "w-[min(640px,calc(100vw-2rem))]" : ""
        }`}
      >
        <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground hover:opacity-80"
            aria-expanded={expanded}
          >
            <span
              className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`}
              aria-hidden
            >
              ▸
            </span>
            <span className="truncate">
              {applyMut.isPending
                ? "Applying…"
                : `Apply ${meaningful.length} change${meaningful.length === 1 ? "" : "s"}`}
            </span>
          </button>
          {/* ml-auto pins the actions to the trailing end once the bar widens. */}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto shrink-0"
            onClick={() => discardMut.mutate()}
            disabled={busy}
          >
            Discard
          </Button>
          <Button
            size="sm"
            variant="default"
            className="shrink-0"
            onClick={() => applyMut.mutate()}
            disabled={busy}
            aria-label={applyMut.isPending ? "Applying" : undefined}
          >
            {/* Header already reads "Applying…" — the button is spinner-only. */}
            {applyMut.isPending ? <Spinner className="size-3.5" /> : "Apply"}
          </Button>
        </div>
        <AnimatePresence initial={false}>
          {expanded && (
            <m.div
              key="diff"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={morph}
              className="overflow-hidden border-t bg-muted/30"
            >
              <div className="max-h-[60vh] overflow-auto">
                <ul className="flex flex-col gap-3 p-3">
                  {groups.map((g, i) => (
                    <m.li
                      key={`${g.resource}-${g.name}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...morph, delay: reduce ? 0 : 0.03 + i * 0.04 }}
                    >
                      <ChangeGroupCard group={g} />
                    </m.li>
                  ))}
                </ul>
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </m.div>
    </div>
  );
}

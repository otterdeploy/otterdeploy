/**
 * Floating "Apply N change(s)" pill. Sits below the top nav whenever
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

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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

import type { GroupedChange } from "./pending-changes-groups";

import { ChangeGroupCard, type DiffChange, groupChanges } from "./pending-changes-diff";

interface PendingChangesBarProps {
  projectId: ProjectId;
  environment?: string;
}

export function PendingChangesBar({ projectId, environment }: PendingChangesBarProps) {
  const [expanded, setExpanded] = useState(false);

  // Framer's JS animations aren't covered by the CSS prefers-reduced-motion
  // reset, so collapse to instant ourselves.
  const reduce = useReducedMotion();
  // The Ionic drawer curve. This is a box growing from an anchor, which is
  // drawer-shaped motion, not a generic fade — and the drawer/modal band is
  // 200–500ms, so 260 sits where a size change this large reads as deliberate
  // without feeling slow.
  const morph: Transition = reduce ? { duration: 0 } : { duration: 0.26, ease: [0.32, 0.72, 0, 1] };
  // Content is a crossfade, not a movement: shorter, and a strong ease-out.
  const fade: Transition = reduce ? { duration: 0 } : { duration: 0.16, ease: [0.23, 1, 0.32, 1] };

  // Manifest writes push a `manifest` resync over the event stream, and local
  // staging invalidates via invalidateManifestConsumers: the interval is only
  // a dead-stream backstop. Input + interval MUST stay in sync with the
  // graph's diff query (graph-model.ts). Same input means one shared cache
  // entry instead of two parallel pollers.
  // 60s is the dead-stream backstop; while an apply is in flight we poll
  // hard so the bar observes "manifest applied" (empty diff) within a couple
  // of seconds of the rows landing: that empty diff is the close signal.
  const [applying, setApplying] = useState(false);
  const diff = useQuery(
    orpc.project.manifest.diff.queryOptions({
      input: { projectId, environment },
      refetchInterval: applying ? 2_000 : 60_000,
    }),
  );

  // Shared post-manifest-write refresh (diff / manifest / stack yaml + the
  // prefix-keyed resource, dependency and task collections the graph and
  // detail panels read). The previous local version invalidated the bare
  // `orpc.project.resource.list` key, which NEVER matches the resource
  // collection's ["resource", …] prefix key, so a freshly applied resource
  // stayed missing from the graph/panel until a hard reload.
  const refreshAll = () => invalidateManifestConsumers(projectId);

  const applyMut = useMutation({
    mutationFn: () => orpc.project.manifest.apply.call({ projectId, environment }),
    // Bridge the graph's ghost nodes BEFORE kicking off apply, not after.
    // apply() drains each resource's create stream, so the call runs for
    // seconds, and manifest.diff keeps polling on its 5s cadence the whole
    // time. The instant a create's DB row inserts (mid-stream), the next diff
    // poll stops reporting it as a create; if the resource-list poll hasn't
    // landed the row yet, the node belongs to neither source and blinks out,
    // then back when the row arrives. Recording the create keys up front keeps
    // those ghosts pinned across the entire apply + the post-apply refetch gap.
    onMutate: () => {
      const changes = diff.data?.changes ?? [];
      const appliedCreateKeys = changes.flatMap((c) =>
        c.kind === "create" && c.resource !== "env" ? [`${c.resource}:${c.name}`] : [],
      );
      markAppliedCreates(projectId, appliedCreateKeys);
      setApplying(true);
    },
    onSuccess: async (result) => {
      setApplying(false);
      await refreshAll();
      // The reconciler reports per-resource failures in `skipped[]` rather
      // than throwing: a create that hits a missing build binding or an
      // unresolved ${secret} lands here, not in the catch. Whatever was
      // skipped is still in the diff, so the bar re-surfaces by itself.
      if (result.skipped.length > 0) {
        const detail = result.skipped.map((s) => `${s.resource} ${s.name}: ${s.reason}`).join("; ");
        if (result.appliedCount === 0) {
          toast.error(`Nothing applied: ${detail}`);
          return;
        }
        toast.warning(
          `Applied ${result.appliedCount}, skipped ${result.skipped.length}: ${detail}`,
        );
      } else {
        toast.success(`Applied ${result.appliedCount} change(s)`);
      }
    },
    onError: (err) => {
      setApplying(false);
      toast.error(toastMessage(err, "Apply failed"));
    },
  });

  const discardMut = useMutation({
    mutationFn: (only?: Array<{ resource: "service" | "database" | "compose"; name: string }>) =>
      orpc.project.manifest.discard.call({ projectId, only }),
    // Clear the graph's ghost-bridge stores up front so a create-ghost recorded
    // by a prior Apply (whose resource never landed) vanishes THE INSTANT the
    // operator discards: otherwise `computePendingByName` keeps re-synthesizing
    // it from applied-creates until the 30s TTL, the "ghost that won't die". The
    // diff (the other ghost source) is refreshed in onSuccess. Safe optimistic:
    // Discard is disabled while an Apply is in flight, and if discard itself
    // fails the still-pending change re-renders its ghost from the diff.
    onMutate: () => {
      clearAppliedCreatesForProject(projectId);
      clearPendingFrameworksForProject(projectId);
    },
    onSuccess: async (_res, only) => {
      toast.success(
        only?.length ? `Discarded the change to ${only[0].name}` : "Pending changes discarded",
      );
      await refreshAll();
      // A single-change discard leaves the others staged, so keep the list
      // open. Collapsing it would hide the work still waiting to be applied.
      if (!only?.length) setExpanded(false);
    },
    onError: (err) => toast.error(toastMessage(err, "Discard failed")),
  });

  const busy = applyMut.isPending || discardMut.isPending;
  const meaningful = (diff.data?.changes ?? []).filter((c): c is DiffChange => c.kind !== "no-op");
  // The bar's lifetime is the MANIFEST's divergence. Nothing else. apply()
  // keeps running while services provision and build, so gating on isPending
  // held the spinner hostage to the BUILD, long after the manifest itself was
  // applied. Instead the fast diff poll above is the close signal: the moment
  // the server reports the changes applied (empty diff) the bar unmounts,
  // mid-RPC or not. The loading toast carries the call to its real end, the
  // graph's node badges carry deploy/build progress, and a failed or partial
  // apply re-surfaces the bar here because its changes are still in the diff.
  if (meaningful.length === 0) return null;

  // Group by (resource kind + name). One named resource may produce
  // multiple `env` rows; they all roll up under the parent service for
  // display so the user sees "service api will be updated · 2 vars".
  const groups = groupChanges(meaningful);

  return (
    // Own layer below the site header AND the project tab row (h-10), never
    // on top of either: the pill used to sit at a fixed `top-20` that fell
    // inside the tab row's band and covered Deployments/Logs/Metrics.
    <div
      // px-3 so the pill can never touch (or overrun) the screen edges. The
      // collapsed bar is ~290px of content and a phone is 375px.
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3"
      style={{ top: "calc(var(--header-height) + 2.5rem + 0.75rem)" }}
    >
      {/* `layout` morphs the pill↔panel width; the body handles its own height
          reveal below. No backdrop-blur: it flickers while the box resizes and
          is invisible at bg-card/95 anyway. */}
      {/* ONE layout animation, and children that only ever fade.
       *
       * The previous version ran `layout` here AND `height: 0 → auto` on the
       * body, which is two competing layout animations: projection measures a
       * box whose height is itself mid-flight, so every frame corrects against
       * a moving target. That was the jank. `height` is also a layout property,
       * so it forced layout → paint → composite on the whole subtree each
       * frame. The body now animates opacity only and this container owns the
       * size change, which projection does with transforms.
       *
       * `borderRadius` moves to `style` because projection SCALES the box, and
       * Motion can only counter-scale a radius it owns — as a class it stretched
       * into an ellipse mid-morph. */}
      <m.div
        layout
        transition={morph}
        style={{ borderRadius: 16 }}
        className={`pointer-events-auto flex max-w-full flex-col items-stretch overflow-hidden border bg-card/95 shadow-lg ${
          expanded ? "w-[min(640px,calc(100vw-2rem))]" : ""
        }`}
      >
        <PendingBarHeader
          count={meaningful.length}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          applying={applyMut.isPending}
          busy={busy}
          morph={morph}
          onDiscardAll={() => discardMut.mutate(undefined)}
          onApply={() => applyMut.mutate()}
        />
        {/* `popLayout` pops the exiting body out of flow immediately, so the box
            collapses WHILE the content fades instead of waiting for it. */}
        <AnimatePresence initial={false} mode="popLayout">
          {expanded && (
            <m.div
              key="diff"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fade}
              className="border-t bg-muted/30"
            >
              <div className="max-h-[60vh] overflow-auto">
                <ChangeList
                  groups={groups}
                  morph={fade}
                  reduce={reduce}
                  busy={busy}
                  discarding={discardMut.isPending}
                  onDiscardOne={(g) => discardMut.mutate([{ resource: g.resource, name: g.name }])}
                />
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </m.div>
    </div>
  );
}

/** The always-visible row: label, chevron, Discard, Apply. Split out of
 *  PendingChangesBar to stay inside the file's function-length cap, and it
 *  reads better alone — this is the part the operator sees whether or not the
 *  panel is open. */
function PendingBarHeader({
  count,
  expanded,
  onToggle,
  applying,
  busy,
  morph,
  onDiscardAll,
  onApply,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
  applying: boolean;
  busy: boolean;
  morph: Transition;
  onDiscardAll: () => void;
  onApply: () => void;
}) {
  return (
    // `layout="position"` — the header TRANSLATES to its new spot instead of
    // being scaled with the box. Without it the label and buttons are stretched
    // by the projection, which is the blur during the morph.
    <m.div
      layout="position"
      transition={morph}
      className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4"
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground hover:opacity-80"
        aria-expanded={expanded}
      >
        <m.span
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={morph}
          className="inline-flex size-3.5 shrink-0 items-center justify-center"
          aria-hidden
        >
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />
        </m.span>
        <span className="truncate">
          {applying ? "Applying…" : `Apply ${count} change${count === 1 ? "" : "s"}`}
        </span>
      </button>
      {/* ml-auto pins the actions to the trailing end once the bar widens. */}
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto shrink-0"
        onClick={onDiscardAll}
        disabled={busy}
      >
        Discard
      </Button>
      <Button
        size="sm"
        variant="default"
        className="shrink-0"
        onClick={onApply}
        disabled={busy}
        aria-label={applying ? "Applying" : undefined}
      >
        {/* Header already reads "Applying…". The button is spinner-only. */}
        {applying ? <Spinner className="size-3.5" /> : "Apply"}
      </Button>
    </m.div>
  );
}

/** The expanded per-resource change list. Split out of PendingChangesBar to
 *  keep that function inside the length cap; purely presentational. */
function ChangeList({
  groups,
  morph,
  reduce,
  busy,
  discarding,
  onDiscardOne,
}: {
  groups: GroupedChange[];
  morph: Transition;
  reduce: boolean | null;
  busy: boolean;
  discarding: boolean;
  onDiscardOne: (group: GroupedChange) => void;
}) {
  return (
    <ul className="flex flex-col gap-3 p-3">
      {groups.map((g, i) => (
        <m.li
          key={`${g.resource}-${g.name}`}
          // Full transform string, not the `y` shorthand: the shorthands are
          // not hardware-accelerated and drop frames while the page is busy.
          initial={reduce ? false : { opacity: 0, transform: "translateY(6px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ ...morph, delay: reduce ? 0 : 0.03 + i * 0.04 }}
        >
          <ChangeGroupCard
            group={g}
            discarding={discarding}
            onDiscard={busy ? undefined : () => onDiscardOne(g)}
          />
        </m.li>
      ))}
    </ul>
  );
}

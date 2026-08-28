/**
 * Floating "N changes" pill. Sits below the top nav whenever the saved
 * manifest diverges from current resources.
 *
 * Reads from manifest.diff (the same diff CLI `status` uses), so the UI and
 * CLI agree on what "pending" means: a staged wizard create, a staged delete,
 * a CLI `sync --preview` saved without apply, or resources drifted
 * out-of-band.
 *
 * Click the count to expand into the staged-change list: one selectable row
 * per resource, expandable into the field-level diff. Apply reconciles the
 * TICKED rows and leaves the rest pending; Discard drops a change entirely.
 *
 * ── THE MORPH, AND WHY THERE IS NO LAYOUT PROJECTION HERE ──────────────────
 * Three attempts got this wrong before the shape below, and each failure came
 * from the same root: something other than the panel was deciding the panel's
 * height.
 *
 *   `layout` + `height: 0 → auto` — two competing layout animations.
 *   Projection measures a box whose height is itself mid-flight.
 *
 *   `layout` + `mode="popLayout"` — popLayout pulls the exiting body out of
 *   flow so the box can shrink, but the body is still inside
 *   `overflow-hidden` and gets clipped away mid-fade.
 *
 *   `layout` + a duplicated exit copy — closer, but projection still animates
 *   by SCALING the box and counter-scaling children, so the final settle
 *   shifted, and every row that opened re-measured the container and nudged
 *   its neighbours.
 *
 * The panel now owns its own height, via Base UI's Collapsible and the
 * `--collapsible-panel-height` it publishes. One element, one animation, no
 * measurement of a moving target, and nothing else on screen participates.
 * Rows do the same thing independently (pending-changes-rows.tsx), so opening
 * one leaves the others exactly where they were.
 *
 * ── THE WIDTH, AND THE REFLOW THAT WAS THE JUMP ────────────────────────────
 * Width morphs 360 → 640, and BOTH ENDPOINTS ARE LENGTHS. The collapsed pill
 * was once `w-max` (`width: max-content`), and CSS cannot interpolate an
 * intrinsic keyword to a length — the width did not animate at all while the
 * height did, so it snapped.
 *
 * The remaining jump was RELAYOUT, not easing. The panel content sized itself
 * to the container, so every frame of a 640 → 360 collapse re-ran the rows'
 * flex layout: summaries re-truncated, columns re-solved, text re-wrapped,
 * ~15 times over the close. That is not something a curve can smooth — the
 * content was genuinely being re-laid-out while it left.
 *
 * So the panel content is PINNED to the expanded width. It stays laid out
 * exactly as you last saw it and the shrinking container simply clips it —
 * one stable picture sliding behind a smaller window, instead of a live
 * relayout. Nothing inside the panel reflows during the morph.
 *
 * Width and height also share a duration per direction (260ms open, 240ms
 * close) so neither axis is still travelling after the other has landed; that
 * trailing 20ms was its own small settle at the end of the close.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { Collapsible, CollapsiblePanel } from "@/shared/components/ui/collapsible";
import { cn } from "@/shared/lib/utils";

import { type DiffChange, groupChanges } from "./pending-changes-diff";
import { PendingBarHeader } from "./pending-changes-header";
import { ChangeRow, changeKey } from "./pending-changes-rows";
import { usePendingChanges } from "./use-pending-changes";

interface PendingChangesBarProps {
  projectId: ProjectId;
  environment?: string;
}

export function PendingChangesBar({ projectId, environment }: PendingChangesBarProps) {
  const { diff, applyMut, discardMut } = usePendingChanges(projectId, environment);
  const [expanded, setExpanded] = useState(false);
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set());
  /** Rows the operator UNTICKED. Deferred, not discarded — tracking exclusions
   *  rather than inclusions means a change that appears while the panel is
   *  open is selected by default, which is the safe direction. */
  const [deferred, setDeferred] = useState<ReadonlySet<string>>(new Set());

  const busy = applyMut.isPending || discardMut.isPending;
  const meaningful = (diff.data?.changes ?? []).filter((c): c is DiffChange => c.kind !== "no-op");
  // The bar's lifetime is the MANIFEST's divergence, nothing else: apply()
  // keeps running while services build, so gating on isPending would hold the
  // bar hostage to the build long after the manifest itself was applied.
  if (meaningful.length === 0) return null;

  const groups = groupChanges(meaningful);
  const chosen = groups.filter((g) => !deferred.has(changeKey(g)));
  const partial = chosen.length !== groups.length;

  const flip = (set: ReadonlySet<string>, key: string): ReadonlySet<string> => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  return (
    // Own layer below the site header AND the project tab row, never on top of
    // either. px-3 so the pill can't overrun a phone's edges.
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3"
      style={{ top: "calc(var(--header-height) + 2.5rem + 0.75rem)" }}
    >
      <Collapsible
        open={expanded}
        onOpenChange={setExpanded}
        render={
          <div
            className={cn(
              "pointer-events-auto flex max-w-full flex-col overflow-hidden",
              "rounded-2xl border bg-card/95 shadow-lg",
              "transition-[width] ease-[cubic-bezier(0.32,0.72,0,1)]",
              "motion-reduce:transition-none",
              // Same duration as the panel's height keyframe, per direction.
              expanded
                ? "w-[min(640px,calc(100vw-2rem))] duration-[260ms]"
                : "w-[min(360px,calc(100vw-2rem))] duration-[240ms]",
            )}
          />
        }
      >
        <PendingBarHeader
          groups={groups}
          chosenCount={chosen.length}
          partial={partial}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          applying={applyMut.isPending}
          busy={busy}
          onDiscardAll={() => {
            discardMut.mutate(undefined);
            setExpanded(false);
          }}
          onApply={() => {
            applyMut.mutate(
              partial ? chosen.map((g) => ({ resource: g.resource, name: g.name })) : undefined,
            );
            setDeferred(new Set());
          }}
        />

        <CollapsiblePanel>
          {/* Pinned to the EXPANDED width, not the container's current one, so
              the closing morph clips a stable picture rather than re-running
              the rows' layout on every frame. */}
          <div className="w-[min(640px,calc(100vw-2rem))] border-t bg-muted/30">
            <ul className="max-h-[60vh] divide-y divide-border/40 overflow-auto py-0.5">
              {groups.map((g) => {
                const key = changeKey(g);
                return (
                  <ChangeRow
                    key={key}
                    group={g}
                    selected={!deferred.has(key)}
                    expanded={openRows.has(key)}
                    busy={busy}
                    discarding={discardMut.isPending}
                    onToggleSelected={() => setDeferred((p) => flip(p, key))}
                    onToggleExpanded={() => setOpenRows((p) => flip(p, key))}
                    onDiscard={
                      busy
                        ? undefined
                        : () => discardMut.mutate([{ resource: g.resource, name: g.name }])
                    }
                  />
                );
              })}
            </ul>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}

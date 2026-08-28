/**
 * The staged-change list: one row per resource, each selectable and each
 * expandable into the existing diff tables.
 *
 * Replaces a stack of always-open cards. Four staged changes used to be four
 * full cards — every field of every one on screen at once, including a raw
 * `services` JSON dump — so the panel was a scroll before it was a summary.
 * A row states what the change IS (`create · cal-com · 2 fields · 4 env`) and
 * holds the rest behind a disclosure: decide from the summary, open only what
 * you're unsure about.
 *
 * EACH ROW OWNS ITS HEIGHT. The detail used to mount instantly, which made the
 * whole panel re-measure and every other row visibly shift. A Collapsible
 * animates its own panel to its own measured height and moves nothing else, so
 * opening one row leaves its neighbours exactly where they were.
 *
 * The checkbox is an APPLY filter, not a delete. Unticking defers a change to
 * a later apply; the trash icon is what discards it. Those are different
 * outcomes and get different controls — a checkbox that quietly destroyed the
 * unticked rows is how someone loses work they only meant to postpone.
 */

import { ArrowRight01Icon, Delete01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/shared/components/ui/collapsible";
import { cn } from "@/shared/lib/utils";

import type { GroupedChange } from "./pending-changes-groups";

import { ChangeGroupBody } from "./pending-changes-diff";

const KIND_LABEL: Record<GroupedChange["kind"], string> = {
  create: "create",
  update: "update",
  delete: "delete",
};

const KIND_TINT: Record<GroupedChange["kind"], string> = {
  create: "text-success",
  update: "text-info",
  delete: "text-destructive",
};

/** Row key. A name is only unique within a resource kind. */
export function changeKey(g: GroupedChange): string {
  return `${g.resource}:${g.name}`;
}

/**
 * The one-line answer to "what is this change". Counts of the things that vary
 * between changes; everything else is a disclosure away.
 */
function summarise(g: GroupedChange): string {
  const bits: string[] = [];
  if (g.spec.length > 0) bits.push(`${g.spec.length} ${g.spec.length === 1 ? "field" : "fields"}`);
  if (g.fields.length > 0) {
    bits.push(`${g.fields.length} ${g.fields.length === 1 ? "change" : "changes"}`);
  }
  if (g.env.length > 0) bits.push(`${g.env.length} env`);
  if (g.reason !== undefined) bits.push(g.reason);
  return bits.join(" · ");
}

export function ChangeRow({
  group,
  selected,
  expanded,
  busy,
  discarding,
  onToggleSelected,
  onToggleExpanded,
  onDiscard,
}: {
  group: GroupedChange;
  selected: boolean;
  expanded: boolean;
  busy: boolean;
  discarding: boolean;
  onToggleSelected: () => void;
  onToggleExpanded: () => void;
  onDiscard?: () => void;
}) {
  const summary = summarise(group);
  return (
    <li className={cn("transition-opacity duration-200", !selected && "opacity-45")}>
      <Collapsible open={expanded} onOpenChange={onToggleExpanded}>
        <div className="flex items-center gap-2.5 px-3 py-1.5">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelected}
            disabled={busy}
            aria-label={`Include ${group.name} in this apply`}
          />
          <CollapsibleTrigger
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            render={<button type="button" />}
          >
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              strokeWidth={2}
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                "motion-reduce:transition-none",
                expanded && "rotate-90",
              )}
              aria-hidden
            />
            <span className={cn("shrink-0 text-[11px] font-medium", KIND_TINT[group.kind])}>
              {KIND_LABEL[group.kind]}
            </span>
            <span className="shrink-0 font-mono text-[12.5px] font-medium text-foreground">
              {group.name}
            </span>
            {summary && (
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
                {summary}
              </span>
            )}
          </CollapsibleTrigger>
          {onDiscard && (
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={onDiscard}
              disabled={discarding}
              className="shrink-0 text-muted-foreground hover:text-destructive"
              // "Discard", never a bare ✕: on a delete row the label already
              // says the resource will be deleted, and an unlabelled cross
              // there reads as "delete it now" rather than "drop this pending
              // change".
              title={`Discard this change to ${group.name}`}
              aria-label={`Discard this change to ${group.name}`}
            >
              <HugeiconsIcon icon={Delete01Icon} strokeWidth={2} />
            </Button>
          )}
        </div>
        <CollapsiblePanel>
          <div className="border-t bg-background/40 px-3 py-2">
            <ChangeGroupBody group={group} />
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </li>
  );
}

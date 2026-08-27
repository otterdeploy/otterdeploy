/**
 * The one header every resource panel renders.
 *
 * Before this there were three (compose, database, service), each with its own
 * copy of the same row, and two of them opened with a back arrow whose
 * `onClick` was the same `onClose` the ✕ eight lines below it called. Two
 * controls, one action — and neither of them could answer "where am I", which
 * is the question you actually have inside a stack.
 *
 * So the arrow's slot holds a breadcrumb now (see ./panel-breadcrumb), and the
 * status that used to live in a second full-width row below the header sits on
 * the meta line, next to the name it describes. That is ~45px of every resource
 * page returned to content, and it stops the stack name being printed twice.
 *
 * Everything panel-specific arrives as a prop: the icon tile, the meta text,
 * the action cluster. This component owns the ROW — its spacing, its
 * truncation behaviour, and the guarantee that ✕ is always in the same place.
 *
 * The expand control lives here too, next to ✕: both act on the WINDOW, and
 * keeping them together (behind a hairline) is what stops "make this bigger"
 * reading as another thing you can do to the resource.
 */

import type { ReactNode } from "react";

import { ArrowExpand02Icon, ArrowShrink02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

import type { PanelCrumb } from "./panel-breadcrumb";

import { PanelBreadcrumb } from "./panel-breadcrumb";
import { usePanelWidth } from "./panel-width";

export interface ResourcePanelHeaderProps {
  /** The 40px brand/kind tile. Panels build their own because the precedence
   *  rules (framework > engine > kind) are theirs, not the header's. */
  icon: ReactNode;
  name: string;
  /** Where this resource sits. Omitted only by the loading skeleton, which
   *  has no resource to place yet. */
  crumb?: PanelCrumb;
  /** Live state, rendered before the meta text. Null while it is genuinely
   *  unknown — a staged resource has no status, and inventing one is worse
   *  than the gap. */
  status?: ReactNode;
  /** Mono identity line: image ref, service count, engine + version. */
  meta?: ReactNode;
  /** Live extra pinned after the meta text (the database's connection chip).
   *  Outside the truncating span, because a number that matters must not be
   *  the first thing a long image ref clips away. */
  metaTrailing?: ReactNode;
  /** Panel-specific verbs (Redeploy, Restart, Build, Pause). Rendered left of
   *  the close button, which is always last. */
  actions?: ReactNode;
  onClose: () => void;
}

export function ResourcePanelHeader({
  icon,
  name,
  crumb,
  status,
  meta,
  metaTrailing,
  actions,
  onClose,
}: ResourcePanelHeaderProps) {
  const { t } = useTranslation();
  return (
    // A hairline and a faint lift, because the header is chrome and the pane
    // below it is content. Without the separation the title, the rail and the
    // first section heading all read as one column of text starting at the top
    // of the panel — the identity of the thing you opened blends into the body
    // of what you opened it to see.
    <div className="flex flex-col gap-2 border-b bg-muted/20 px-4 pt-3 pb-3.5 sm:px-6">
      {/* Chrome row: where you are, and what you can do to the WINDOW. It
          exists partly to use the band above the title, which was 24px of
          nothing above a 12px crumb — the panel opened with a gap and no
          reason for it. */}
      <div className="flex h-7 items-center justify-between gap-3">
        <div className="min-w-0">{crumb && <PanelBreadcrumb crumb={crumb} />}</div>
        <div className="flex shrink-0 items-center gap-0.5">
          <PanelWidthToggle />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("resources.closePanel")}
            onClick={onClose}
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
          </Button>
        </div>
      </div>

      {/* Identity row: what this IS, and what you can do to the THING. The
          tile is centred against the two-line block rather than pinned to the
          top of a three-line one, which is what left it looking dropped in. */}
      <div className="flex items-center justify-between gap-3 sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {icon}
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-lg leading-none font-semibold tracking-tight sm:text-xl">
              {name}
            </span>
            {(status || meta || metaTrailing) && (
              <div className="flex min-w-0 items-center gap-2 leading-none">
                {status}
                {meta && (
                  <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                    {meta}
                  </span>
                )}
                {metaTrailing && <span className="shrink-0">{metaTrailing}</span>}
              </div>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1 sm:gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * Expand / collapse the drawer.
 *
 * Grouped with ✕ and separated from the panel's own verbs by a hairline: one
 * cluster acts on the THING (redeploy, restart), one on the WINDOW. That is
 * where every app the operator already uses puts it.
 *
 * Renders nothing when the panel isn't in a resizable container, so a panel in
 * a test or a preview doesn't grow a control that can't do anything.
 */
function PanelWidthToggle() {
  const width = usePanelWidth();
  if (!width) return null;
  return (
    <>
      <span aria-hidden className="mx-0.5 hidden h-4 w-px bg-border sm:block" />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={width.expanded ? "Collapse panel" : "Expand panel"}
        aria-pressed={width.expanded}
        onClick={width.toggle}
        className="text-muted-foreground"
      >
        <HugeiconsIcon
          icon={width.expanded ? ArrowShrink02Icon : ArrowExpand02Icon}
          strokeWidth={2}
          className="size-4"
        />
      </Button>
    </>
  );
}

export type PanelStatusTone = "running" | "building" | "error" | "paused" | "pending";

const TONE_CLASS: Record<PanelStatusTone, string> = {
  running: "text-success",
  building: "text-warning",
  error: "text-destructive",
  paused: "text-muted-foreground",
  pending: "text-info",
};

const DOT_CLASS: Record<PanelStatusTone, string> = {
  running: "bg-success",
  building: "bg-warning",
  error: "bg-destructive",
  paused: "bg-muted-foreground/60",
  pending: "bg-info",
};

/**
 * Status as a dot and a word.
 *
 * It used to be an uppercase chip with a tinted background — the loudest thing
 * in the header, for the one fact least likely to have changed since you
 * opened it. A dot and a word is the SAME pattern the service rows, the graph
 * nodes and the rail's children already use, so one vocabulary now has one
 * look wherever it appears.
 */
export function PanelStatusPill({
  tone,
  label,
  className,
}: {
  tone: PanelStatusTone;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs leading-none whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT_CLASS[tone])} />
      {label}
    </span>
  );
}

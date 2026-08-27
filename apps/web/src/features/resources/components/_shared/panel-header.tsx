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
 */

import type { ReactNode } from "react";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

import type { PanelCrumb } from "./panel-breadcrumb";

import { PanelBreadcrumb } from "./panel-breadcrumb";

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
    <div className="flex items-start justify-between gap-2 px-4 pt-4 sm:gap-4 sm:px-6 sm:pt-6">
      {/* min-w-0 so the name and meta line truncate instead of forcing this
          row wider than the panel and pushing ✕ off-screen. */}
      <div className="flex min-w-0 items-start gap-2 sm:gap-3">
        {icon}
        <div className="flex min-w-0 flex-col gap-0.5">
          {crumb && <PanelBreadcrumb crumb={crumb} />}
          <span className="truncate text-lg leading-tight font-bold tracking-tight sm:text-xl sm:leading-none">
            {name}
          </span>
          {(status || meta || metaTrailing) && (
            <div className="flex min-w-0 items-center gap-2">
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
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {actions}
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
  );
}

export type PanelStatusTone = "running" | "building" | "error" | "paused" | "pending";

const TONE_CLASS: Record<PanelStatusTone, string> = {
  running: "bg-success/12 text-success",
  building: "bg-warning/12 text-warning",
  error: "bg-destructive/12 text-destructive",
  paused: "bg-muted text-muted-foreground",
  pending: "bg-info/12 text-info",
};

/**
 * The status chip that folded up out of the old status bar. Same vocabulary
 * the graph nodes use (running / building / error / paused / pending), so a
 * node and its panel can never disagree about what a resource is doing.
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
        "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.14em] uppercase",
        TONE_CLASS[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

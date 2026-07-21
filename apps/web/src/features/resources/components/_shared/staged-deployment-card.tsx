/**
 * The active-deployment card for the resource Deployments tab — the mockup's
 * expandable staged card: a trigger header (status + what triggered it + when +
 * View logs + actions) over the phase timeline (Initialization / Build / Deploy
 * / Post-deploy). Replaces the flat ActiveDeploymentCard so the phases the
 * detail page used to hide behind a click now live inline where you land.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";
import type { ResourceNodeData } from "@/features/projects/components/graph/resource-node";
import { useState } from "react";

import { ArrowDown01Icon, GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { cn } from "@/shared/lib/utils";

import { PanelIcon } from "./atoms";
import { DeploymentTimelineView } from "./deployment-timeline-view";
import { type DeploymentInfo, DeploymentStatusBadge } from "./deployment-cards";
import { HistoryRowMenu } from "./history-row-menu";

/** What kicked off this deployment, in plain words. */
const TRIGGER_LABEL: Record<DeploymentInfo["reason"], string> = {
  create: "Initial deploy",
  redeploy: "Redeploy",
  "env-change": "Variable change",
  "image-change": "Image update",
  restart: "Restart",
  "git-push": "Git push",
  rollback: "Rollback",
};

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "2 minutes ago" from an ISO timestamp; falls back to "just now". */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  for (const [unit, ms] of UNITS) {
    if (diff >= ms) return RELATIVE.format(-Math.floor(diff / ms), unit);
  }
  return "just now";
}

/** The card's leading mark: the pushing GitHub user's avatar with a small git
 *  source badge for a git-push deploy; otherwise the service's own logo. */
function DeploymentMark({
  deployment,
  logoNode,
}: {
  deployment: DeploymentInfo;
  logoNode?: ResourceNodeData;
}) {
  if (deployment.gitCommitAuthorAvatar) {
    return (
      <span className="relative shrink-0">
        <img
          src={deployment.gitCommitAuthorAvatar}
          alt={deployment.gitCommitAuthor ?? "commit author"}
          className="size-7 rounded-full bg-muted object-cover ring-1 ring-border"
          loading="lazy"
        />
        <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full border-2 border-card bg-muted">
          <HugeiconsIcon
            icon={GitBranchIcon}
            strokeWidth={2.5}
            className="size-2.5 text-muted-foreground"
          />
        </span>
      </span>
    );
  }
  return logoNode ? <PanelIcon node={logoNode} size="sm" /> : null;
}

export function StagedDeploymentCard({
  deployment,
  logoNode,
  orgSlug,
  projectSlug,
  projectId,
  resourceId,
  canRollback,
}: {
  deployment: DeploymentInfo;
  /** The resource's node data (framework/engine/logoBrand) so the card shows
   *  the real service logo, same as the panel header — not a generic glyph. */
  logoNode?: ResourceNodeData;
  orgSlug: string;
  projectSlug: ProjectSlug;
  projectId: string;
  resourceId: string;
  canRollback: boolean;
}) {
  const [open, setOpen] = useState(true);
  const link = { orgSlug, projectSlug, resourceId, deploymentId: deployment.id };
  const failed = deployment.status === "failed" || deployment.status === "crashed";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        deployment.status === "running"
          ? "border-success/30"
          : failed
            ? "border-destructive/30"
            : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={open}
        >
          <DeploymentStatusBadge status={deployment.status} />
          <DeploymentMark deployment={deployment} logoNode={logoNode} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13.5px] font-medium text-foreground">
              {TRIGGER_LABEL[deployment.reason]}
            </span>
            <span className="truncate text-[11.5px] text-muted-foreground">
              {relativeTime(deployment.createdAt)}
              {deployment.gitCommitAuthor ? ` · by ${deployment.gitCommitAuthor}` : ""}
            </span>
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
          />
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <Link
            to="/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId"
            params={{ orgSlug, projectSlug, resourceId, deploymentId: deployment.id }}
            search={{ tab: failed ? "build-logs" : "details" }}
            className="rounded-md border border-border/60 px-2.5 py-1 text-[12px] text-foreground/80 transition-colors hover:bg-muted/50"
          >
            View logs
          </Link>
          <HistoryRowMenu
            deployment={deployment}
            orgSlug={orgSlug}
            projectSlug={projectSlug}
            projectId={projectId}
            resourceId={resourceId}
            canRollback={canRollback}
          />
        </div>
      </div>
      {open && (
        <div className="border-t border-border/60">
          <DeploymentTimelineView deployment={deployment} link={link} />
        </div>
      )}
    </div>
  );
}

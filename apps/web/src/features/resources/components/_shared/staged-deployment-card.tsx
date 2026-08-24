/**
 * The active-deployment card for the resource Deployments tab: the mockup's
 * expandable staged card: a trigger header (status + what triggered it + when +
 * View logs + actions) over the phase timeline (Initialization / Build / Deploy
 * / Post-deploy). Replaces the flat ActiveDeploymentCard so the phases the
 * detail page used to hide behind a click now live inline where you land.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";

import type React from "react";
import { useState } from "react";

import { ArrowDown01Icon, GitBranchIcon, GitCommitIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import type { ResourceNodeData } from "@/features/projects/components/graph/resource-node";

import { logTabForStatus } from "@/features/resources/lib/deployment-log-tab";
import { timeAgo } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";

import { PanelIcon } from "./atoms";
import { type DeploymentInfo, DeploymentStatusBadge } from "./deployment-cards";
import { DeploymentTimelineView } from "./deployment-timeline-view";
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

/** Subject line of a commit message. The body belongs on the detail page. The
 *  card gets one line, so a multi-paragraph message must not wreck the layout. */
function commitSubject(message: string | null): string | null {
  return message?.split("\n", 1)[0]?.trim() || null;
}

/** Fallback mark for a commit whose email maps to no GitHub account (no avatar
 *  to fetch), so an authored deploy still reads as a person. */
function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("");
  return letters.toUpperCase() || "?";
}

/** Git badge worn by every person-shaped mark: says the face came from a
 *  commit rather than from an otterdeploy account. */
function GitBadge() {
  return (
    <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full border-2 border-card bg-muted">
      <HugeiconsIcon
        icon={GitBranchIcon}
        strokeWidth={2.5}
        className="size-2.5 text-muted-foreground"
      />
    </span>
  );
}

/**
 * The card's leading mark. A deployment built from a repo is the work of a
 * person, so it leads with the commit author's face (avatar → initials);
 * anything else with a commit gets the commit glyph. The resource's own
 * framework/engine logo is the last resort only. It's already on the panel
 * header and the graph node, and it says nothing about THIS deployment.
 */
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
        <GitBadge />
      </span>
    );
  }
  if (deployment.gitCommitAuthor) {
    return (
      <span className="relative shrink-0" title={deployment.gitCommitAuthor}>
        <span className="grid size-7 place-items-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground ring-1 ring-border">
          {initials(deployment.gitCommitAuthor)}
        </span>
        <GitBadge />
      </span>
    );
  }
  if (deployment.gitSha) {
    return (
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted ring-1 ring-border">
        <HugeiconsIcon
          icon={GitCommitIcon}
          strokeWidth={2}
          className="size-3.5 text-muted-foreground"
        />
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
  /** The resource's node data (framework/engine/logoBrand). Only used as the
   *  mark of last resort: a deployment with a commit behind it leads with its
   *  author instead. See [[DeploymentMark]]. */
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

  // The commit subject is the headline when there is one. "what changed" beats
  // "how it was triggered", which demotes to the line below next to the commit
  // it names. With no commit (image pulls, databases) the trigger keeps the
  // headline and this line is just the timestamp, as before.
  const subject = commitSubject(deployment.gitCommitMessage);
  const meta: Array<{ key: string; node: React.ReactNode }> = [];
  if (subject) meta.push({ key: "reason", node: TRIGGER_LABEL[deployment.reason] });
  if (deployment.gitSha) {
    meta.push({
      key: "sha",
      node: (
        <span className="font-mono" title={deployment.gitSha}>
          {deployment.gitSha.slice(0, 7)}
        </span>
      ),
    });
  }
  meta.push({ key: "when", node: timeAgo(deployment.createdAt) });
  if (deployment.gitCommitAuthor) meta.push({ key: "who", node: deployment.gitCommitAuthor });

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
            <span
              className="truncate text-[13.5px] font-medium text-foreground"
              title={subject ?? undefined}
            >
              {subject ?? TRIGGER_LABEL[deployment.reason]}
            </span>
            <span className="truncate text-[11.5px] text-muted-foreground">
              {meta.map((part, i) => (
                <span key={part.key}>
                  {i > 0 && " · "}
                  {part.node}
                </span>
              ))}
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
            search={(prev) => ({
              ...prev,
              deploymentTab: logTabForStatus(deployment.status),
            })}
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

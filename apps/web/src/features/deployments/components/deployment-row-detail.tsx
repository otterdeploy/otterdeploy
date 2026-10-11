/**
 * A row, expanded in place: the deployment pipeline the service panel draws
 * (the shared `DeploymentTimelineView`, so the two can never tell a deploy's
 * story differently), the facts about it, and what you can do with it.
 */

import type { ReactNode } from "react";

import { Copy01Icon, File01Icon, RefreshIcon, RotateLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { deployStatusGroup } from "@otterdeploy/shared/deploy-status";

import { DeploymentTimelineView } from "@/features/resources/components/_shared/deployment-timeline-view";
import { Button } from "@/shared/components/ui/button";
import { CLOCK_EXACT, clockFormatter } from "@/shared/lib/clock";
import { formatDuration } from "@/shared/lib/duration";
import { timeAgo } from "@/shared/lib/time";

import type { RowActions } from "./deployment-row-menu";

import { isRollbackEligible, type ProjectDeployment } from "../data/deployments-search";
import { canRedeploy, copyLabel } from "../model/deployment-actions";
import { byLine, failedDuring } from "../model/deployments-view";
import { ActorAvatar } from "./actor-avatar";

const exact = clockFormatter(CLOCK_EXACT);

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2 overflow-hidden">{children}</dd>
    </>
  );
}

function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="truncate font-mono text-[12px]" title={title}>
      {children}
    </span>
  );
}

const HOW: Record<ProjectDeployment["reason"], string> = {
  create: "first deploy",
  redeploy: "redeploy",
  "env-change": "variables change",
  "image-change": "image change",
  restart: "restart",
  "git-push": "git push",
  rollback: "rollback",
};

function Facts({ d, now }: { d: ProjectDeployment; now: number }) {
  const { actor } = byLine(d);
  const inFlight = deployStatusGroup(d.status) === "in-progress";
  const span = d.completedAt
    ? Date.parse(d.completedAt) - Date.parse(d.createdAt)
    : inFlight
      ? now - Date.parse(d.createdAt)
      : null;
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-5 gap-y-1.5 text-[12.5px]">
      <Fact label="Triggered by">
        <ActorAvatar actor={actor} className="size-5" />
        <span className="truncate">
          {actor.kind === "person" ? actor.name : "Automatic"}
          <span className="text-muted-foreground"> · {HOW[d.reason]}</span>
        </span>
      </Fact>
      {d.gitSha ? (
        <Fact label="Commit">
          <Mono title={d.gitSha}>{d.gitSha.slice(0, 12)}</Mono>
          {d.gitCommitAuthor ? (
            <span className="truncate text-muted-foreground">by {d.gitCommitAuthor}</span>
          ) : null}
        </Fact>
      ) : null}
      {d.sourceSha ? (
        <Fact label="Source">
          <Mono title={d.sourceSha}>{d.sourceSha.slice(0, 12)}</Mono>
          <span className="text-muted-foreground">uploaded</span>
        </Fact>
      ) : null}
      <Fact label="Image">
        <Mono title={d.image}>{d.image.startsWith("pending:") ? "not built" : d.image}</Mono>
      </Fact>
      <Fact label="Where">
        <Mono>{d.resourceName}</Mono>
        <span className="truncate text-muted-foreground">in {d.environmentName}</span>
      </Fact>
      <Fact label="Started">
        <span className="font-mono text-[12px] tabular-nums">{exact(Date.parse(d.createdAt))}</span>
        <span className="text-muted-foreground">{timeAgo(d.createdAt)}</span>
      </Fact>
      {d.isServing && d.completedAt ? (
        <Fact label={d.status === "running" ? "Live since" : "Current since"}>
          <span className="font-mono text-[12px] tabular-nums">
            {exact(Date.parse(d.completedAt))}
          </span>
        </Fact>
      ) : null}
      <Fact label={inFlight ? "Elapsed" : "Took"}>
        <span className="font-mono text-[12px] tabular-nums">
          {span === null ? "–" : formatDuration(span)}
        </span>
      </Fact>
      <Fact label="Deployment">
        <Mono>{d.id}</Mono>
      </Fact>
    </dl>
  );
}

export function DeploymentRowDetail({
  d,
  now,
  actions,
}: {
  d: ProjectDeployment;
  now: number;
  actions: RowActions;
}) {
  const redeploy = canRedeploy(d);
  const failed = deployStatusGroup(d.status) === "failed";
  const logSource = failed && failedDuring(d) === "build" ? "build" : "deploy";
  return (
    <div className="grid gap-5 px-3.5 pt-1 pb-5 @4xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)] @4xl:pr-4 @4xl:pl-[182px]">
      <div className="overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
        <DeploymentTimelineView
          deployment={{
            status: d.status,
            errorMessage: d.errorMessage,
            // The project list carries no task rollup; where a failure stopped
            // is read from the build's image instead (see `failedDuring`).
            taskCount: 0,
            runningTaskCount: 0,
            completedAt: d.completedAt,
            createdAt: d.createdAt,
            failedPhase: failed ? failedDuring(d) : undefined,
          }}
          onOpenLogs={() => actions.onViewLogs(d)}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Facts d={d} now={now} />
        <div className="flex flex-wrap gap-2">
          {redeploy ? (
            <Button type="button" variant="outline" size="sm" onClick={() => actions.onRedeploy(d)}>
              <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
              {redeploy}
            </Button>
          ) : null}
          {isRollbackEligible(d) ? (
            <Button type="button" variant="outline" size="sm" onClick={() => actions.onRollback(d)}>
              <HugeiconsIcon icon={RotateLeft01Icon} strokeWidth={2} />
              Roll back to this
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => actions.onViewLogs(d)}>
            <HugeiconsIcon icon={File01Icon} strokeWidth={2} />
            {logSource === "build" ? "View build log" : "View logs"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => actions.onCopy(d)}>
            <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
            {copyLabel(d)}
          </Button>
        </div>
      </div>
    </div>
  );
}

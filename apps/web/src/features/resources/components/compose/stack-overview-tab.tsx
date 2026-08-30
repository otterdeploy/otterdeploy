/**
 * Overview tab for a compose stack: the rollup and why, every member with its
 * own state (each row opens that member: the strip's list, with room for the
 * reason), the latest stack deployment with its phases, and the members' log
 * tail. Replaces the Services tab, whose rows were plain divs you could look
 * at but not open.
 */

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";

import type { PanelFocus } from "@/features/resources/components/_shared/panel-tab";
import type { ResourceState } from "@/features/resources/lib/resource-state";

import { LogTail, SectionHeading, StateBanner } from "@/features/resources/components/_shared/overview-atoms";
import { StagedDeploymentCard } from "@/features/resources/components/_shared/staged-deployment-card";
import { deploymentsCollection } from "@/features/resources/data/deployments";
import { TONE_DOT, TONE_TEXT } from "@/features/resources/lib/resource-state";
import { shortImageRef } from "@/shared/lib/image-ref";
import { cn } from "@/shared/lib/utils";

import type { StackMember } from "../_shared/use-stack-members";

function MemberRow({ member, onOpen }: { member: StackMember; onOpen: (resourceId: string) => void }) {
  const id = member.resourceId;
  const body = (
    <>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[member.state.tone])} />
      <span className="w-28 shrink-0 truncate text-[13px] font-medium" title={member.name}>
        {member.name}
      </span>
      <span className={cn("shrink-0 text-[12px]", TONE_TEXT[member.state.tone])}>
        {member.state.label}
      </span>
      {member.state.why && (
        <span className="min-w-0 truncate text-[12px] text-muted-foreground" title={member.state.why}>
          {member.state.why}
        </span>
      )}
      <span
        className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground/80"
        title={member.image ?? undefined}
      >
        {member.image ? shortImageRef(member.image) : member.hasBuild ? "built from source" : ""}
      </span>
      {id && (
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className="size-3.5 shrink-0 text-muted-foreground/50"
        />
      )}
    </>
  );
  if (!id) {
    return <div className="flex items-center gap-2.5 px-3 py-2 opacity-80">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/30"
    >
      {body}
    </button>
  );
}

export function StackOverviewTab({
  state,
  members,
  pending,
  projectId,
  resourceId,
  focus,
  onOpenMember,
  onGoTab,
}: {
  state: ResourceState | null;
  members: StackMember[];
  pending: boolean;
  projectId: string;
  resourceId: string;
  focus: PanelFocus;
  onOpenMember: (resourceId: string) => void;
  onGoTab: (tab: "deployments" | "logs") => void;
}) {
  const { data: deployments } = useLiveQuery(
    (q) =>
      q
        .from({ d: deploymentsCollection })
        .where(({ d }) => and(eq(d.projectId, projectId), eq(d.resourceId, resourceId)))
        .orderBy(({ d }) => d.createdAt, "desc")
        .limit(2),
    [projectId, resourceId],
  );
  const latest = pending ? null : (deployments.at(0) ?? null);
  const memberIds = members.flatMap((m) => (m.resourceId ? [m.resourceId] : []));

  return (
    <div className="flex flex-col gap-5">
      <StateBanner
        state={state}
        action={
          state?.tone === "error" ? { label: "See logs", onClick: () => onGoTab("logs") } : null
        }
      />

      <div>
        <SectionHeading>Services</SectionHeading>
        {members.length === 0 ? (
          <p className="mt-2 rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-[12px] text-muted-foreground">
            No services parsed yet.
          </p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-md border bg-card">
            <div className="divide-y divide-border/40">
              {members.map((m) => (
                <MemberRow key={m.serviceName} member={m} onOpen={onOpenMember} />
              ))}
            </div>
          </div>
        )}
      </div>

      {!pending && (
        <div>
          <SectionHeading>Latest stack deployment</SectionHeading>
          {latest ? (
            <div className="mt-2">
              <StagedDeploymentCard
                deployment={latest}
                projectId={projectId}
                resourceId={resourceId}
                canRollback={false}
                focus={focus}
              />
              {deployments.length > 1 && (
                <button
                  type="button"
                  onClick={() => onGoTab("deployments")}
                  className="mt-2 text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
                >
                  Earlier deployments →
                </button>
              )}
            </div>
          ) : (
            <p className="mt-2 rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-[12px] text-muted-foreground">
              Nothing has been deployed yet.
            </p>
          )}
        </div>
      )}

      {!pending && memberIds.length > 0 && (
        <LogTail projectId={projectId} resourceIds={memberIds} onOpenLogs={() => onGoTab("logs")} />
      )}
    </div>
  );
}

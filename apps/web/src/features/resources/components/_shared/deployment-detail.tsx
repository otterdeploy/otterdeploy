import type { ServiceTaskInfo } from "@otterdeploy/api/routers/project/service-tasks";
import type { Builder } from "@otterdeploy/shared/build-config";

import type { ReactNode } from "react";

import {
  CloudServerIcon,
  GitBranchIcon,
  PackageIcon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";

import type { ProjectResource } from "@/features/projects/components/graph/resource-to-node";
import type {
  DeploymentRow,
  Tone,
} from "@/features/resources/components/_shared/deployment-timeline-model";

import { buildTimeline } from "@/features/resources/components/_shared/deployment-timeline-model";
import { DeploymentTimelineView } from "@/features/resources/components/_shared/deployment-timeline-view";
import { deploymentTasksCollection } from "@/features/resources/data/deployments";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";

export type { DeploymentRow };

export function DeploymentDetailsBody({
  deployment,
  resource,
  projectId,
  resourceId,
  deploymentId,
  previewUrl,
}: {
  deployment: DeploymentRow | null;
  resource: ProjectResource | undefined;
  projectId: string;
  resourceId: string;
  deploymentId: string;
  /** Set when this deployment belongs to a PR preview. The preview serves its
   *  own host, so the base resource's domain is the wrong answer here. */
  previewUrl?: string | null;
}) {
  if (!deployment) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Spinner className="size-3.5" />
        Loading deployment…
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <DeploymentTimeline deployment={deployment} />
      <SourceBlock deployment={deployment} resource={resource} />
      <ConfigurationSection deployment={deployment} resource={resource} previewUrl={previewUrl} />
      {deployment.taskCount > 0 && (
        <DeploymentTasksList
          projectId={projectId}
          resourceId={resourceId}
          deploymentId={deploymentId}
        />
      )}
    </div>
  );
}

// ─── Timeline (the deployment "story") ───────────────────────────────────────

const TONE_STYLE: Record<Tone, { border: string; head: string; text: string }> = {
  success: { border: "border-success/25", head: "bg-success/[0.06]", text: "text-success" },
  failed: {
    border: "border-destructive/30",
    head: "bg-destructive/[0.07]",
    text: "text-destructive",
  },
  active: { border: "border-warning/30", head: "bg-warning/[0.06]", text: "text-warning" },
  neutral: { border: "border-border", head: "bg-muted/40", text: "text-foreground/90" },
  // Live, but not every replica is up, warning, not success and not error.
  degraded: { border: "border-warning/30", head: "bg-warning/[0.06]", text: "text-warning" },
};

/**
 * The phase stepper. The rows themselves are the SHARED view
 * (deployment-timeline-view), so the panel's inline deployments and this
 * overlay cannot drift into two different renderings of one deploy; this only
 * adds the tone-coloured card around them. No `onOpenLogs`: the overlay
 * carries its own Build/Deploy log tabs, so the rows state the failure
 * without a link that would go nowhere.
 */
function DeploymentTimeline({ deployment }: { deployment: DeploymentRow }) {
  const { tone } = buildTimeline(deployment);
  return (
    <div className={cn("overflow-hidden rounded-lg border", TONE_STYLE[tone].border)}>
      <DeploymentTimelineView deployment={deployment} />
    </div>
  );
}

function branchOf(ref: string | null): string | null {
  if (!ref) return null;
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

/**
 * What was deployed, in the terms a person thinks in: the commit subject, and
 * who wrote it.
 *
 * "Git deployment · refs/heads/artzkaizen-patch-1 · 277764a" named nothing,
 * not the change, not the author. The subject is the headline; the author gets
 * a face; the branch loses its `refs/heads/` noise and the sha stays as the
 * precise-but-secondary detail it is.
 */
function GitProvenance({ deployment }: { deployment: DeploymentRow }) {
  const branch = branchOf(deployment.gitRef);
  const sha = deployment.gitSha;
  const subject = deployment.gitCommitMessage?.split("\n")[0]?.trim();

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2">
        {deployment.gitCommitAuthorAvatar ? (
          <img
            src={deployment.gitCommitAuthorAvatar}
            alt=""
            loading="lazy"
            className="size-4 shrink-0 rounded-full ring-1 ring-border"
          />
        ) : null}
        <span
          className="min-w-0 truncate text-[13px] text-foreground/90"
          title={deployment.gitCommitMessage ?? undefined}
        >
          {/* Subject only: a commit body would swamp the row. */}
          {subject || "Git deployment"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11.5px] text-muted-foreground">
        {deployment.gitCommitAuthor ? (
          <>
            <span className="text-foreground/70">{deployment.gitCommitAuthor}</span>
            <span className="text-muted-foreground/40">·</span>
          </>
        ) : null}
        {branch ? <span>{branch}</span> : null}
        {sha ? (
          <>
            {branch ? <span className="text-muted-foreground/40">·</span> : null}
            <span title={sha}>{sha.slice(0, 7)}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SourceBlock({
  deployment,
  resource,
}: {
  deployment: DeploymentRow;
  resource: ProjectResource | undefined;
}) {
  const isGit =
    deployment.gitSha != null ||
    deployment.gitRef != null ||
    (resource?.type === "service" && resource.source === "git");

  return (
    <section className="flex flex-col gap-2.5">
      <SectionLabel>Deployed from</SectionLabel>
      <div className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3">
        <HugeiconsIcon
          icon={isGit ? GitBranchIcon : PackageIcon}
          strokeWidth={2}
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        {isGit ? (
          <GitProvenance deployment={deployment} />
        ) : deployment.sourceSha ? (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-mono text-[12.5px] text-foreground/90">
              {deployment.sourceSha.slice(0, 12)}
            </span>
            <span className="text-[11.5px] text-muted-foreground">Uploaded source</span>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-mono text-[12.5px] text-foreground/90">
              {deployment.image}
            </span>
            <span className="text-[11.5px] text-muted-foreground">Container image</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Configuration (Build · Deploy) ──────────────────────────────────────────

const BUILDER_LABEL: Record<Builder, string> = {
  auto: "Auto-detect",
  dockerfile: "Dockerfile",
  railpack: "Railpack",
  compose: "Compose",
};

function readBuilder(resource: ProjectResource | undefined): string | null {
  if (resource?.type !== "service") return null;
  const builder = resource.buildConfig?.builder;
  return builder ? BUILDER_LABEL[builder] : null;
}

function ConfigurationSection({
  deployment,
  resource,
  previewUrl,
}: {
  deployment: DeploymentRow;
  resource: ProjectResource | undefined;
  previewUrl?: string | null;
}) {
  if (!resource) return null;

  const build: ConfigItem[] = [];
  const deploy: ConfigItem[] = [];

  if (resource.type === "service") {
    const builder = readBuilder(resource);
    if (builder) build.push({ label: "Builder", value: builder });
    build.push({ label: "Root directory", value: resource.sourceSubdir?.trim() || "/" });
    if (resource.framework) build.push({ label: "Framework", value: resource.framework });

    deploy.push({ label: "Replicas", value: String(resource.replicas) });
    // A preview deployment is not reachable at the base service's domain, so
    // reporting that one here describes production while you are reading a pull
    // request's build.
    const domain = previewUrl?.replace(/^https?:\/\//, "") ?? resource.publicDomain;
    if ((resource.publicEnabled || previewUrl) && domain) {
      deploy.push({ label: "Domain", value: domain });
    }
  } else if (resource.type === "database") {
    build.push({ label: "Engine", value: resource.engine });
    deploy.push({ label: "Replicas", value: "1" });
    deploy.push({ label: "Host", value: resource.internalHostname });
  } else {
    build.push({ label: "Source", value: resource.source });
    deploy.push({
      label: "Services",
      value: String(resource.services.length),
    });
  }
  deploy.push({ label: "Trigger", value: deployment.reason });

  return (
    <section className="flex flex-col gap-2.5">
      <SectionLabel>Configuration</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <ConfigCard icon={SourceCodeIcon} title="Build" items={build} />
        <ConfigCard icon={CloudServerIcon} title="Deploy" items={deploy} />
      </div>
    </section>
  );
}

interface ConfigItem {
  label: string;
  value: string;
}

function ConfigCard({
  icon,
  title,
  items,
}: {
  icon: typeof SourceCodeIcon;
  title: string;
  items: ConfigItem[];
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3.5">
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5 text-muted-foreground" />
        <span className="text-[12.5px] font-medium text-foreground/90">{title}</span>
      </div>
      {items.length === 0 ? (
        <span className="text-[12px] text-muted-foreground/70">No configuration.</span>
      ) : (
        <dl className="flex flex-col gap-2">
          {items.map((item) => (
            <div key={item.label} className="flex flex-col gap-0.5">
              <dt className="text-[10.5px] tracking-[0.14em] text-muted-foreground/70 uppercase">
                {item.label}
              </dt>
              <dd className="truncate font-mono text-[12.5px] text-foreground/85">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[10.5px] tracking-[0.16em] text-muted-foreground/70 uppercase">
      {children}
    </div>
  );
}

// ─── Tasks (containers under this deployment) ────────────────────────────────

function DeploymentTasksList({
  projectId,
  resourceId,
  deploymentId,
}: {
  projectId: string;
  resourceId: string;
  deploymentId: string;
}) {
  const { data: tasks, status } = useLiveQuery(
    (q) =>
      q
        .from({ d: deploymentTasksCollection })
        .where(({ d }) =>
          and(
            eq(d.projectId, projectId),
            eq(d.resourceId, resourceId),
            eq(d.deploymentId, deploymentId),
          ),
        ),
    [projectId, resourceId, deploymentId],
  );
  const isLoading = status === "loading" && tasks.length === 0;

  return (
    <section className="flex flex-col gap-2.5">
      <SectionLabel>Containers</SectionLabel>
      {isLoading ? (
        <div className="flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground">
          <Spinner className="size-3" />
          Loading tasks…
        </div>
      ) : tasks.length === 0 ? (
        <div className="font-mono text-[11.5px] text-muted-foreground">No tasks scheduled yet.</div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="divide-y divide-border/40">
            {tasks.map((t) => (
              <DeploymentTaskRow key={t.id} task={t} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function DeploymentTaskRow({ task }: { task: ServiceTaskInfo }) {
  return (
    <div className="grid grid-cols-[100px_80px_140px_1fr_140px] items-center gap-3 px-3 py-2.5 font-mono text-[11.5px]">
      <TaskStateBadge state={task.state} />
      <span className="text-muted-foreground">{task.slot != null ? `slot.${task.slot}` : "–"}</span>
      <span className="text-foreground/75">
        {task.containerId ? task.containerId.slice(0, 12) : "–"}
      </span>
      <span className="truncate text-foreground/80">
        {task.error ?? task.message ?? task.rawState ?? "no message"}
        {typeof task.exitCode === "number" && task.exitCode !== 0 ? (
          <span className="ml-2 text-destructive">exit {task.exitCode}</span>
        ) : null}
      </span>
      <span className="text-right text-muted-foreground">
        {task.timestamp ? new Date(task.timestamp).toLocaleString() : "–"}
      </span>
    </div>
  );
}

function TaskStateBadge({ state }: { state: ServiceTaskInfo["state"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase",
        {
          "border-success/30 bg-success/15 text-success": state === "running",
          "border-warning/30 bg-warning/15 text-warning": state === "building",
          "border-destructive/30 bg-destructive/15 text-destructive": state === "error",
        },
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", {
          "bg-success": state === "running",
          "bg-warning": state === "building",
          "bg-destructive": state === "error",
        })}
      />
      {state}
    </span>
  );
}

/** Status shown as a bare colored dot (no text): the deployment header already
 *  spells out the deployment id + timestamp, so the status only needs a glanceable
 *  color. In-flight states pulse. The label stays available to assistive tech and
 *  on hover via aria-label/title. */
export function DeploymentStatusDot({ status }: { status: DeploymentRow["status"] }) {
  const inFlight = status === "building" || status === "pending" || status === "starting";
  return (
    <span
      role="status"
      aria-label={status}
      title={status}
      className={cn(
        "size-2 shrink-0 rounded-full bg-muted-foreground/40",
        status === "running" && "bg-success",
        (status === "failed" || status === "crashed") && "bg-destructive",
        inFlight && "animate-pulse bg-warning",
      )}
    />
  );
}

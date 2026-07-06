import type { ReactNode } from "react";

import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CloudServerIcon,
  GitBranchIcon,
  PackageIcon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";

import type { ProjectResource } from "@/features/projects/components/graph/resource-to-node";
import type { ServiceTaskInfo } from "@otterdeploy/api/routers/project/service-tasks";

import { deploymentTasksCollection } from "@/features/resources/data/deployments";
import { useLiveDuration } from "@/shared/lib/duration";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";

export interface DeploymentRow {
  id: string;
  resourceId: string;
  image: string;
  reason: string;
  status:
    | "pending"
    | "building"
    | "running"
    | "crashing"
    | "failed"
    | "superseded"
    | "removed";
  errorMessage: string | null;
  taskCount: number;
  failedTaskCount: number;
  runningTaskCount: number;
  gitSha: string | null;
  gitRef: string | null;
  gitCommitMessage: string | null;
  gitCommitAuthor: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function DeploymentDetailsBody({
  deployment,
  resource,
  projectId,
  resourceId,
  deploymentId,
}: {
  deployment: DeploymentRow | null;
  resource: ProjectResource | undefined;
  projectId: string;
  resourceId: string;
  deploymentId: string;
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
      <ConfigurationSection deployment={deployment} resource={resource} />
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

type PhaseState = "done" | "active" | "failed" | "pending";
interface Phase {
  key: string;
  label: string;
  state: PhaseState;
  detail?: string;
}
type Tone = "success" | "failed" | "active" | "neutral";

/**
 * Map our coarse deployment lifecycle (pending → building → running/failed,
 * plus swarm task rollup) onto a Railway-style phase stepper. We only track
 * four honest checkpoints — Initialize → Build → Deploy → Running — and can't
 * fabricate per-phase timings, so each phase shows state only; the header
 * carries the one real duration we have (created → completed).
 */
function buildTimeline(d: DeploymentRow): {
  title: string;
  tone: Tone;
  phases: Phase[];
  totalMs: number | null;
} {
  const totalMs = d.completedAt
    ? new Date(d.completedAt).getTime() - new Date(d.createdAt).getTime()
    : null;
  const err = d.errorMessage?.trim() || null;
  const p = (key: string, label: string, state: PhaseState, detail?: string): Phase => ({
    key,
    label,
    state,
    detail,
  });
  const allDone = [
    p("init", "Initialize", "done"),
    p("build", "Build", "done"),
    p("deploy", "Deploy", "done"),
    p("run", "Running", "done"),
  ];

  switch (d.status) {
    case "running":
      return { title: "Deployed successfully", tone: "success", totalMs, phases: allDone };
    case "building":
      return {
        title: "Building & deploying…",
        tone: "active",
        totalMs: null,
        phases: [
          p("init", "Initialize", "done"),
          p("build", "Build", "active"),
          p("deploy", "Deploy", "pending"),
          p("run", "Running", "pending"),
        ],
      };
    case "pending":
      return {
        title: "Queued",
        tone: "active",
        totalMs: null,
        phases: [
          p("init", "Initialize", "active"),
          p("build", "Build", "pending"),
          p("deploy", "Deploy", "pending"),
          p("run", "Running", "pending"),
        ],
      };
    case "failed":
      // Tasks scheduled ⇒ the image built and containers were placed, so the
      // failure is on the deploy side. No tasks ⇒ it never got past the build.
      return d.taskCount > 0
        ? {
            title: "Deployment failed",
            tone: "failed",
            totalMs,
            phases: [
              p("init", "Initialize", "done"),
              p("build", "Build", "done"),
              p("deploy", "Deploy", "failed", err ?? "Containers failed to start"),
              p("run", "Running", "pending"),
            ],
          }
        : {
            title: "Build failed",
            tone: "failed",
            totalMs,
            phases: [
              p("init", "Initialize", "done"),
              p("build", "Build", "failed", err ?? "Build did not complete"),
              p("deploy", "Deploy", "pending"),
              p("run", "Running", "pending"),
            ],
          };
    case "crashing":
      // Built + deployed fine, but the container keeps exiting and restarting
      // (e.g. a bad env var) — the run phase is the one that's failing.
      return {
        title: "Crash-looping",
        tone: "failed",
        totalMs,
        phases: [
          p("init", "Initialize", "done"),
          p("build", "Build", "done"),
          p("deploy", "Deploy", "done"),
          p("run", "Running", "failed", err ?? "Container keeps restarting (crash loop)"),
        ],
      };
    case "superseded":
      return { title: "Superseded by a newer deployment", tone: "neutral", totalMs, phases: allDone };
    default:
      return { title: "Removed", tone: "neutral", totalMs, phases: allDone };
  }
}

const TONE_STYLE: Record<Tone, { border: string; head: string; text: string }> = {
  success: { border: "border-success/25", head: "bg-success/[0.06]", text: "text-success" },
  failed: { border: "border-destructive/30", head: "bg-destructive/[0.07]", text: "text-destructive" },
  active: { border: "border-warning/30", head: "bg-warning/[0.06]", text: "text-warning" },
  neutral: { border: "border-border", head: "bg-muted/40", text: "text-foreground/90" },
};

function DeploymentTimeline({ deployment }: { deployment: DeploymentRow }) {
  const { title, tone, phases } = buildTimeline(deployment);
  const style = TONE_STYLE[tone];
  // Live while in flight (no completedAt → ticks every second), final once done.
  const duration = useLiveDuration(deployment.createdAt, deployment.completedAt);
  return (
    <div className={cn("overflow-hidden rounded-lg border", style.border)}>
      <div className={cn("flex items-center justify-between gap-3 px-4 py-3", style.head)}>
        <div className="flex items-center gap-2.5">
          <TimelineHeaderIcon tone={tone} />
          <span className={cn("text-[13.5px] font-medium", style.text)}>{title}</span>
        </div>
        {duration && (
          <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
            {duration}
          </span>
        )}
      </div>
      <div className="divide-y divide-border/40">
        {phases.map((phase) => (
          <PhaseRow key={phase.key} phase={phase} />
        ))}
      </div>
    </div>
  );
}

function TimelineHeaderIcon({ tone }: { tone: Tone }) {
  if (tone === "active") return <Spinner className="size-4 text-warning" />;
  if (tone === "success")
    return <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4 text-success" />;
  if (tone === "failed")
    return <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.5} className="size-4 text-destructive" />;
  return <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4 text-muted-foreground" />;
}

const PHASE_TEXT: Record<PhaseState, string> = {
  done: "text-foreground/85",
  active: "text-warning",
  failed: "text-destructive",
  pending: "text-muted-foreground/55",
};

function PhaseRow({ phase }: { phase: Phase }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-2.5",
        phase.state === "failed" && "bg-destructive/[0.05]",
      )}
    >
      <span className="mt-px grid size-4 shrink-0 place-items-center">
        <PhaseIcon state={phase.state} />
      </span>
      <div className="min-w-0 flex-1">
        <span className={cn("text-[13px]", PHASE_TEXT[phase.state])}>{phase.label}</span>
        {phase.detail && (
          <div className="mt-1 font-mono text-[11.5px] break-all whitespace-pre-wrap text-destructive/90">
            {phase.detail}
          </div>
        )}
      </div>
      {phase.state === "pending" && (
        <span className="shrink-0 text-[11px] text-muted-foreground/50">Not started</span>
      )}
    </div>
  );
}

function PhaseIcon({ state }: { state: PhaseState }) {
  if (state === "active") return <Spinner className="size-3.5 text-warning" />;
  if (state === "done")
    return <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4 text-success" />;
  if (state === "failed")
    return <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2.5} className="size-3.5 text-destructive" />;
  return <span className="size-2.5 rounded-full border-[1.5px] border-muted-foreground/30" />;
}

// ─── "Deployed from" (source provenance) ─────────────────────────────────────

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
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-[13px] text-foreground/90">
              {deployment.gitCommitMessage ?? "Git deployment"}
            </span>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11.5px] text-muted-foreground">
              {deployment.gitRef && <span>{deployment.gitRef}</span>}
              {deployment.gitSha && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span>{deployment.gitSha.slice(0, 7)}</span>
                </>
              )}
              {deployment.gitCommitAuthor && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span>{deployment.gitCommitAuthor}</span>
                </>
              )}
            </div>
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

const BUILDER_LABEL: Record<string, string> = {
  auto: "Auto-detect",
  dockerfile: "Dockerfile",
  railpack: "Railpack",
  compose: "Compose",
};

function readBuilder(resource: ProjectResource | undefined): string | null {
  if (resource?.type !== "service") return null;
  const bc = resource.buildConfig;
  if (bc && typeof bc === "object" && "builder" in bc) {
    const builder = (bc as { builder?: unknown }).builder;
    if (typeof builder === "string") return BUILDER_LABEL[builder] ?? builder;
  }
  return null;
}

function ConfigurationSection({
  deployment,
  resource,
}: {
  deployment: DeploymentRow;
  resource: ProjectResource | undefined;
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
    if (resource.publicEnabled && resource.publicDomain) {
      deploy.push({ label: "Domain", value: resource.publicDomain });
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
      <span className="text-muted-foreground">
        {task.slot != null ? `slot.${task.slot}` : "—"}
      </span>
      <span className="text-foreground/75">
        {task.containerId ? task.containerId.slice(0, 12) : "—"}
      </span>
      <span className="truncate text-foreground/80">
        {task.error ?? task.message ?? task.rawState ?? "no message"}
        {typeof task.exitCode === "number" && task.exitCode !== 0 ? (
          <span className="ml-2 text-destructive">exit {task.exitCode}</span>
        ) : null}
      </span>
      <span className="text-right text-muted-foreground">
        {task.timestamp ? new Date(task.timestamp).toLocaleString() : "—"}
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
          "bg-success/15 text-success border-success/30": state === "running",
          "bg-warning/15 text-warning border-warning/30": state === "building",
          "bg-destructive/15 text-destructive border-destructive/30": state === "error",
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

export function DeploymentStatusBadge({ status }: { status: DeploymentRow["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border border-border/60 bg-muted px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground uppercase",
        {
          "bg-success/15 text-success border-success/30": status === "running",
          "bg-destructive/15 text-destructive border-destructive/30":
            status === "failed" || status === "crashing",
          "bg-warning/15 text-warning border-warning/30":
            status === "building" || status === "pending",
        },
      )}
    >
      {status}
    </span>
  );
}

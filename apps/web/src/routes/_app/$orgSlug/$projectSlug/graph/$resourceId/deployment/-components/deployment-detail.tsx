import { and, eq, useLiveQuery } from "@tanstack/react-db";

import type { ServiceTaskInfo } from "@otterdeploy/api/routers/project/service-tasks";

import { deploymentTasksCollection } from "@/features/resources/data/deployments";
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
    | "failed"
    | "superseded"
    | "removed";
  errorMessage: string | null;
  taskCount: number;
  failedTaskCount: number;
  runningTaskCount: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function DeploymentDetailsBody({
  deployment,
  projectId,
  resourceId,
  deploymentId,
}: {
  deployment: DeploymentRow | null;
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
    <div className="flex flex-col gap-5">
      {deployment.errorMessage && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-[12px] text-destructive">
          {deployment.errorMessage}
        </div>
      )}
      <dl className="grid grid-cols-[140px_1fr] gap-y-2.5 font-mono text-[12.5px]">
        <DetailRow label="Status" value={deployment.status} />
        <DetailRow label="Reason" value={deployment.reason} />
        <DetailRow label="Image" value={deployment.image} />
        <DetailRow
          label="Tasks"
          value={`${deployment.taskCount} total · ${deployment.runningTaskCount} running · ${deployment.failedTaskCount} failed`}
        />
        <DetailRow
          label="Created"
          value={new Date(deployment.createdAt).toLocaleString()}
        />
        <DetailRow
          label="Completed"
          value={
            deployment.completedAt
              ? new Date(deployment.completedAt).toLocaleString()
              : "—"
          }
        />
      </dl>

      <DeploymentTasksList
        projectId={projectId}
        resourceId={resourceId}
        deploymentId={deploymentId}
      />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
        {label}
      </dt>
      <dd className="text-foreground/85">{value}</dd>
    </>
  );
}

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
    <div className="flex flex-col gap-2">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
        Tasks
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground">
          <Spinner className="size-3" />
          Loading tasks…
        </div>
      ) : tasks.length === 0 ? (
        <div className="font-mono text-[11.5px] text-muted-foreground">
          No tasks scheduled yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border bg-card">
          <div className="divide-y divide-border/40">
            {tasks.map((t) => (
              <DeploymentTaskRow key={t.id} task={t} />
            ))}
          </div>
        </div>
      )}
    </div>
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
          "bg-destructive/15 text-destructive border-destructive/30":
            state === "error",
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

export function DeploymentStatusBadge({
  status,
}: {
  status: DeploymentRow["status"];
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[10px] font-medium uppercase bg-muted text-muted-foreground border-border/60",
        {
          "bg-success/15 text-success border-success/30": status === "running",
          "bg-destructive/15 text-destructive border-destructive/30":
            status === "failed",
          "bg-warning/15 text-warning border-warning/30":
            status === "building" || status === "pending",
        },
      )}
    >
      {status}
    </span>
  );
}

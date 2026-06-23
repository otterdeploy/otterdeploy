import { Activity, useState } from "react";
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import * as m from "motion/react-client";

import type { ServiceTaskInfo } from "@otterdeploy/api/routers/project/service-tasks";

import type { ProjectResource } from "@/features/projects/components/graph/resource-to-node";

import {
  deploymentTasksCollection,
  deploymentsCollection,
} from "@/features/resources/data/deployments";
import { resourceCollection } from "@/features/resources/data/resource";
import { Input } from "@/shared/components/ui/input";
import { Spinner } from "@/shared/components/ui/spinner";
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";

import { orpc } from "@/shared/server/orpc";
import {
  LogViewer,
  type LogLine,
} from "@/features/logs/components/log-viewer";
import { useLogStream } from "@/features/logs/data/use-log-stream";

export const Route = createFileRoute(
  "/_app/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId",
)({
  staticData: { crumb: "Deployment" },
  component: RouteComponent,
});

type DeploymentTab =
  | "details"
  | "build-logs"
  | "deploy-logs"
  | "http-logs"
  | "network-logs";

function getSubline(resource?: ProjectResource  ): string {
  if (resource?.type === "database") return resource.internalHostname;
  if (resource?.type === "service") return resource.publicDomain ?? "";
  if (resource?.type === "compose")
    return resource.services.length === 1
      ? "1 service"
      : `${resource.services.length} services`;
  return "";
}

function RouteComponent() {
  const { orgSlug, projectSlug, resourceId, deploymentId } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const [tab, setTab] = useState<DeploymentTab>("deploy-logs");

  const { data: deployment = null } = useLiveQuery(
    (q) =>
      q
        .from({ d: deploymentsCollection })
        .where(({ d }) =>
          and(
            eq(d.projectId, project.id),
            eq(d.resourceId, resourceId),
            eq(d.id, deploymentId),
          ),
        )
        .findOne(),
    [project.id, resourceId, deploymentId],
  );

  const { data: resource } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) =>
          and(eq(r.projectId, project.id), eq(r.resourceId, resourceId)),
        )
        .findOne(),
    [project.id, resourceId],
  );

  const subline = getSubline(resource);

  return (
    <m.div
      key={deploymentId}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="absolute size-full bg-muted -top-5 -right-4 border rounded-tl-3xl shadow-md overflow-hidden"
    >
      <div className="pointer-events-auto absolute inset-0 flex flex-col overflow-hidden bg-background">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <span className="text-[18px] font-semibold tracking-tight">
                {resource?.name ?? "Deployment"}
              </span>
              <span className="text-muted-foreground/40">/</span>
              <span className="font-mono text-[14px] text-muted-foreground">
                {deploymentId.split("_")[1]?.slice(0, 8) ??
                  deploymentId.slice(0, 8)}
              </span>
              {deployment && (
                <DeploymentStatusBadge status={deployment.status} />
              )}
            </div>
            {subline && (
              <div className="font-mono text-[12px] text-muted-foreground/80">
                {subline}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {deployment
                ? new Date(deployment.createdAt).toLocaleString()
                : "—"}
            </span>
            <Link
              to="/$orgSlug/$projectSlug/graph/$resourceId"
              params={{ orgSlug, projectSlug, resourceId }}
              aria-label="Close deployment"
              className="grid size-7 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
            >
              <HugeiconsIcon
                icon={Cancel01Icon}
                strokeWidth={2}
                className="size-4"
              />
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={tab}
          onValueChange={(v) => v && setTab(v as DeploymentTab)}
          className="mt-4 flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="border-b border-border/60 px-6">
            <TabsList variant="line" className="h-auto bg-transparent p-0">
              <TabsTrigger value="details" className="px-2.5 py-2.5">
                Details
              </TabsTrigger>
              <TabsTrigger value="build-logs" className="px-2.5 py-2.5">
                Build Logs
              </TabsTrigger>
              <TabsTrigger value="deploy-logs" className="px-2.5 py-2.5">
                Deploy Logs
              </TabsTrigger>
              <TabsTrigger value="http-logs" className="px-2.5 py-2.5">
                HTTP Logs
              </TabsTrigger>
              <TabsTrigger value="network-logs" className="px-2.5 py-2.5">
                Network Flow Logs
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <TabsContents className="h-full">
              <TabsContent
                value="details"
                keepMounted
                className="h-full overflow-y-auto px-6 pt-5 pb-6"
              >
                <Activity mode={tab === "details" ? "visible" : "hidden"}>
                  <DeploymentDetailsBody
                    deployment={deployment}
                    projectId={project.id}
                    resourceId={resourceId}
                    deploymentId={deploymentId}
                  />
                </Activity>
              </TabsContent>
              <TabsContent
                value="build-logs"
                keepMounted
                className="flex h-full min-h-0 flex-col px-6 pt-5 pb-6"
              >
                <Activity mode={tab === "build-logs" ? "visible" : "hidden"}>
                  <BuildLogsBody deploymentId={deploymentId} />
                </Activity>
              </TabsContent>
              <TabsContent
                value="deploy-logs"
                keepMounted
                className="flex h-full min-h-0 flex-col px-6 pt-5 pb-6"
              >
                <Activity mode={tab === "deploy-logs" ? "visible" : "hidden"}>
                  <DeploymentLogsBody
                    projectId={project.id}
                    resourceId={resourceId}
                    deploymentId={deploymentId}
                  />
                </Activity>
              </TabsContent>
              <TabsContent
                value="http-logs"
                keepMounted
                className="flex h-full min-h-0 flex-col px-6 pt-5 pb-6"
              >
                <Activity mode={tab === "http-logs" ? "visible" : "hidden"}>
                  <NotImplementedTab
                    title="HTTP request logs"
                    hint="Caddy-fronted resources will stream per-request access logs here. Wiring lands once the Caddy log adapter ships."
                  />
                </Activity>
              </TabsContent>
              <TabsContent
                value="network-logs"
                keepMounted
                className="flex h-full min-h-0 flex-col px-6 pt-5 pb-6"
              >
                <Activity mode={tab === "network-logs" ? "visible" : "hidden"}>
                  <NotImplementedTab
                    title="Network flow logs"
                    hint="Per-task connection metadata (peer, bytes in/out, duration) will land here once the swarm flow collector is wired."
                  />
                </Activity>
              </TabsContent>
            </TabsContents>
          </div>
        </Tabs>
      </div>
    </m.div>
  );
}

// ─── Details tab ──────────────────────────────────────────────────────────

interface DeploymentRow {
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

function DeploymentDetailsBody({
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

function DeploymentStatusBadge({
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

// ─── Deploy Logs tab ──────────────────────────────────────────────────────

function DeploymentLogsBody({
  projectId,
  resourceId,
  deploymentId,
}: {
  projectId: string;
  resourceId: string;
  deploymentId: string;
}) {
  const [filter, setFilter] = useState("");
  const { lines, status } = useLogStream({
    open: (signal) =>
      orpc.project.resource.deployments.logs.tail.call(
        {
          projectId: projectId as never,
          resourceId: resourceId as never,
          deploymentId: deploymentId as never,
          tail: 500,
        },
        { signal, context: { retry: Number.POSITIVE_INFINITY } },
      ),
    map: (e, id): LogLine => ({
      id,
      stream: e.stream,
      line: e.line,
      ts: e.ts,
    }),
    onError: (err, id): LogLine => ({
      id,
      stream: "system",
      line: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
      ts: new Date().toISOString(),
    }),
    deps: [projectId, resourceId, deploymentId],
  });

  const filtered = filter
    ? lines.filter((l) => l.line.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="relative">
        <HugeiconsIcon
          icon={Search01Icon}
          strokeWidth={2}
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter and search logs"
          className="h-9 pl-8 font-mono text-[12px]"
        />
      </div>
      <LogViewer
        lines={filtered}
        empty={
          <LogEmpty
            title={
              status === "connecting"
                ? "Loading deployment logs…"
                : filter
                  ? "No logs match this filter"
                  : "No logs in this time range"
            }
            hint="Logs will show up here as they are found."
          />
        }
      />
    </div>
  );
}

// ─── Build / HTTP / Network placeholders ─────────────────────────────────
// Distinct components rather than a generic message so each can grow its
// own real-data wiring without changing the page layout.

function BuildLogsBody({ deploymentId }: { deploymentId: string }) {
  // Build pipeline logs come from apps/builder via Redis pub/sub +
  // deployment_log, streamed over the oRPC event-iterator
  // (project.resource.deployments.buildLogs.stream). `context.retry` opts
  // this call into the client retry plugin's auto-reconnect; on reconnect
  // the server resumes from the last seen seq via lastEventId.
  const { lines, status } = useLogStream({
    open: (signal) =>
      orpc.project.resource.deployments.buildLogs.stream.call(
        { deploymentId: deploymentId as never },
        { signal, context: { retry: Number.POSITIVE_INFINITY } },
      ),
    map: (e, id): LogLine => ({
      id,
      stream: e.stream,
      line: e.line,
      ts: e.ts,
    }),
    onError: (err, id): LogLine => ({
      id,
      stream: "stderr",
      line: `Build log stream error: ${err instanceof Error ? err.message : String(err)}`,
      ts: new Date().toISOString(),
    }),
    deps: [deploymentId],
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <LogViewer
        lines={lines}
        empty={
          <LogEmpty
            title={
              status === "connecting"
                ? "Connecting to build log stream…"
                : status === "error"
                  ? "Stream disconnected"
                  : "No build output yet"
            }
            hint="Lines appear here as the builder runs."
          />
        }
      />
    </div>
  );
}

// ─── Build / HTTP / Network placeholders ─────────────────────────────────
// Distinct components rather than a generic message so each can grow its
// own real-data wiring without changing the page layout.

function NotImplementedTab({ title, hint }: { title: string; hint: string }) {
  return <EmptyTab title={title} hint={hint} />;
}

function EmptyTab({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="grid h-full place-items-center rounded-md border bg-[oklch(0.12_0_0)] p-6 text-center">
      <div className="flex max-w-md flex-col items-center gap-2">
        <div className="text-[14px] font-medium text-foreground/80">
          {title}
        </div>
        <div className="text-[12px] text-muted-foreground">{hint}</div>
      </div>
    </div>
  );
}

// Centered empty/loading copy rendered inside a LogViewer's scroller.
function LogEmpty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="grid h-full place-items-center text-center">
      <div className="flex flex-col items-center gap-2">
        <div className="text-[14px] font-medium text-foreground/80">{title}</div>
        <div className="text-[12px] text-muted-foreground">{hint}</div>
      </div>
    </div>
  );
}

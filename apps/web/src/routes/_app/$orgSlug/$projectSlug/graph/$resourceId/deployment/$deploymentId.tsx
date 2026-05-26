import { Activity, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import * as m from "motion/react-client";

import { createDeploymentsCollection } from "@/features/projects/data/deployments";
import { createResourceCollection } from "@/features/projects/data/resource";
import { Input } from "@/shared/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

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

function RouteComponent() {
  const { orgSlug, projectSlug, resourceId, deploymentId } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const [tab, setTab] = useState<DeploymentTab>("deploy-logs");

  // Pull this deployment out of the resource's deployment collection so the
  // panel re-renders as status changes. Polling lives in the collection
  // factory, no need to wire our own interval here.
  const deploymentsCollection = useMemo(
    () => createDeploymentsCollection(project.id as never, resourceId as never),
    [project.id, resourceId],
  );
  const { data: matches = [] } = useLiveQuery(
    (q) =>
      q
        .from({ d: deploymentsCollection })
        .where(({ d }) => eq(d.id, deploymentId)),
    [deploymentId, deploymentsCollection],
  );
  const deployment = matches[0] ?? null;

  // Resource name powers the header breadcrumb. Same collection used by the
  // resource panel under us, so it's already warm.
  const resourceCollection = useMemo(
    () => createResourceCollection(project.id),
    [project.id],
  );
  const { data: resource } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) => eq(r.resourceId, resourceId))
        .findOne(),
    [resourceId, resourceCollection],
  );

  const subline =
    resource?.type === "database"
      ? resource.internalHostname
      : resource?.type === "service"
        ? (resource.publicDomain ?? "")
        : "";

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
                  <BuildLogsPlaceholder />
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
      <div className="text-[13px] text-muted-foreground">
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

interface TaskInfo {
  id: string;
  slot: number | null;
  label: string;
  state: "running" | "building" | "error";
  rawState: string | null;
  desiredState: string | null;
  nodeId: string | null;
  message: string | null;
  error: string | null;
  containerId: string | null;
  exitCode: number | null;
  timestamp: string | null;
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
  const [tasks, setTasks] = useState<TaskInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTasks(null);
    setError(null);
    (async () => {
      try {
        const result = await orpc.project.resource.deployments.tasks.call({
          projectId: projectId as never,
          resourceId: resourceId as never,
          deploymentId: deploymentId as never,
        });
        if (cancelled) return;
        setTasks(result);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, resourceId, deploymentId]);

  return (
    <div className="flex flex-col gap-2">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
        Tasks
      </div>
      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-[12px] text-destructive">
          {error}
        </div>
      ) : tasks === null ? (
        <div className="font-mono text-[11.5px] text-muted-foreground">
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

function DeploymentTaskRow({ task }: { task: TaskInfo }) {
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

function TaskStateBadge({ state }: { state: TaskInfo["state"] }) {
  const tone =
    state === "running"
      ? "bg-success/15 text-success border-success/30"
      : state === "building"
        ? "bg-warning/15 text-warning border-warning/30"
        : "bg-destructive/15 text-destructive border-destructive/30";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase",
        tone,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          state === "running"
            ? "bg-success"
            : state === "building"
              ? "bg-warning"
              : "bg-destructive",
        )}
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
  const tone =
    status === "running"
      ? "bg-success/15 text-success border-success/30"
      : status === "failed"
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : status === "building" || status === "pending"
          ? "bg-warning/15 text-warning border-warning/30"
          : "bg-muted text-muted-foreground border-border/60";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[10px] font-medium uppercase",
        tone,
      )}
    >
      {status}
    </span>
  );
}

// ─── Deploy Logs tab ──────────────────────────────────────────────────────

interface LogLine {
  id: number;
  stream: "stdout" | "stderr" | "system";
  line: string;
  ts: string | null;
}

function DeploymentLogsBody({
  projectId,
  resourceId,
  deploymentId,
}: {
  projectId: string;
  resourceId: string;
  deploymentId: string;
}) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<
    "connecting" | "live" | "ended" | "error"
  >("connecting");
  const [filter, setFilter] = useState("");
  const counterRef = useRef(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLines([]);
    setStatus("connecting");
    counterRef.current = 0;
    (async () => {
      try {
        const stream = await orpc.project.resource.deployments.logs.tail.call(
          {
            projectId: projectId as never,
            resourceId: resourceId as never,
            deploymentId: deploymentId as never,
            tail: 500,
          },
          { signal: ctrl.signal },
        );
        setStatus("live");
        for await (const event of stream) {
          if (ctrl.signal.aborted) break;
          setLines((prev) => [
            ...prev,
            {
              id: ++counterRef.current,
              stream: event.stream,
              line: event.line,
              ts: event.ts,
            },
          ]);
        }
        if (!ctrl.signal.aborted) setStatus("ended");
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setStatus("error");
        setLines((prev) => [
          ...prev,
          {
            id: ++counterRef.current,
            stream: "system",
            line: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
            ts: new Date().toISOString(),
          },
        ]);
      }
    })();
    return () => ctrl.abort();
  }, [projectId, resourceId, deploymentId]);

  // Auto-scroll to bottom on new lines; pauses if the user scrolls away.
  const [autoScroll, setAutoScroll] = useState(true);
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, autoScroll]);

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
      <div
        ref={scrollerRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
          if (atBottom !== autoScroll) setAutoScroll(atBottom);
        }}
        className="min-h-0 flex-1 overflow-auto rounded-md border bg-[oklch(0.12_0_0)] p-3 font-mono text-[11.5px] leading-relaxed"
      >
        {filtered.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div className="flex flex-col items-center gap-2">
              <div className="text-[14px] font-medium text-foreground/80">
                {status === "connecting"
                  ? "Loading deployment logs…"
                  : filter
                    ? "No logs match this filter"
                    : "No logs in this time range"}
              </div>
              <div className="text-[12px] text-muted-foreground">
                Logs will show up here as they are found.
              </div>
            </div>
          </div>
        ) : (
          filtered.map((l) => <LogLineRow key={l.id} line={l} />)
        )}
      </div>
    </div>
  );
}

// ─── Build / HTTP / Network placeholders ─────────────────────────────────
// Distinct components rather than a generic message so each can grow its
// own real-data wiring without changing the page layout.

function BuildLogsPlaceholder() {
  // Postgres + service resources currently launch from pre-built docker
  // images — no build step happens on our side. When buildpacks / git-source
  // services land, this is where their `docker build` output will stream.
  return (
    <EmptyTab
      title="No build step for this deployment"
      hint="This resource launches from a pre-built docker image, so there's no build phase. Build logs surface here for buildpack and git-source services once those land."
    />
  );
}

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

function LogLineRow({ line }: { line: LogLine }) {
  const tone =
    line.stream === "stderr"
      ? "text-destructive/90"
      : line.stream === "system"
        ? "italic text-muted-foreground"
        : "text-foreground/85";
  return (
    <div className={cn("flex gap-3", tone)}>
      {line.ts && (
        <span className="shrink-0 text-muted-foreground/50">
          {line.ts.replace("T", " ").replace(/\.\d+Z$/, "")}
        </span>
      )}
      <span className="whitespace-pre-wrap break-all">{line.line}</span>
    </div>
  );
}

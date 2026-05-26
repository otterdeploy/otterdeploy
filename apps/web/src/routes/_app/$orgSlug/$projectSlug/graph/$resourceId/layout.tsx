import { Activity, useEffect, useMemo, useRef, useState } from "react";
import {
  createFileRoute,
  Link,
  Outlet,
  useChildMatches,
  useLoaderData,
} from "@tanstack/react-router";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useMutation } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowReloadHorizontalIcon,
  ArrowRight01Icon,
  Cancel01Icon,
  Copy01Icon,
  Database02Icon,
  Delete02Icon,
  EarthIcon,
  HardDriveIcon,
  InformationCircleIcon,
  Key01Icon,
  Link01Icon,
  Maximize01Icon,
  MoreVerticalIcon,
  PlusSignIcon,
  RocketIcon,
  Search01Icon,
  ServerStack01Icon,
  TerminalIcon,
  Tick02Icon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import type { ComponentProps, SVGProps } from "react";
import { toast } from "sonner";

import * as m from "motion/react-client";
import { AnimatePresence } from "motion/react";

import { INITIAL_NODES_BY_ID } from "@/features/projects/components/graph/initial-nodes";
import type {
  ResourceEngine,
  ResourceKind,
  ResourceNodeData,
} from "@/features/projects/components/graph/resource-node";
import { createResourceCollection } from "@/features/projects/data/resource";
import { createDeploymentsCollection } from "@/features/projects/data/deployments";
import { TerminalSession } from "@/features/terminal/components/terminal-session";
import { terminalContainersCollection } from "@/features/terminal/data/targets";
import type { SessionSource } from "@/features/terminal/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";
import { Docker } from "@/shared/components/ui/svgs/docker";
import { Mariadb } from "@/shared/components/ui/svgs/mariadb";
import { Mongodb } from "@/shared/components/ui/svgs/mongodb";
import { Mysql } from "@/shared/components/ui/svgs/mysql";
import { Postgresql } from "@/shared/components/ui/svgs/postgresql";
import { Redis } from "@/shared/components/ui/svgs/redis";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";
import { zId } from "@otterstack/shared/id";

const zSearchSchema = zId("resource");
export const Route = createFileRoute(
  "/_app/$orgSlug/$projectSlug/graph/$resourceId",
)({
  staticData: { crumb: "Resource" },
  component: RouteComponent,
});

function RouteComponent() {
  const { resourceId } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const navigate = Route.useNavigate();
  // Key the inner Outlet by the active child match so AnimatePresence sees
  // the deployment overlay come and go. Without this the same <Outlet />
  // element is rendered for every navigation and the exit never fires.
  const childMatches = useChildMatches();
  const deploymentKey = childMatches[0]?.pathname ?? null;

  const resourceCollection = useMemo(
    () => createResourceCollection(project.id),
    [project.id],
  );

  const { data: matches = [] } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) => eq(r.resourceId, resourceId)),
    [resourceId, resourceCollection],
  );

  const resource = matches[0] ?? null;
  // Fall back to the static graph node when nothing's in the DB yet.
  const demoNode = !resource ? (INITIAL_NODES_BY_ID[resourceId] ?? null) : null;

  const close = () => navigate({ to: "/$orgSlug/$projectSlug/graph" });

  return (
    <m.div
      key={resourceId}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="pointer-events-auto relative h-full w-3/5 bg-muted rounded-2xl rounded-tr-none border border-r-0 border-border"
    >
      {resource && resource.type === "database" ? (
        <RealResourcePanel
          resource={resource}
          projectName={project.name}
          onClose={close}
        />
      ) : resource && resource.type === "service" ? (
        <ServiceResourcePanel resource={resource} onClose={close} />
      ) : demoNode ? (
        <DemoNodePanel node={demoNode.data} onClose={close} />
      ) : (
        <NotFound id={resourceId} onClose={close} />
      )}

      {/* Nested AnimatePresence drives the deployment overlay's exit when
          the user closes it. We only mount the Outlet when a child route
          is active; the key flips when navigating between deployments. */}
      <AnimatePresence mode="wait">
        {deploymentKey ? <Outlet key={deploymentKey} /> : null}
      </AnimatePresence>
    </m.div>
  );
}

/**
 * Minimal panel for service resources. The deep postgres-shaped panel
 * (RealResourcePanel) doesn't apply — services need their own per-section
 * surface (logs, env, ports, deploys, replicas) which lands in later D.* slices.
 * For D.1 we show identity + image + replica count so clicking a service node
 * isn't a dead end.
 */
function ServiceResourcePanel({
  resource,
  onClose,
}: {
  resource: {
    name: string;
    image: string;
    replicas: number;
    status: string;
    publicEnabled: boolean;
    publicDomain: string | null;
  };
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to graph"
            onClick={onClose}
            className="mt-1"
          >
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              strokeWidth={2}
              className="size-4"
            />
          </Button>
          <PanelIcon
            node={{
              kind: "service",
              name: resource.name,
              description: resource.image,
            }}
          />
          <div className="flex flex-col gap-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Service
            </div>
            <div className="text-[20px] font-semibold leading-tight">
              {resource.name}
            </div>
            <div className="font-mono text-[12px] text-muted-foreground">
              {resource.image}
            </div>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          onClick={onClose}
        >
          <HugeiconsIcon
            icon={Cancel01Icon}
            strokeWidth={2}
            className="size-4"
          />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 px-6 pt-5">
        <PanelStat
          label="Replicas (desired)"
          value={String(resource.replicas)}
        />
        <PanelStat label="Status" value={resource.status} />
        <PanelStat
          label="Public"
          value={
            resource.publicEnabled
              ? (resource.publicDomain ?? "yes")
              : "private"
          }
        />
      </div>

      <div className="mx-6 mt-6 rounded-md border border-dashed bg-muted/20 p-5 text-[12px] text-muted-foreground">
        Service-specific sections (logs, env, ports, deployments, live replica
        state) land in later D.* slices. The data is in the database and the
        graph node renders correctly — this panel is intentionally minimal until
        the per-section procedures ship.
      </div>
    </div>
  );
}

function PanelStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[13px] text-foreground">
        {value}
      </div>
    </div>
  );
}

// ─── Icon lookup ────────────────────────────────────────────────────────────
// Mirror the graph node's icon + tint in the panel header so the panel reads
// as a continuation of the clicked node, not a generic detail page.

type HugeIcon = ComponentProps<typeof HugeiconsIcon>["icon"];
type BrandSvg = (props: SVGProps<SVGSVGElement>) => React.ReactNode;

const KIND_ICON: Record<ResourceKind, { icon: HugeIcon; tint: string }> = {
  service: {
    icon: ServerStack01Icon,
    tint: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  database: {
    icon: Database02Icon,
    tint: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  route: {
    icon: EarthIcon,
    tint: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  volume: {
    icon: HardDriveIcon,
    tint: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  },
};

const ENGINE_LOGO: Record<ResourceEngine, BrandSvg> = {
  postgres: Postgresql,
  mysql: Mysql,
  mariadb: Mariadb,
  redis: Redis,
  mongodb: Mongodb,
  docker: Docker,
};

function PanelIcon({ node }: { node: ResourceNodeData }) {
  // Engine-branded resources show the real brand SVG on a neutral tile —
  // matches how the graph node renders postgres/redis/mongo/etc.
  if (node.engine) {
    const Brand = ENGINE_LOGO[node.engine];
    if (Brand) {
      return (
        <div className="grid size-10 shrink-0 place-items-center rounded-lg border bg-background">
          <Brand className="size-5" aria-label={node.engine} />
        </div>
      );
    }
  }
  const { icon, tint } = KIND_ICON[node.kind];
  return (
    <div
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-lg",
        tint,
      )}
    >
      <HugeiconsIcon icon={icon} strokeWidth={1.8} className="size-5" />
    </div>
  );
}

// ─── Demo-node panel — wide, table-row layout per the design ─────────────────

/** Mock the fields `ResourceNodeData` doesn't carry yet — derived from the
 *  node's name so each one looks plausible per-service. */
function demoMeta(node: ResourceNodeData) {
  const slug = node.name.replace(/[^a-z0-9-]/gi, "-");
  const isService = node.kind === "service";
  const tech = node.tech?.label ?? "—";
  return {
    repo: `paperhouse/helio-${slug}`,
    domain: isService ? `${slug}.helio.so` : null,
    port: isService ? 8080 : null,
    image: tech.includes("Node")
      ? "node:20-alpine"
      : tech.includes("Bun")
        ? "oven/bun:1.3"
        : tech.includes("Go")
          ? "golang:1.23-alpine"
          : tech.includes("Postgres")
            ? "postgres:16-alpine"
            : tech.includes("Redis")
              ? "redis:7-alpine"
              : tech.includes("MongoDB")
                ? "mongo:7"
                : tech.includes("MySQL")
                  ? "mysql:8.4"
                  : tech.includes("MariaDB")
                    ? "mariadb:11.4"
                    : tech.toLowerCase(),
    replicas: isService ? 1 : 1,
    region: "sf-bay / rack-2",
    cpu: 51,
    memory: 48,
    rps: isService ? 1180 : null,
    deployedAt: "2:06",
  };
}

type ResourceTab =
  | "deployments"
  | "metrics"
  | "variables"
  | "terminal"
  | "settings";

function DemoNodePanel({
  node,
  onClose,
}: {
  node: ResourceNodeData;
  onClose: () => void;
}) {
  const meta = demoMeta(node);
  const isOnline = node.status === "running" || node.status === undefined;
  const isBuilding = node.status === "building";
  const isError = node.status === "error";

  const stateLabel = isError ? "FAILED" : isBuilding ? "BUILDING" : "ONLINE";
  const stateTone = isError
    ? "bg-destructive/12 text-destructive"
    : isBuilding
      ? "bg-warning/12 text-warning"
      : "bg-success/12 text-success";
  const stateSubtitle = isError
    ? "Deployment failed · check logs"
    : isBuilding
      ? "Build in progress…"
      : `Successful deployment (${meta.deployedAt})`;

  const [tab, setTab] = useState<ResourceTab>("deployments");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to graph"
            onClick={onClose}
            className="mt-1"
          >
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              strokeWidth={2}
              className="size-4"
            />
          </Button>
          <PanelIcon node={node} />
          <div className="flex flex-col gap-0.5">
            <span className="text-xl font-bold leading-none tracking-tight">
              {node.name}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {node.git ? node.git.commit.slice(0, 7) : "—"}{" "}
              <span className="text-muted-foreground/50">·</span> {meta.repo}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="default">
            <HugeiconsIcon
              icon={TerminalIcon}
              strokeWidth={1.8}
              className="size-3.5"
            />
            Terminal
          </Button>
          <Button variant="outline" size="default">
            <HugeiconsIcon
              icon={ArrowReloadHorizontalIcon}
              strokeWidth={1.8}
              className="size-3.5"
            />
            Restart
          </Button>
          <Button size="default">
            <HugeiconsIcon
              icon={RocketIcon}
              strokeWidth={1.8}
              className="size-3.5"
            />
            Redeploy
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close panel"
            onClick={onClose}
            className="ml-1"
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              strokeWidth={2}
              className="size-4"
            />
          </Button>
        </div>
      </div>

      {/* ─── Status row ─────────────────────────────────────────────── */}
      <div className="mt-5 flex items-center gap-3 border-t border-border/40 px-6 py-3">
        <span
          className={cn(
            "rounded-md px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em]",
            stateTone,
          )}
        >
          {stateLabel}
        </span>
        <span className="text-[13px] text-muted-foreground">
          {stateSubtitle}
        </span>
      </div>

      {/* ─── Tabs ───────────────────────────────────────────────────── */}
      <Tabs
        value={tab}
        onValueChange={(v) => v && setTab(v as typeof tab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b border-border/60 px-6">
          <TabsList variant="line" className="h-auto bg-transparent p-0">
            <TabsTrigger value="deployments" className="px-2.5 py-2.5">
              Deployments
            </TabsTrigger>
            <TabsTrigger value="metrics" className="px-2.5 py-2.5">
              Metrics
            </TabsTrigger>
            <TabsTrigger value="variables" className="px-2.5 py-2.5">
              Variables
            </TabsTrigger>
            <TabsTrigger value="terminal" className="px-2.5 py-2.5">
              Terminal
            </TabsTrigger>
            <TabsTrigger value="settings" className="px-2.5 py-2.5">
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContents>
            <TabsContent value="deployments" className="px-6 pt-5 pb-6">
              <SectionLabel>Recent deployments</SectionLabel>
              {node.git && (
                <div className="mt-4 space-y-4 font-mono text-[12.5px]">
                  <DeployRow
                    commit={node.git.commit.slice(0, 7)}
                    message={node.git.message}
                    age="11m ago"
                    author="arjun"
                  />
                  <DeployRow
                    commit="b7e1c9d"
                    message="chore: bump dependencies"
                    age="2h ago"
                    author="mira"
                  />
                  <DeployRow
                    commit="a3f8b2c"
                    message="fix: handle empty preflight headers"
                    age="1d ago"
                    author="arjun"
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="metrics" className="px-6 pt-5 pb-6">
              <MetricsTabBody meta={meta} replicaName={`${node.name}.r1`} />
            </TabsContent>

            <TabsContent value="variables" className="px-6 pt-5 pb-6">
              <VariablesTabBody
                projectName={
                  node.name === "imgproxy" ? "paperhouse" : "gravy-truck"
                }
              />
            </TabsContent>

            {/* keepMounted + <Activity> keeps the terminal session, PTY, and
                xterm scrollback alive across tab switches. Mode is driven by
                the current tab — Activity defers initial mount until the
                user first opens the Terminal tab. */}
            <TabsContent
              value="terminal"
              keepMounted
              className="px-6 pt-5 pb-6"
            >
              <Activity mode={tab === "terminal" ? "visible" : "hidden"}>
                <ResourceTerminal
                  match={{
                    kind: "service",
                    resourceId: `demo-${node.name}`,
                  }}
                  fallbackLabel={`otterstack-${node.name}-1`}
                />
              </Activity>
            </TabsContent>

            <TabsContent value="settings" className="px-6 pt-5 pb-6">
              <SettingsTabBody node={node} meta={meta} />
            </TabsContent>
          </TabsContents>
        </div>
      </Tabs>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
      {children}
    </div>
  );
}

function DeployRow({
  commit,
  message,
  age,
  author,
}: {
  commit: string;
  message: string;
  age: string;
  author: string;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-foreground">{commit}</span>
        <span className="text-muted-foreground">· {age}</span>
      </div>
      <p className="mt-1 font-sans text-[13px] text-foreground">{message}</p>
      <p className="font-sans text-xs text-muted-foreground">by {author}</p>
    </div>
  );
}

function EnvRow({
  name,
  value,
  secret,
}: {
  name: string;
  value: string;
  secret?: boolean;
}) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-baseline gap-3 border-b border-border/40 py-2">
      <span className="text-foreground/80">{name}</span>
      <span
        className={cn(
          "truncate text-muted-foreground",
          secret && "rounded bg-muted px-1.5",
        )}
      >
        {secret ? "•".repeat(12) : value}
      </span>
    </div>
  );
}

// ─── Metrics tab ─────────────────────────────────────────────────────────────

const METRIC_RANGES = ["15m", "1h", "6h", "24h", "7d"] as const;
type MetricRange = (typeof METRIC_RANGES)[number];

function MetricsTabBody({
  meta,
  replicaName,
}: {
  meta: ReturnType<typeof demoMeta>;
  replicaName: string;
}) {
  const [range, setRange] = useState<MetricRange>("1h");
  return (
    <div className="flex flex-col gap-4">
      {/* Range row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
            Range
          </span>
          <div className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 p-0.5">
            {METRIC_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={cn(
                  "rounded px-2.5 py-1 font-mono text-xs transition-colors",
                  range === r
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          across 1 replica · {range} window
        </span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label="CPU"
          value={`${meta.cpu}%`}
          sub="46% avg · 63% peak"
          tone="success"
        />
        <MetricCard
          label="Memory"
          value={`${meta.memory}%`}
          sub="246 MB / 512 MB"
          tone="success"
        />
        <MetricCard
          label="Requests"
          value={`${meta.rps ?? 1180}/s`}
          sub="1086 avg · 1652 peak"
          tone="info"
        />
        <MetricCard
          label="Latency p95"
          value="88 ms"
          sub="64 ms p50 · 412 ms p99"
          tone="info"
        />
      </div>

      {/* Per-replica + status distribution */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <SubPanel title="Per-replica usage">
          <div className="grid grid-cols-[80px_1fr_50px] items-center gap-3 font-mono text-xs">
            <span className="row-span-2 self-start text-foreground/80">
              {replicaName}
            </span>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-3">
                <span className="w-8 text-muted-foreground">cpu</span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground/70"
                    style={{ width: "49%" }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-8 text-muted-foreground">mem</span>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground/70"
                    style={{ width: "45%" }}
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 text-foreground/80">
              <span>49%</span>
              <span>45%</span>
            </div>
          </div>
        </SubPanel>

        <SubPanel title="Status response distribution · last 1h">
          <StatusBarChart />
          <div className="mt-3 flex items-center gap-5 font-mono text-[11px]">
            <LegendDot color="bg-success" label="2xx" value="94.2%" />
            <LegendDot color="bg-info" label="3xx" value="3.1%" />
            <LegendDot color="bg-warning" label="4xx" value="2.4%" />
            <LegendDot color="bg-destructive" label="5xx" value="0.3%" />
          </div>
        </SubPanel>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "success" | "info";
}) {
  const valueClass = tone === "success" ? "text-success" : "text-info";
  return (
    <div className="rounded-lg border border-border/40 bg-muted/15 px-4 py-3">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-[28px] font-semibold tracking-tight",
          valueClass,
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/80">
        {sub}
      </div>
      <Sparkline tone={tone} />
    </div>
  );
}

/** Cheap inline SVG sparkline — pseudo-random but stable per render. */
function Sparkline({ tone }: { tone: "success" | "info" }) {
  const points = useMemo(() => {
    const arr: number[] = [];
    let v = 50;
    for (let i = 0; i < 40; i++) {
      v += (Math.random() - 0.5) * 12;
      v = Math.max(20, Math.min(80, v));
      arr.push(v);
    }
    return arr;
  }, []);
  const stroke = tone === "success" ? "stroke-success" : "stroke-info";
  const fill = tone === "success" ? "fill-success/15" : "fill-info/15";
  const w = 200;
  const h = 40;
  const stepX = w / (points.length - 1);
  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${i * stepX} ${h - ((p - 20) / 60) * h}`,
    )
    .join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg
      className="mt-2 h-8 w-full"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <path d={area} className={fill} />
      <path d={path} fill="none" strokeWidth="1.5" className={stroke} />
    </svg>
  );
}

function SubPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/15 px-4 py-3.5">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
        {title}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function StatusBarChart() {
  // 24 stacked bars, mostly 2xx success-green with thin tops for 3xx/4xx/5xx.
  const bars = useMemo(
    () =>
      Array.from({ length: 24 }, () => {
        const h = 30 + Math.random() * 70;
        return {
          total: h,
          s2xx: h * (0.9 + Math.random() * 0.08),
          s3xx: h * 0.03,
          s4xx: h * 0.025,
          s5xx: h * 0.005,
        };
      }),
    [],
  );
  return (
    <div className="flex h-24 items-end gap-1">
      {bars.map((b, i) => (
        <div
          key={i}
          className="flex h-full flex-1 flex-col-reverse justify-start"
        >
          <div className="bg-success" style={{ height: `${b.s2xx}%` }} />
          <div className="bg-info" style={{ height: `${b.s3xx}%` }} />
          <div className="bg-warning" style={{ height: `${b.s4xx}%` }} />
          <div className="bg-destructive" style={{ height: `${b.s5xx}%` }} />
        </div>
      ))}
    </div>
  );
}

function LegendDot({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn("size-1.5 self-center rounded-full", color)} />
      <span className="text-foreground/80">{label}</span>
      <span className="text-muted-foreground">{value}</span>
    </span>
  );
}

// ─── Variables tab ───────────────────────────────────────────────────────────

interface EnvVar {
  name: string;
  value: string;
  type: "plain" | "secret";
  scope: "project" | "service";
}

const PROJECT_VARS: EnvVar[] = [
  { name: "NODE_ENV", value: "production", type: "plain", scope: "project" },
  {
    name: "DATABASE_URL",
    value: "postgres://••••@postgres.gravy-truck.internal:5432/app",
    type: "secret",
    scope: "project",
  },
  {
    name: "REDIS_URL",
    value: "redis://redis.gravy-truck.internal:6379/0",
    type: "plain",
    scope: "project",
  },
  {
    name: "SENTRY_DSN",
    value: "••••••••••••••••••",
    type: "secret",
    scope: "project",
  },
];

const SERVICE_VARS: EnvVar[] = [
  { name: "PORT", value: "3000", type: "plain", scope: "service" },
  { name: "LOG_LEVEL", value: "info", type: "plain", scope: "service" },
];

// Postgres Variables tab — Railway-style layout.
//
// Two sections:
//   1. Service Variables — what consumers see when they reference the DB.
//      Derived from the resource credentials + connection strings; matches
//      the env names libpq + standard Postgres images expect (PG* and
//      POSTGRES_*).
//   2. System variables — otterstack-injected metadata about the container
//      itself (private/public domains, ports, ids, volume).
//
// Both lists are read-only for v1: rotating any of these requires recreating
// the database. The "+ New Variable" button is gated until the project
// secrets surface lands and we have somewhere meaningful for user-added
// service-scoped vars to live.

interface DerivedVar {
  name: string;
  value: string;
  secret: boolean;
  description?: string;
}

// Engine identity envs the swarm spec actually injects. Mirrors the
// per-engine adapter in packages/api/src/swarm/database-engines/. Keep
// these two in sync — backend reality first, this is just the display.
function buildEngineServiceVars(
  resource: ResourceBodyProps["resource"],
): DerivedVar[] {
  switch (resource.engine) {
    case "postgres":
      return [
        { name: "POSTGRES_USER", value: resource.username, secret: false },
        { name: "POSTGRES_PASSWORD", value: resource.password, secret: true },
        { name: "POSTGRES_DB", value: resource.databaseName, secret: false },
        {
          name: "DATABASE_URL",
          value: resource.internalConnectionString,
          secret: true,
        },
      ];
    case "redis":
      // Redis authenticates via --requirepass (the swarm adapter sets it
      // on Command, not Env). We surface it here as a "REDIS_PASSWORD" so
      // consumer services have a canonical key to reference.
      return [
        { name: "REDIS_PASSWORD", value: resource.password, secret: true },
        {
          name: "REDIS_URL",
          value: resource.internalConnectionString,
          secret: true,
        },
      ];
    case "mariadb":
      return [
        { name: "MARIADB_USER", value: resource.username, secret: false },
        { name: "MARIADB_PASSWORD", value: resource.password, secret: true },
        {
          name: "MARIADB_ROOT_PASSWORD",
          value: resource.password,
          secret: true,
        },
        {
          name: "MARIADB_DATABASE",
          value: resource.databaseName,
          secret: false,
        },
        {
          name: "DATABASE_URL",
          value: resource.internalConnectionString,
          secret: true,
        },
      ];
    case "mongodb":
      return [
        {
          name: "MONGO_INITDB_ROOT_USERNAME",
          value: resource.username,
          secret: false,
        },
        {
          name: "MONGO_INITDB_ROOT_PASSWORD",
          value: resource.password,
          secret: true,
        },
        {
          name: "MONGO_INITDB_DATABASE",
          value: resource.databaseName,
          secret: false,
        },
        {
          name: "MONGODB_URI",
          value: resource.internalConnectionString,
          secret: true,
        },
      ];
  }
}

function PostgresVariablesTabBody({
  resource,
}: {
  resource: ResourceBodyProps["resource"];
}) {
  // Persisted user-editable envs. Refetches the resource list on success so
  // the new env shows up across every panel + the graph.
  const setExtraEnvMut = useMutation(
    orpc.project.resource.database.postgres.setExtraEnv.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: orpc.project.resource.list.queryKey({
            input: { projectId: resource.projectId },
          }),
        });
        toast.success("Variable applied — service redeploying");
      },
      onError: (err) => toast.error(err.message ?? "Failed to set variable"),
    }),
  );
  const unsetExtraEnvMut = useMutation(
    orpc.project.resource.database.postgres.unsetExtraEnv.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: orpc.project.resource.list.queryKey({
            input: { projectId: resource.projectId },
          }),
        });
        toast.success("Variable removed — service redeploying");
      },
      onError: (err) => toast.error(err.message ?? "Failed to remove variable"),
    }),
  );

  const userEnv = resource.extraEnv ?? {};
  const userEnvEntries = Object.entries(userEnv).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const submitAdd = () => {
    if (!newKey || setExtraEnvMut.isPending) return;
    setExtraEnvMut.mutate(
      {
        projectId: resource.projectId,
        resourceId: resource.resourceId,
        key: newKey,
        value: newValue,
      },
      {
        onSuccess: () => {
          setAdding(false);
          setNewKey("");
          setNewValue("");
        },
      },
    );
  };

  const submitEdit = (key: string) => {
    if (setExtraEnvMut.isPending) return;
    setExtraEnvMut.mutate(
      {
        projectId: resource.projectId,
        resourceId: resource.resourceId,
        key,
        value: editValue,
      },
      { onSuccess: () => setEditingKey(null) },
    );
  };

  // Engine-specific identity envs — these mirror what the swarm spec
  // adapter (packages/api/src/swarm/database-engines/<engine>.ts) actually
  // injects into the container. Plus a derived URL key so consumer
  // services can reference one canonical connection string.
  const serviceVars: DerivedVar[] = buildEngineServiceVars(resource);

  const systemVars: DerivedVar[] = [
    {
      name: "OTTERSTACK_PRIVATE_DOMAIN",
      value: resource.internalHostname,
      secret: false,
      description: "The private DNS name of the service.",
    },
    {
      name: "OTTERSTACK_TCP_PROXY_DOMAIN",
      value: resource.publicHostname,
      secret: false,
      description:
        "The public TCP proxy domain for the service, if applicable. Always reached over 443 — no port needed.",
    },
    {
      name: "OTTERSTACK_TCP_APPLICATION_PORT",
      value: String(resource.internalPort),
      secret: false,
      description: "The internal port the database listens on.",
    },
    {
      name: "OTTERSTACK_PROJECT_ID",
      value: resource.projectId,
      secret: false,
      description: "The project this resource belongs to.",
    },
    {
      name: "OTTERSTACK_RESOURCE_NAME",
      value: resource.name,
      secret: false,
      description: "The resource name.",
    },
    {
      name: "OTTERSTACK_RESOURCE_ID",
      value: resource.resourceId,
      secret: false,
      description: "The resource ID.",
    },
    {
      name: "OTTERSTACK_SERVICE_NAME",
      value: resource.runtime.serviceName,
      secret: false,
      description: "The swarm service name.",
    },
    {
      name: "OTTERSTACK_NETWORK_NAME",
      value: resource.runtime.networkName,
      secret: false,
      description: "The internal swarm overlay network.",
    },
    {
      name: "OTTERSTACK_VOLUME_NAME",
      value: resource.runtime.volumeName,
      secret: false,
      description: "The name of the attached volume.",
    },
    {
      name: "OTTERSTACK_VOLUME_MOUNT_PATH",
      value: "/var/lib/postgresql/data",
      secret: false,
      description: "The mount path of the attached volume.",
    },
  ];

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(true);
  const [hintDismissed, setHintDismissed] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const matches = (name: string) =>
    !query || name.toLowerCase().includes(query.toLowerCase());

  const filteredService = serviceVars.filter((v) => matches(v.name));
  const filteredSystem = systemVars.filter((v) => matches(v.name));

  const toggleReveal = (name: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // Inline copy affordance — the button itself flashes a tick for ~1.4s,
  // no global toast. Per-key so multiple in-flight copies stay visually
  // independent.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyValue = (value: string, name: string) => {
    void navigator.clipboard?.writeText(value);
    setCopiedKey(name);
    window.setTimeout(() => {
      setCopiedKey((cur) => (cur === name ? null : cur));
    }, 1400);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header row — count + search + actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold">
            {serviceVars.length} Service Variables
          </span>
          <button
            type="button"
            onClick={() => setSearchOpen((p) => !p)}
            className="grid size-7 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
            aria-label="Search variables"
          >
            <HugeiconsIcon
              icon={Search01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
          </button>
        </div>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-[12px]"
          onClick={() => {
            setAdding(true);
            setEditingKey(null);
          }}
        >
          <HugeiconsIcon
            icon={PlusSignIcon}
            strokeWidth={2}
            className="size-3.5"
          />
          New Variable
        </Button>
      </div>

      {/* Inline search (revealed by the magnifier) */}
      {searchOpen && (
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by variable name…"
          className="h-9 font-mono text-[12.5px]"
        />
      )}

      {/* Hint banner — only relevant before any consumer service exists */}
      {!hintDismissed && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[12.5px]">
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={Link01Icon}
              strokeWidth={2}
              className="size-3.5 text-primary"
            />
            <span className="text-foreground/80">
              Trying to connect this database to a service? Add a{" "}
              <button
                type="button"
                className="font-medium text-primary underline underline-offset-2"
              >
                Variable Reference
              </button>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setHintDismissed(true)}
            aria-label="Dismiss"
            className="grid size-6 place-items-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
          </button>
        </div>
      )}

      {/* Service Variables card */}
      <div className="overflow-hidden rounded-lg border border-border/40">
        {filteredService.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">
            No variables match “{query}”.
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {filteredService.map((v) => (
              <PostgresVarRow
                key={v.name}
                v={v}
                revealed={revealed.has(v.name)}
                copied={copiedKey === v.name}
                onToggleReveal={() => toggleReveal(v.name)}
                onCopy={() => copyValue(v.value, v.name)}
              />
            ))}
          </div>
        )}
      </div>

      {/* User variables — editable, persisted, rolls the swarm task on change */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold">
              {userEnvEntries.length} User Variables
            </span>
            <span className="text-[12.5px] text-muted-foreground">
              · injected alongside POSTGRES_USER / PASSWORD / DB
            </span>
          </div>
          {!adding && userEnvEntries.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-[12px]"
              onClick={() => {
                setAdding(true);
                setEditingKey(null);
              }}
            >
              <HugeiconsIcon
                icon={PlusSignIcon}
                strokeWidth={2}
                className="size-3"
              />
              Add
            </Button>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-border/40">
          {adding && (
            <div className="flex items-center gap-2 border-b border-border/30 bg-muted/20 px-4 py-2.5">
              <span className="font-mono text-[11px] text-muted-foreground/50">
                {`{}`}
              </span>
              <Input
                autoFocus
                value={newKey}
                onChange={(e) => setNewKey(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitAdd();
                  if (e.key === "Escape") setAdding(false);
                }}
                placeholder="MY_ENV_KEY"
                className="h-8 w-56 font-mono text-[12.5px]"
              />
              <Input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitAdd();
                  if (e.key === "Escape") setAdding(false);
                }}
                placeholder="value"
                className="h-8 flex-1 font-mono text-[12px]"
              />
              <Button
                size="sm"
                className="h-8 text-[12px]"
                disabled={!newKey || setExtraEnvMut.isPending}
                onClick={submitAdd}
              >
                {setExtraEnvMut.isPending ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-[12px]"
                onClick={() => {
                  setAdding(false);
                  setNewKey("");
                  setNewValue("");
                }}
              >
                Cancel
              </Button>
            </div>
          )}

          {userEnvEntries.length === 0 && !adding ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <span className="text-[12.5px] text-muted-foreground">
                No user variables yet — add tuning knobs like{" "}
                <code className="font-mono">POSTGRES_INITDB_ARGS</code>,{" "}
                <code className="font-mono">TZ</code>, or{" "}
                <code className="font-mono">POSTGRES_HOST_AUTH_METHOD</code>.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-[12px]"
                onClick={() => setAdding(true)}
              >
                <HugeiconsIcon
                  icon={PlusSignIcon}
                  strokeWidth={2}
                  className="size-3"
                />
                Add your first variable
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {userEnvEntries.map(([key, value]) => {
                const isEditing = editingKey === key;
                const isRevealed = revealed.has(key);
                return (
                  <div
                    key={key}
                    className="group flex items-center gap-3 px-4 py-2.5"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground/50">
                      {`{}`}
                    </span>
                    <span className="w-56 truncate font-mono text-[12.5px] text-foreground/90">
                      {key}
                    </span>
                    {isEditing ? (
                      <>
                        <Input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") submitEdit(key);
                            if (e.key === "Escape") setEditingKey(null);
                          }}
                          className="h-7 flex-1 font-mono text-[12px]"
                        />
                        <Button
                          size="sm"
                          className="h-7 text-[12px]"
                          disabled={setExtraEnvMut.isPending}
                          onClick={() => submitEdit(key)}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[12px]"
                          onClick={() => setEditingKey(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingKey(key);
                            setEditValue(value);
                            setAdding(false);
                          }}
                          className="flex-1 truncate text-left font-mono text-[12px] text-muted-foreground hover:text-foreground"
                          title="Click to edit"
                        >
                          {isRevealed ? value : "•••••••"}
                        </button>
                        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => toggleReveal(key)}
                            aria-label={isRevealed ? "Hide" : "Reveal"}
                            className="grid size-7 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
                          >
                            <HugeiconsIcon
                              icon={isRevealed ? ViewOffIcon : ViewIcon}
                              strokeWidth={2}
                              className="size-3.5"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => copyValue(value, key)}
                            aria-label={copiedKey === key ? "Copied" : "Copy"}
                            className={cn(
                              "grid size-7 place-items-center rounded transition-colors",
                              copiedKey === key
                                ? "text-primary"
                                : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
                            )}
                          >
                            <HugeiconsIcon
                              icon={copiedKey === key ? Tick02Icon : Copy01Icon}
                              strokeWidth={2}
                              className="size-3.5"
                            />
                          </button>
                          <button
                            type="button"
                            disabled={unsetExtraEnvMut.isPending}
                            onClick={() =>
                              unsetExtraEnvMut.mutate({
                                projectId: resource.projectId,
                                resourceId: resource.resourceId,
                                key,
                              })
                            }
                            aria-label={`Delete ${key}`}
                            className="grid size-7 place-items-center rounded text-muted-foreground/70 hover:bg-destructive/15 hover:text-destructive"
                          >
                            <HugeiconsIcon
                              icon={Delete02Icon}
                              strokeWidth={2}
                              className="size-3.5"
                            />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* System variables — collapsible */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setSystemOpen((p) => !p)}
          className="flex items-center gap-2 self-start text-[13px] font-medium text-primary hover:text-primary/80"
        >
          <HugeiconsIcon
            icon={systemOpen ? ArrowDown01Icon : ArrowRight01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
          {systemVars.length} variables added by otterstack
        </button>

        {systemOpen && (
          <>
            <p className="text-[12.5px] text-muted-foreground">
              otterstack injects these system variables into every container —
              read-only and derived from the resource record.
            </p>
            {filteredSystem.length === 0 ? (
              <div className="rounded-lg border border-border/40 px-4 py-6 text-center text-[12.5px] text-muted-foreground">
                No system variables match “{query}”.
              </div>
            ) : (
              <div className="flex flex-col">
                {filteredSystem.map((v) => (
                  <PostgresSystemVarRow
                    key={v.name}
                    v={v}
                    revealed={revealed.has(v.name)}
                    copied={copiedKey === v.name}
                    onToggleReveal={() => toggleReveal(v.name)}
                    onCopy={() => copyValue(v.value, v.name)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PostgresVarRow({
  v,
  revealed,
  copied,
  onToggleReveal,
  onCopy,
}: {
  v: { name: string; value: string; secret: boolean };
  revealed: boolean;
  copied: boolean;
  onToggleReveal: () => void;
  onCopy: () => void;
}) {
  const display = v.secret && !revealed ? "•••••••" : v.value;
  return (
    <div className="group flex items-center gap-3 px-4 py-2.5">
      <span className="font-mono text-[11px] text-muted-foreground/50">
        {`{}`}
      </span>
      <span className="w-56 truncate font-mono text-[12.5px] text-foreground/90">
        {v.name}
      </span>
      <span className="flex-1 truncate font-mono text-[12px] text-muted-foreground">
        {display}
      </span>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {v.secret && (
          <button
            type="button"
            onClick={onToggleReveal}
            aria-label={revealed ? "Hide value" : "Reveal value"}
            className="grid size-7 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon
              icon={revealed ? ViewOffIcon : ViewIcon}
              strokeWidth={2}
              className="size-3.5"
            />
          </button>
        )}
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? "Copied" : `Copy ${v.name}`}
          className={cn(
            "grid size-7 place-items-center rounded transition-colors",
            copied
              ? "text-primary"
              : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
          )}
        >
          <HugeiconsIcon
            icon={copied ? Tick02Icon : Copy01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
        </button>
        <button
          type="button"
          aria-label="Variable info"
          className="grid size-7 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        >
          <HugeiconsIcon
            icon={InformationCircleIcon}
            strokeWidth={2}
            className="size-3.5"
          />
        </button>
      </div>
      <button
        type="button"
        aria-label="More actions"
        className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground"
      >
        <HugeiconsIcon
          icon={MoreVerticalIcon}
          strokeWidth={2}
          className="size-3.5"
        />
      </button>
    </div>
  );
}

function PostgresSystemVarRow({
  v,
  revealed,
  copied,
  onToggleReveal,
  onCopy,
}: {
  v: { name: string; value: string; secret: boolean; description?: string };
  revealed: boolean;
  copied: boolean;
  onToggleReveal: () => void;
  onCopy: () => void;
}) {
  const display = v.secret && !revealed ? "•••••••" : v.value;
  return (
    <div className="group flex items-start gap-3 border-b border-border/30 py-3 last:border-b-0">
      <div className="flex w-56 flex-col gap-0.5">
        <span className="font-mono text-[12px] text-foreground/90">
          {v.name}
        </span>
        {v.description && (
          <span className="text-[11.5px] leading-snug text-muted-foreground/80">
            {v.description}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex flex-1 items-center gap-1.5">
        <span className="truncate rounded border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[12px] text-muted-foreground">
          {display}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {v.secret && (
            <button
              type="button"
              onClick={onToggleReveal}
              aria-label={revealed ? "Hide value" : "Reveal value"}
              className="grid size-6 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
            >
              <HugeiconsIcon
                icon={revealed ? ViewOffIcon : ViewIcon}
                strokeWidth={2}
                className="size-3"
              />
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            aria-label={copied ? "Copied" : `Copy ${v.name}`}
            className={cn(
              "grid size-6 place-items-center rounded transition-colors",
              copied
                ? "text-primary"
                : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
            )}
          >
            <HugeiconsIcon
              icon={copied ? Tick02Icon : Copy01Icon}
              strokeWidth={2}
              className="size-3"
            />
          </button>
        </div>
      </div>
      <button
        type="button"
        className="mt-0.5 shrink-0 rounded border border-border/50 bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
      >
        Reference
      </button>
    </div>
  );
}

function VariablesTabBody({ projectName }: { projectName: string }) {
  return (
    <div className="flex flex-col gap-5">
      {/* Shared from project */}
      <div className="rounded-lg border border-border/40">
        <div className="flex items-start justify-between gap-3 px-5 py-4">
          <div>
            <div className="text-[14px] font-semibold">Shared from project</div>
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">
              Inherited by every service in{" "}
              <span className="font-semibold text-foreground/80">
                {projectName}
              </span>
              . Edit at the project level.
            </div>
          </div>
          <Button variant="outline" size="sm">
            Open project vars
          </Button>
        </div>
        <div className="divide-y divide-border/30 border-t border-border/30">
          {PROJECT_VARS.map((v) => (
            <VarRow key={v.name} v={v} action="override" />
          ))}
        </div>
      </div>

      {/* Service-only */}
      <div className="rounded-lg border border-border/40">
        <div className="flex items-start justify-between gap-3 px-5 py-4">
          <div>
            <div className="text-[14px] font-semibold">api-only</div>
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">
              Visible only to this service. Overrides project vars with the same
              key.
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5">
            <HugeiconsIcon
              icon={PlusSignIcon}
              strokeWidth={2}
              className="size-3.5"
            />
            Add variable
          </Button>
        </div>
        <div className="divide-y divide-border/30 border-t border-border/30">
          {SERVICE_VARS.map((v) => (
            <VarRow key={v.name} v={v} action="edit" />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <span className="text-[12.5px] text-muted-foreground">
          Changes apply on next deploy.
        </span>
        <Button size="sm">Apply & redeploy</Button>
      </div>
    </div>
  );
}

function VarRow({ v, action }: { v: EnvVar; action: "override" | "edit" }) {
  return (
    <div className="grid grid-cols-[160px_1fr_80px_80px_80px] items-center gap-4 px-5 py-2.5">
      <span className="font-mono text-[12.5px] text-foreground/80">
        {v.name}
      </span>
      <span
        className={cn(
          "truncate font-mono text-xs",
          v.type === "secret"
            ? "rounded bg-muted/60 px-1.5 py-0.5 text-muted-foreground"
            : "text-muted-foreground",
        )}
      >
        {v.value}
      </span>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground/60">
        {v.type}
      </span>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground/60">
        {v.scope}
      </span>
      <button
        type="button"
        className="text-left font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {action === "override" ? "↪ override" : "edit"}
      </button>
    </div>
  );
}

// ─── Terminal tab ────────────────────────────────────────────────────────────
// Real exec console backed by the same terminalContainersCollection the global
// Terminal page uses. Two ways to find the container:
//   - "service": a service resource — match by resource id label.
//   - "postgres": a database resource — postgres containers carry no
//     resource-id label, so match by swarm service name + resourceType.
// "Reconnect" remounts <TerminalSession> so the WebSocket + PTY are recycled.

type ResourceTerminalMatch =
  | { kind: "service"; resourceId: string }
  | { kind: "postgres"; serviceName: string };

function ResourceTerminal({
  match,
  fallbackLabel,
}: {
  match: ResourceTerminalMatch;
  fallbackLabel: string;
}) {
  const { projectSlug } = Route.useParams();
  const { data: containers = [] } = useLiveQuery(
    () => terminalContainersCollection,
  );

  const target = useMemo(() => {
    if (match.kind === "service") {
      return containers.find(
        (c) =>
          c.resourceType === "service" &&
          c.serviceResourceId === match.resourceId,
      );
    }
    return containers.find(
      (c) =>
        c.resourceType === "postgres" && c.serviceName === match.serviceName,
    );
  }, [containers, match]);

  // Bump to remount <TerminalSession> — clean way to recycle the WebSocket.
  const [generation, setGeneration] = useState(0);

  const headerLabel = target
    ? `sh · ${target.name}${target.replicaSlot ? `.${target.replicaSlot}` : ""}`
    : `sh · ${fallbackLabel}`;

  return (
    <div className="flex flex-col gap-0 overflow-hidden rounded-lg border border-border/40 bg-[oklch(0.12_0_0)]">
      <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-muted/10 px-3 py-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {headerLabel}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={!target}
            onClick={() => setGeneration((g) => g + 1)}
          >
            Reconnect
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={!target}
            onClick={() => setGeneration((g) => g + 1)}
          >
            Clear
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Fullscreen">
            <HugeiconsIcon
              icon={Maximize01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
          </Button>
        </div>
      </div>
      <div className="relative h-[460px]">
        {target ? (
          <TerminalSession
            key={`${target.containerId}:${generation}`}
            source={
              {
                kind: "container",
                project: projectSlug,
                service: target.serviceName ?? target.name,
                replica: target.replicaSlot ?? "1",
                containerId: target.containerId,
              } satisfies SessionSource
            }
            active
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <span className="font-mono text-[12px] text-muted-foreground/80">
              No running container.
            </span>
            <span className="text-[11.5px] text-muted-foreground/60">
              Once a task is scheduled for this resource, the shell will open
              automatically.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Settings tab ────────────────────────────────────────────────────────────

const SETTINGS_SECTIONS = [
  "Source",
  "Build",
  "Health",
  "Resources",
  "Networking",
  "Scale",
  "Deploy",
  "Feature flags",
  "Danger zone",
] as const;

const BUILDERS = [
  {
    id: "railpack",
    name: "Railpack",
    sub: "Auto-detect Node, Python, Go, Rust, Ruby, Elixir",
  },
  {
    id: "dockerfile",
    name: "Dockerfile",
    sub: "Use the Dockerfile in the repo",
  },
  { id: "nixpacks", name: "Nixpacks", sub: "Reproducible builds via Nix" },
  {
    id: "compose",
    name: "docker-compose",
    sub: "Pull a service from the compose file",
  },
] as const;

const DEPLOY_STRATEGIES = [
  {
    id: "rolling",
    name: "Rolling",
    sub: "Replace replicas N at a time. Default.",
  },
  {
    id: "bluegreen",
    name: "Blue / green",
    sub: "Spin up new fleet, switch traffic, drain old.",
  },
  {
    id: "canary",
    name: "Canary",
    sub: "Send % of traffic to new version, ramp.",
  },
  {
    id: "recreate",
    name: "Recreate",
    sub: "Stop all replicas, start new. Has downtime.",
  },
] as const;

function SettingsTabBody({
  node,
  meta,
}: {
  node: ResourceNodeData;
  meta: ReturnType<typeof demoMeta>;
}) {
  const [builder, setBuilder] =
    useState<(typeof BUILDERS)[number]["id"]>("railpack");
  const [strategy, setStrategy] =
    useState<(typeof DEPLOY_STRATEGIES)[number]["id"]>("rolling");

  return (
    <div className="grid grid-cols-[1fr_140px] gap-6 pb-10">
      <div className="flex flex-col gap-7">
        {/* Filter */}
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Filter Settings…"
            className="h-8 bg-muted/20 pl-8 pr-9"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            /
          </kbd>
        </div>

        {/* Source */}
        <SettingsBlock title="Source">
          <SettingsRow label="Repository" value={meta.repo} mono />
          <SettingsRow label="Branch" value={node.git?.branch ?? "main"} />
          <SettingsRow
            label="Auto-deploy on push"
            value="Enabled"
            tone="primary"
          />
        </SettingsBlock>

        {/* Build */}
        <SettingsBlock title="Build">
          <SubLabel>Builder</SubLabel>
          <div className="grid grid-cols-2 gap-2.5">
            {BUILDERS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBuilder(b.id)}
                className={cn(
                  "rounded-lg border bg-card p-3 text-left transition-colors hover:border-ring",
                  builder === b.id
                    ? "border-primary bg-primary/5"
                    : "border-border/60",
                )}
              >
                <div className="text-[13px] font-semibold">{b.name}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {b.sub}
                </div>
              </button>
            ))}
          </div>

          <SubLabel className="mt-5">Source</SubLabel>
          <Field
            label="Root directory"
            hint="Path inside the repo to build from"
          >
            <Input className="h-8 font-mono" defaultValue="./" />
          </Field>

          <SubLabel className="mt-5">Commands</SubLabel>
          <Field
            label="Install command"
            hint="Inferred — pnpm install / pip install / cargo fetch"
          >
            <Input className="h-8 font-mono" defaultValue="auto-detected" />
          </Field>
          <Field
            label="Build command"
            hint="Inferred — pnpm build / cargo build --release"
          >
            <Input className="h-8 font-mono" defaultValue="auto-detected" />
          </Field>
          <Field
            label="Start command"
            hint="Override what runs when the container starts"
          >
            <Input
              className="h-8 font-mono"
              defaultValue="node dist/index.js"
            />
          </Field>

          <SubLabel className="mt-5">Build args</SubLabel>
          <div className="flex items-center gap-2">
            <Input className="h-8 w-44 font-mono" defaultValue="NODE_VERSION" />
            <Input className="h-8 flex-1 font-mono" defaultValue="22" />
            <Button variant="ghost" size="icon-sm" aria-label="Remove arg">
              ×
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Build args are passed to{" "}
            <span className="font-mono text-foreground/80">
              docker build --build-arg
            </span>
            . They aren't available at runtime — use Variables for that.
          </p>
        </SettingsBlock>

        {/* Health */}
        <SettingsBlock title="Health">
          <div className="flex items-center justify-between rounded-lg border border-border/40 px-4 py-3">
            <div>
              <div className="text-[13px] font-medium">Health probe</div>
              <div className="text-[11.5px] text-muted-foreground">
                Otterstack pings this every{" "}
                <span className="text-foreground/80">15s</span>. Replicas that
                fail 3 consecutive checks are restarted.
              </div>
            </div>
            <Toggle on label="enabled" />
          </div>
        </SettingsBlock>

        {/* Resources */}
        <SettingsBlock title="Resources">
          <CapacityBar
            label="CPU"
            value="2 vCPU"
            sub="Cluster has 32 vCPU across 3 nodes · 22 free"
            pct={(2 / 32) * 100}
          />
          <CapacityBar
            label="Memory"
            value="2 GB"
            sub="Cluster has 64 GB across 3 nodes · 41 GB free"
            pct={(2 / 64) * 100}
          />
        </SettingsBlock>

        {/* Networking */}
        <SettingsBlock title="Networking">
          <SubLabel>Internal</SubLabel>
          <SettingsRow
            label="Hostname"
            value={`${node.name}.gravy-truck.internal`}
            mono
          />
          <SettingsRow label="Upstream port" value="3000" mono />
          <SettingsRow label="Network" value={`otterstack-${node.name}`} mono />

          <SubLabel className="mt-5">
            Public route{" "}
            <span className="font-mono text-muted-foreground/60">
              via caddy
            </span>
          </SubLabel>
          <SettingsRow label="Domain" value={meta.domain ?? "—"} mono />
          <SettingsRow label="Type" value="HTTP" />
          <SettingsRow label="TLS" value="Auto · Let's Encrypt" />
          <SettingsRow
            label="Status"
            value={
              <span className="rounded bg-success/15 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-success">
                Certified
              </span>
            }
          />
          <div className="mt-2 flex items-center gap-2">
            <Button variant="outline" size="sm">
              + Add custom domain
            </Button>
            <Button variant="outline" size="sm">
              View Caddyfile
            </Button>
          </div>
        </SettingsBlock>

        {/* Scale */}
        <SettingsBlock title="Scale">
          <div className="flex items-center justify-between">
            <div>
              <SubLabel>Autoscaling</SubLabel>
              <p className="mt-1 text-xs text-muted-foreground">
                Currently running <span className="text-foreground/80">1</span>{" "}
                replicas. When CPU % stays above 70% for 60s, replicas grow up
                to 8. They shrink back to 2 when below 30%.
              </p>
            </div>
            <Toggle on label="enabled" />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Min replicas">
              <Input className="h-8 font-mono" defaultValue="2" />
            </Field>
            <Field label="Max replicas">
              <Input className="h-8 font-mono" defaultValue="8" />
            </Field>
          </div>

          <SubLabel className="mt-4">Trigger metric</SubLabel>
          <div className="flex items-center gap-2">
            <PillButton active>CPU %</PillButton>
            <PillButton>Memory %</PillButton>
            <PillButton>Requests / sec</PillButton>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <Field label="Scale up above (%)">
              <Input className="h-8 font-mono" defaultValue="70" />
            </Field>
            <Field label="Scale down below (%)">
              <Input className="h-8 font-mono" defaultValue="30" />
            </Field>
            <Field label="Cooldown (s)" hint="Pause between scale events.">
              <Input className="h-8 font-mono" defaultValue="120" />
            </Field>
          </div>
        </SettingsBlock>

        {/* Deploy */}
        <SettingsBlock title="Deploy">
          <div className="grid grid-cols-2 gap-2.5">
            {DEPLOY_STRATEGIES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStrategy(s.id)}
                className={cn(
                  "rounded-lg border bg-card p-3 text-left transition-colors hover:border-ring",
                  strategy === s.id
                    ? "border-primary bg-primary/5"
                    : "border-border/60",
                )}
              >
                <div className="text-[13px] font-semibold">{s.name}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {s.sub}
                </div>
              </button>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <Field label="Parallelism" hint="Replicas updated together">
              <Input className="h-8 font-mono" defaultValue="1" />
            </Field>
            <Field label="Max unavailable">
              <Input className="h-8 font-mono" defaultValue="0" />
            </Field>
            <Field label="Drain (s)" hint="Time given to graceful shutdown">
              <Input className="h-8 font-mono" defaultValue="30" />
            </Field>
          </div>
        </SettingsBlock>

        {/* Feature flags */}
        <SettingsBlock title="Feature flags">
          <FeatureFlag
            title="Run at edge (PoP)"
            sub="Replicate this service to every PoP for cold-start <50ms reads."
          />
          <FeatureFlag
            title="Verbose debug logs"
            sub="Includes request bodies and stack frames in stderr."
          />
          <FeatureFlag
            title="Shadow traffic to staging"
            sub="Mirror 5% of prod requests to the staging environment."
          />
        </SettingsBlock>

        {/* Danger zone */}
        <SettingsBlock title="Danger zone" tone="destructive">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              Pause service
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Delete service
            </Button>
          </div>
        </SettingsBlock>
      </div>

      {/* Right rail nav */}
      <nav className="sticky top-0 self-start text-[12.5px]">
        <ul className="flex flex-col gap-1.5">
          {SETTINGS_SECTIONS.map((s, i) => (
            <li key={s}>
              <a
                href={`#${s.toLowerCase().replace(/ /g, "-")}`}
                className={cn(
                  "block text-right transition-colors hover:text-foreground",
                  i === 4
                    ? "border-r-2 border-foreground pr-3 font-medium text-foreground"
                    : "pr-3 text-muted-foreground",
                )}
              >
                {s}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function SettingsBlock({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "destructive";
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3
        className={cn(
          "text-[15px] font-semibold",
          tone === "destructive" && "text-destructive",
        )}
      >
        {title}
      </h3>
      <div className="mt-3 flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

function SettingsRow({
  label,
  value,
  mono = false,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  tone?: "primary";
}) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-center gap-4 border-b border-border/30 pb-2.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-[13px]",
          mono ? "font-mono text-foreground/90" : "text-foreground",
          tone === "primary" && "text-primary",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function SubLabel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

function Toggle({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
          on ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "inline-block size-3 rounded-full bg-background transition-transform",
            on ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

function CapacityBar({
  label,
  value,
  sub,
  pct,
}: {
  label: string;
  value: string;
  sub: string;
  pct: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
          {label}:{" "}
          <span className="font-semibold text-foreground">{value}</span>
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {sub}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary/70"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PillButton({
  active,
  children,
}: {
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FeatureFlag({ title, sub }: { title: string; sub: string }) {
  const [on, setOn] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOn((s) => !s)}
      className="flex items-center justify-between rounded-lg border border-border/40 px-4 py-3 text-left transition-colors hover:border-border"
    >
      <span
        className={cn(
          "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
          on ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "inline-block size-3 rounded-full bg-background transition-transform",
            on ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
      <div className="ml-4 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="text-[11.5px] text-muted-foreground">{sub}</div>
      </div>
    </button>
  );
}

// ─── Real-resource (postgres) panel ──────────────────────────────────────────

interface ResourceBodyProps {
  resource: {
    resourceId: string;
    projectId: string;
    name: string;
    engine: string;
    status: string;
    databaseName: string;
    username: string;
    password: string;
    publicEnabled: boolean;
    publicHostname: string;
    publicPort: number;
    publicConnectionString: string;
    internalHostname: string;
    internalPort: number;
    internalConnectionString: string;
    localConnectionString: string | null;
    runtime: {
      serviceId: string | null;
      serviceName: string;
      volumeName: string;
      networkName: string;
      status: string;
      health: string | null;
    };
    extraEnv: Record<string, string>;
  };
}

function RealResourcePanel({
  resource,
  projectName,
  onClose,
}: {
  resource: ResourceBodyProps["resource"];
  projectName: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ResourceTab>("deployments");

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to graph"
            onClick={onClose}
            className="mt-1"
          >
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              strokeWidth={2}
              className="size-4"
            />
          </Button>
          <PanelIcon
            node={{
              kind: "database",
              name: resource.name,
              description: "",
              engine: resource.engine as ResourceEngine,
            }}
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-xl font-bold leading-none tracking-tight">
              {resource.name}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {resource.engine}{" "}
              <span className="text-muted-foreground/50">·</span>{" "}
              {resource.databaseName}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close panel"
          onClick={onClose}
        >
          <HugeiconsIcon
            icon={Cancel01Icon}
            strokeWidth={2}
            className="size-4"
          />
        </Button>
      </div>

      {/* ─── Status row ─────────────────────────────────────────────── */}
      <div className="mt-5 flex items-center gap-3 border-t border-border/40 px-6 py-3">
        <RuntimeStatusBadge status={resource.runtime.status} />
        <span className="text-[13px] text-muted-foreground">
          {resource.runtime.health ?? "Provisioned"}
        </span>
      </div>

      {/* ─── Tabs ───────────────────────────────────────────────────── */}
      <Tabs
        value={tab}
        onValueChange={(v) => v && setTab(v as ResourceTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b border-border/60 px-6">
          <TabsList variant="line" className="h-auto bg-transparent p-0">
            <TabsTrigger value="deployments" className="px-2.5 py-2.5">
              Deployments
            </TabsTrigger>
            <TabsTrigger value="metrics" className="px-2.5 py-2.5">
              Metrics
            </TabsTrigger>
            <TabsTrigger value="variables" className="px-2.5 py-2.5">
              Variables
            </TabsTrigger>
            <TabsTrigger value="terminal" className="px-2.5 py-2.5">
              Terminal
            </TabsTrigger>
            <TabsTrigger value="settings" className="px-2.5 py-2.5">
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContents>
            {/* ─── Deployments ────────────────────────────────────── */}
            <TabsContent value="deployments" className="px-6 pt-5 pb-6">
              <ResourceTasksTab
                projectId={resource.projectId}
                resourceId={resource.resourceId}
              />
            </TabsContent>

            {/* ─── Metrics ────────────────────────────────────────── */}
            <TabsContent value="metrics" className="px-6 pt-5 pb-6">
              <p className="text-[13px] text-muted-foreground">
                CPU, memory, and connection counts will surface here once the
                per-container stats stream is wired.
              </p>
            </TabsContent>

            {/* ─── Variables ──────────────────────────────────────── */}
            <TabsContent value="variables" className="px-6 pt-5 pb-6">
              <PostgresVariablesTabBody resource={resource} />
            </TabsContent>

            {/* ─── Terminal ───────────────────────────────────────── */}
            {/* keepMounted + <Activity> keeps the terminal session, PTY, and
                xterm scrollback alive across tab switches. Mode is driven by
                the current tab — Activity defers initial mount until the
                user first opens the Terminal tab. */}
            <TabsContent
              value="terminal"
              keepMounted
              className="px-6 pt-5 pb-6"
            >
              <Activity mode={tab === "terminal" ? "visible" : "hidden"}>
                <ResourceTerminal
                  match={{
                    kind: "postgres",
                    serviceName: resource.runtime.serviceName,
                  }}
                  fallbackLabel={resource.runtime.serviceName}
                />
              </Activity>
            </TabsContent>

            {/* ─── Settings ───────────────────────────────────────── */}
            <TabsContent value="settings" className="px-6 pt-5 pb-8">
              <PostgresSettingsBody resource={resource} onDeleted={onClose} />
            </TabsContent>
          </TabsContents>
        </div>
      </Tabs>
    </div>
  );
}

function RuntimeStatusBadge({ status }: { status: string }) {
  const tone =
    status === "running"
      ? "bg-success/12 text-success"
      : status === "starting"
        ? "bg-warning/12 text-warning"
        : status === "error"
          ? "bg-destructive/12 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={`rounded-md px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em] ${tone}`}
    >
      {status.toUpperCase()}
    </span>
  );
}

// ─── Deployments tab ────────────────────────────────────────────────────
// Backed by project.resource.deployments.list. Each row is one push of the
// resource (create / env-change / restart). Expand a row to see the swarm
// tasks scheduled under that deployment — each task expands again to show
// its own swarm progression + container logs.

interface DeploymentInfo {
  id: string;
  resourceId: string;
  image: string;
  reason: "create" | "redeploy" | "env-change" | "image-change" | "restart";
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

function ResourceTasksTab({
  projectId,
  resourceId,
}: {
  projectId: string;
  resourceId: string;
}) {
  const deploymentsCollection = useMemo(
    () => createDeploymentsCollection(projectId as never, resourceId as never),
    [projectId, resourceId],
  );
  const { data: deployments = [], status } = useLiveQuery(
    () => deploymentsCollection,
    [deploymentsCollection],
  );
  const isLoading = status === "loading" && deployments.length === 0;

  return (
    <div>
      <SectionLabel>Deployments</SectionLabel>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        One row per push of this resource to swarm. Click a deployment to see
        its tasks, then click a task to read its swarm progression + container
        logs.
      </p>
      <div className="mt-3 overflow-hidden rounded-md border bg-card">
        {isLoading ? (
          <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
            Loading deployments…
          </div>
        ) : deployments.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
            No deployments yet — once this resource is pushed to swarm, each
            push will show up here.
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {deployments.map((d) => (
              <DeploymentRow
                key={d.id}
                deployment={d}
                projectId={projectId}
                resourceId={resourceId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DeploymentRow({
  deployment,
}: {
  deployment: DeploymentInfo;
  projectId: string;
  resourceId: string;
}) {
  const { orgSlug, projectSlug, resourceId } = Route.useParams();
  return (
    <Link
      to="/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId"
      params={{
        orgSlug,
        projectSlug,
        resourceId,
        deploymentId: deployment.id,
      }}
      className="grid grid-cols-[100px_1fr_120px_140px] items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/30"
    >
      <DeploymentStatusBadge status={deployment.status} />
      <span className="truncate font-mono text-[12px] text-foreground/85">
        {deployment.image}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">
        {deployment.reason} · {deployment.taskCount}{" "}
        {deployment.taskCount === 1 ? "task" : "tasks"}
      </span>
      <span className="text-right font-mono text-[11px] text-muted-foreground">
        {new Date(deployment.createdAt).toLocaleString()}
      </span>
    </Link>
  );
}

function DeploymentStatusBadge({
  status,
}: {
  status: DeploymentInfo["status"];
}) {
  const tone =
    status === "running"
      ? "bg-success/15 text-success border-success/30"
      : status === "failed"
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : status === "building" || status === "pending"
          ? "bg-warning/15 text-warning border-warning/30"
          : "bg-muted text-muted-foreground border-border/60";
  const dot =
    status === "running"
      ? "bg-success"
      : status === "failed"
        ? "bg-destructive"
        : status === "building" || status === "pending"
          ? "bg-warning"
          : "bg-muted-foreground/60";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[10px] font-medium uppercase",
        tone,
      )}
    >
      <span className={cn("size-1.5 rounded-full", dot)} />
      {status}
    </span>
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

function ResourceTaskRow({
  task,
  projectId,
  resourceId,
}: {
  task: TaskInfo;
  projectId: string;
  resourceId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="grid grid-cols-[16px_100px_80px_1fr_140px] items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/30"
      >
        <HugeiconsIcon
          icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
          strokeWidth={2}
          className="size-3.5 text-muted-foreground"
        />
        <TaskStateBadge state={task.state} />
        <span className="font-mono text-[11.5px] text-muted-foreground">
          {task.slot != null ? `slot.${task.slot}` : "—"}
        </span>
        <span className="truncate font-mono text-[12px] text-foreground/85">
          {task.message ?? task.rawState ?? "no message"}
        </span>
        <span className="text-right font-mono text-[11px] text-muted-foreground">
          {task.timestamp ? new Date(task.timestamp).toLocaleString() : "—"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border/40 bg-muted/15 px-4 py-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 pb-3 font-mono text-[11px]">
            <TaskField label="state" value={task.rawState ?? "—"} />
            <TaskField label="desired" value={task.desiredState ?? "—"} />
            <TaskField
              label="container"
              value={
                task.containerId
                  ? task.containerId.slice(0, 12)
                  : "not yet assigned"
              }
            />
            <TaskField
              label="node"
              value={task.nodeId ? task.nodeId.slice(0, 12) : "—"}
            />
            <TaskField
              label="exit code"
              value={task.exitCode != null ? String(task.exitCode) : "—"}
              tone={
                task.exitCode != null && task.exitCode !== 0 ? "error" : "muted"
              }
            />
            <TaskField label="task id" value={task.id.slice(0, 12)} />
          </div>
          {task.error && (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-destructive/80">
                Task error
              </div>
              <div className="mt-1 font-mono text-[12px] text-destructive">
                {task.error}
              </div>
            </div>
          )}
          <TaskLogsTail
            projectId={projectId}
            resourceId={resourceId}
            taskId={task.id}
          />
        </div>
      )}
    </div>
  );
}

function TaskField({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "muted" | "error";
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-20 shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
        {label}
      </span>
      <span
        className={cn(
          "truncate",
          tone === "error" ? "text-destructive" : "text-foreground/85",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function TaskLogsTail({
  projectId,
  resourceId,
  taskId,
}: {
  projectId: string;
  resourceId: string;
  taskId: string;
}) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<
    "connecting" | "live" | "ended" | "error"
  >("connecting");
  const counterRef = useRef(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLines([]);
    setStatus("connecting");
    counterRef.current = 0;

    (async () => {
      try {
        const stream = await orpc.project.resource.taskLogs.tail.call(
          {
            projectId: projectId as never,
            resourceId: resourceId as never,
            taskId,
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
  }, [projectId, resourceId, taskId]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 pb-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
          Task logs
        </span>
        <LogStreamStatus status={status} />
      </div>
      <div className="max-h-[260px] overflow-auto rounded-md border bg-[oklch(0.12_0_0)] p-2.5 font-mono text-[11px] leading-relaxed text-foreground/85">
        {lines.length === 0 ? (
          <div className="text-muted-foreground/60">
            {status === "connecting" ? "Loading task logs…" : "No output."}
          </div>
        ) : (
          lines.map((l) => <LogRow key={l.id} line={l} />)
        )}
      </div>
    </div>
  );
}

function TaskStateBadge({
  state,
}: {
  state: "running" | "building" | "error";
}) {
  const tone =
    state === "running"
      ? "bg-success/15 text-success border-success/30"
      : state === "building"
        ? "bg-warning/15 text-warning border-warning/30"
        : "bg-destructive/15 text-destructive border-destructive/30";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[10px] font-medium uppercase",
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

// ─── Resource logs tab ─────────────────────────────────────────────────────
// Live tail of the resource's container stdout/stderr via the streaming
// project.resource.logs.tail endpoint. Auto-scrolls to bottom; pauses
// auto-scroll once the user scrolls up (lets them read old lines without
// the view jumping); Clear button drops the buffer and resumes streaming
// from the next live line.

interface LogLine {
  id: number;
  stream: "stdout" | "stderr" | "system";
  line: string;
  ts: string | null;
}

function LogRow({ line }: { line: LogLine }) {
  const tone =
    line.stream === "stderr"
      ? "text-destructive/90"
      : line.stream === "system"
        ? "text-muted-foreground italic"
        : "text-foreground/85";
  return (
    <div className={cn("flex gap-3", tone)}>
      {line.ts && (
        <span className="shrink-0 text-muted-foreground/50">
          {line.ts.replace("T", " ").replace(/\.\d+Z$/, "")}
        </span>
      )}
      <span className="break-all whitespace-pre-wrap">{line.line}</span>
    </div>
  );
}

function LogStreamStatus({
  status,
}: {
  status: "connecting" | "live" | "ended" | "error";
}) {
  const { dot, label } =
    status === "live"
      ? { dot: "bg-success", label: "live" }
      : status === "connecting"
        ? { dot: "bg-warning animate-pulse", label: "connecting" }
        : status === "ended"
          ? { dot: "bg-muted-foreground/40", label: "ended" }
          : { dot: "bg-destructive", label: "error" };
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

function NotFound({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <HugeiconsIcon
        icon={Database02Icon}
        strokeWidth={1.5}
        className="size-10 text-muted-foreground/40"
      />
      <div className="text-sm font-medium">Resource not found</div>
      <div className="max-w-sm text-xs text-muted-foreground">
        No resource with id <span className="font-mono">{id}</span> exists in
        this project.
      </div>
      <Button variant="outline" size="sm" onClick={onClose}>
        Back to graph
      </Button>
    </div>
  );
}

// ─── Settings tab ───────────────────────────────────────────────────────────
// Real operator surface for a postgres resource. Identity + storage info is
// read-only (rename / move project aren't wired); maintenance actions are
// disabled with explicit "not yet wired" labels rather than buttons that
// silently no-op; danger zone wires the existing project.resource.delete.

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
        {description && (
          <div className="mt-0.5 text-[12px] text-muted-foreground/80">
            {description}
          </div>
        )}
      </div>
      <div className="rounded-md border bg-card">{children}</div>
    </section>
  );
}

function SettingsRowReadOnly({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline gap-4 border-b border-border/40 px-3 py-2.5 last:border-b-0">
      <span className="w-40 shrink-0 text-[12px] text-muted-foreground">
        {label}
      </span>
      <span className="break-all font-mono text-[12.5px] text-foreground">
        {value}
      </span>
    </div>
  );
}

/**
 * Toggle for public exposure of the postgres resource. Calls the
 * `project.resource.database.postgres.setPublic` procedure; the backend
 * registers / unregisters the Caddy proxy route and reconciles. Optimistic
 * UI is avoided here on purpose — the operator wants to see the truth from
 * the server before believing the switch flipped.
 */
function PublicAccessCard({
  resource,
}: {
  resource: ResourceBodyProps["resource"];
}) {
  const setPublic = useMutation({
    ...orpc.project.resource.database.postgres.setPublic.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.project.resource.list.queryKey({
          input: { projectId: resource.projectId },
        }),
      });
      toast.success(
        resource.publicEnabled
          ? "Public access disabled"
          : "Public access enabled",
      );
    },
    onError: (err) => {
      toast.error(err.message ?? "Failed to update public access");
    },
  });

  return (
    <SettingsCard
      title="Public access"
      description="Off keeps the DB on the internal network only. On wires the Caddy layer-4 proxy and exposes the public hostname to the open internet."
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">Expose publicly</span>
          <span className="text-[11px] text-muted-foreground">
            {resource.publicEnabled
              ? `Reachable at ${resource.publicHostname}`
              : `Internal-only at ${resource.internalHostname}:${resource.internalPort}`}
          </span>
        </div>
        <Switch
          checked={resource.publicEnabled}
          disabled={setPublic.isPending}
          onCheckedChange={(next) =>
            setPublic.mutate({
              projectId: resource.projectId,
              resourceId: resource.resourceId,
              publicEnabled: next,
            })
          }
        />
      </div>
      {resource.publicEnabled && (
        <SettingsRowReadOnly
          label="Public endpoint"
          value={resource.publicHostname}
        />
      )}
    </SettingsCard>
  );
}

function PostgresSettingsBody({
  resource,
  onDeleted,
}: {
  resource: ResourceBodyProps["resource"];
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const canConfirm = confirmText.trim() === resource.name;

  const deleteMutation = useMutation({
    ...orpc.project.resource.delete.mutationOptions(),
    onSuccess: async () => {
      toast.success(`Deleted ${resource.name}`);
      // Bust the resource list so the graph + sidebar drop the row.
      await queryClient.invalidateQueries({
        queryKey: orpc.project.resource.list.queryKey({
          input: { projectId: resource.projectId },
        }),
      });
      onDeleted();
    },
    onError: (err) => {
      toast.error(err.message ?? "Failed to delete resource");
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <SettingsCard
        title="Identity"
        description="Renaming is not yet supported — once it lands the change will rotate the derived service name + hostname."
      >
        <SettingsRowReadOnly label="Name" value={resource.name} />
        <SettingsRowReadOnly label="Engine" value={resource.engine} />
        <SettingsRowReadOnly
          label="Database name"
          value={resource.databaseName}
        />
        <SettingsRowReadOnly label="Username" value={resource.username} />
      </SettingsCard>

      <SettingsCard title="Storage">
        <SettingsRowReadOnly
          label="Volume"
          value={resource.runtime.volumeName}
        />
        <SettingsRowReadOnly
          label="Network"
          value={resource.runtime.networkName}
        />
        <SettingsRowReadOnly
          label="Internal endpoint"
          value={`${resource.internalHostname}:${resource.internalPort}`}
        />
      </SettingsCard>

      <PublicAccessCard resource={resource} />

      <SettingsCard
        title="Maintenance"
        description="Rotation + backup procedures aren't wired yet — buttons are intentionally disabled rather than no-op stubs."
      >
        <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium">Rotate password</span>
            <span className="text-[11px] text-muted-foreground">
              Generates a new password and rolls connection strings.
            </span>
          </div>
          <Button variant="outline" size="sm" disabled className="gap-1.5">
            <HugeiconsIcon
              icon={Key01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
            Rotate
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium">Take backup</span>
            <span className="text-[11px] text-muted-foreground">
              Snapshot the volume to off-cluster storage.
            </span>
          </div>
          <Button variant="outline" size="sm" disabled className="gap-1.5">
            <HugeiconsIcon
              icon={ArrowReloadHorizontalIcon}
              strokeWidth={2}
              className="size-3.5"
            />
            Snapshot now
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Danger zone"
        description="Permanent — the volume, swarm service, and proxy route are all torn down."
      >
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium text-destructive">
              Delete this database
            </span>
            <span className="text-[11px] text-muted-foreground">
              All data in{" "}
              <span className="font-mono">{resource.databaseName}</span> will be
              unrecoverable.
            </span>
          </div>
          <AlertDialog
            onOpenChange={(open) => {
              if (!open) setConfirmText("");
            }}
          >
            <AlertDialogTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <HugeiconsIcon
                    icon={Delete02Icon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                  Delete
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {resource.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently destroys the database, its volume, and the
                  associated proxy route. Type{" "}
                  <span className="font-mono text-foreground">
                    {resource.name}
                  </span>{" "}
                  to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                autoFocus
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={resource.name}
                className="font-mono"
              />
              <AlertDialogFooter>
                <AlertDialogCancel
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={deleteMutation.isPending}
                    >
                      Cancel
                    </Button>
                  }
                />
                <AlertDialogAction
                  render={
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={!canConfirm || deleteMutation.isPending}
                      onClick={() =>
                        deleteMutation.mutate({
                          projectId: resource.projectId as never,
                          resourceId: resource.resourceId as never,
                        })
                      }
                    >
                      {deleteMutation.isPending ? "Deleting…" : "Delete"}
                    </Button>
                  }
                />
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </SettingsCard>
    </div>
  );
}

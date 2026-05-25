import { useMemo, useState } from "react";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowReloadHorizontalIcon,
  Cancel01Icon,
  Database02Icon,
  EarthIcon,
  HardDriveIcon,
  Maximize01Icon,
  PlusSignIcon,
  RocketIcon,
  Search01Icon,
  ServerStack01Icon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import type { ComponentProps, SVGProps } from "react";

import { INITIAL_NODES_BY_ID } from "@/features/projects/components/graph/initial-nodes";
import type {
  ResourceEngine,
  ResourceKind,
  ResourceNodeData,
} from "@/features/projects/components/graph/resource-node";
import { createResourceCollection } from "@/features/projects/data/resource";
import { Button } from "@/shared/components/ui/button";
import { Docker } from "@/shared/components/ui/svgs/docker";
import { Mariadb } from "@/shared/components/ui/svgs/mariadb";
import { Mongodb } from "@/shared/components/ui/svgs/mongodb";
import { Mysql } from "@/shared/components/ui/svgs/mysql";
import { Postgresql } from "@/shared/components/ui/svgs/postgresql";
import { Redis } from "@/shared/components/ui/svgs/redis";
import { Input } from "@/shared/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";

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
    <div className="pointer-events-auto h-full w-3/5 animate-in fade-in-0 slide-in-from-right-2 overflow-hidden rounded-2xl rounded-tr-none border border-r-0 border-border bg-background duration-200">
      {resource && resource.type === "database" ? (
        <RealResourcePanel resource={resource} onClose={close} />
      ) : resource && resource.type === "service" ? (
        <ServiceResourcePanel resource={resource} onClose={close} />
      ) : demoNode ? (
        <DemoNodePanel node={demoNode.data} onClose={close} />
      ) : (
        <NotFound id={resourceId} onClose={close} />
      )}
    </div>
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
  resource: { name: string; image: string; replicas: number; status: string; publicEnabled: boolean; publicDomain: string | null };
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
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
          </Button>
          <PanelIcon
            node={{ kind: "service", name: resource.name, description: resource.image }}
          />
          <div className="flex flex-col gap-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Service
            </div>
            <div className="text-[20px] font-semibold leading-tight">{resource.name}</div>
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
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 px-6 pt-5">
        <PanelStat label="Replicas (desired)" value={String(resource.replicas)} />
        <PanelStat label="Status" value={resource.status} />
        <PanelStat
          label="Public"
          value={resource.publicEnabled ? (resource.publicDomain ?? "yes") : "private"}
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
      <div className="mt-0.5 font-mono text-[13px] text-foreground">{value}</div>
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
  | "details"
  | "deployments"
  | "logs"
  | "metrics"
  | "variables"
  | "terminal"
  | "settings";

function DemoNodePanel({ node, onClose }: { node: ResourceNodeData; onClose: () => void }) {
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

  const [tab, setTab] = useState<ResourceTab>("details");

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
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
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
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
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
            <TabsTrigger value="details" className="px-2.5 py-2.5">
              Details
            </TabsTrigger>
            <TabsTrigger value="deployments" className="px-2.5 py-2.5">
              Deployments
            </TabsTrigger>
            <TabsTrigger value="logs" className="px-2.5 py-2.5">
              Logs
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
            {/* ─── Details ────────────────────────────────────────── */}
            <TabsContent value="details">
              <DetailRow label="Source" value={meta.repo} />
              {node.git?.branch && (
                <DetailRow label="Branch" value={node.git.branch} />
              )}
              {node.git && (
                <DetailRow
                  label="Commit"
                  value={
                    <span className="inline-block rounded-md bg-muted/60 px-2 py-1 font-mono text-[12.5px]">
                      {node.git.commit.slice(0, 7)}
                    </span>
                  }
                />
              )}
              {meta.domain && (
                <DetailRow
                  label="Public URL"
                  value={<span className="text-primary">{meta.domain}</span>}
                />
              )}
              <DetailRow label="Replicas" value={String(meta.replicas)} />
              <DetailRow label="Region" value={meta.region} />

              <div className="mt-8 px-6 pb-6">
                <div className="mb-3 text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                  Resource usage
                </div>
                <UsageBar
                  label="CPU"
                  value={meta.cpu}
                  unit="%"
                  tone="success"
                />
                <UsageBar
                  label="MEM"
                  value={meta.memory}
                  unit="%"
                  tone="success"
                />
                {meta.rps != null && (
                  <UsageBar
                    label="RPS"
                    value={meta.rps}
                    unit=""
                    tone="info"
                    max={2000}
                  />
                )}
              </div>
            </TabsContent>

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

            <TabsContent value="logs" className="px-6 pt-5 pb-6">
              <SectionLabel>Logs</SectionLabel>
              <p className="mt-2 text-[13px] text-muted-foreground">
                Open the Logs page for full search, filters, and live tail.
              </p>
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

            <TabsContent value="terminal" className="px-6 pt-5 pb-6">
              <TerminalTabBody
                serviceName={node.name}
                containerName={`otterstack-${node.name}-1`}
              />
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

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-center gap-4 border-b border-border/40 px-6 py-3.5">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-[13px] text-foreground">{value}</span>
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

function UsageBar({
  label,
  value,
  unit,
  tone,
  max,
}: {
  label: string;
  value: number;
  unit: string;
  tone: "success" | "info";
  /** Override the percentage scale (default: treat `value` as a percentage). */
  max?: number;
}) {
  const fillPct = max
    ? Math.min(100, (value / max) * 100)
    : Math.min(100, Math.max(0, value));
  const fill = tone === "success" ? "bg-success/70" : "bg-info/80";
  return (
    <div className="grid grid-cols-[40px_1fr_60px] items-center gap-3 py-1.5 font-mono text-xs">
      <span className="uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", fill)}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      <span className="text-right text-foreground/80">
        {value}
        {unit}
      </span>
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

type EnvVar = {
  name: string;
  value: string;
  type: "plain" | "secret";
  scope: "project" | "service";
};

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

function TerminalTabBody({
  serviceName,
  containerName,
}: {
  serviceName: string;
  containerName: string;
}) {
  return (
    <div className="flex flex-col gap-0 overflow-hidden rounded-lg border border-border/40 bg-[oklch(0.12_0_0)]">
      <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-muted/10 px-3 py-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          · {containerName}
        </span>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-7 text-[11px]">
            Reconnect
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-[11px]">
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
      <pre className="m-0 min-h-[280px] whitespace-pre-wrap p-3.5 font-mono text-xs leading-relaxed text-muted-foreground">
        <span>connected to {serviceName} · gravy-truck · production</span>
        {"\n"}
        <span>spawning sh in container {containerName} …</span>
        {"\n"}
        <span className="text-foreground/80">op #</span>
        {"\n"}
        <span className="text-foreground/80">op #</span>{" "}
        <span className="text-muted-foreground/60">type a command…</span>
      </pre>
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
    <div className="grid grid-cols-[1fr_140px] gap-6">
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

type ResourceBodyProps = {
  resource: {
    resourceId: string;
    name: string;
    engine: string;
    status: string;
    databaseName: string;
    username: string;
    password: string;
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
  };
};

function RealResourcePanel({
  resource,
  onClose,
}: {
  resource: ResourceBodyProps["resource"];
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
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
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
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
        </Button>
      </div>

      <div className="mt-5 flex items-center gap-3 border-t border-border/40 px-6 py-3">
        <RuntimeStatusBadge status={resource.runtime.status} />
        <span className="text-[13px] text-muted-foreground">
          {resource.runtime.health ?? "Provisioned"}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <DetailRow
          label="Database"
          value={<span className="font-mono">{resource.databaseName}</span>}
        />
        <DetailRow
          label="Internal host"
          value={
            <span className="font-mono">
              {resource.internalHostname}:{resource.internalPort}
            </span>
          }
        />
        <DetailRow
          label="Public host"
          value={
            <span className="font-mono">
              {resource.publicHostname}:{resource.publicPort}
            </span>
          }
        />
        <DetailRow
          label="Service"
          value={
            <span className="font-mono">{resource.runtime.serviceName}</span>
          }
        />
        <DetailRow
          label="Volume"
          value={
            <span className="font-mono">{resource.runtime.volumeName}</span>
          }
        />
        <DetailRow
          label="Network"
          value={
            <span className="font-mono">{resource.runtime.networkName}</span>
          }
        />

        <div className="mt-6 px-6">
          <SectionLabel>Connection strings</SectionLabel>
          <div className="mt-3 flex flex-col gap-3">
            <ReadOnlyField
              label="Internal"
              value={resource.internalConnectionString}
            />
            <ReadOnlyField
              label="Public"
              value={resource.publicConnectionString}
            />
            {resource.localConnectionString && (
              <ReadOnlyField
                label="Local"
                value={resource.localConnectionString}
              />
            )}
          </div>
        </div>

        <div className="mt-6 px-6">
          <SectionLabel>Credentials</SectionLabel>
          <div className="mt-3 flex flex-col gap-3">
            <DetailRowInline label="Username" value={resource.username} />
            <ReadOnlyField label="Password" value={resource.password} secret />
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRowInline({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-32 shrink-0 text-[12.5px] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-[13px] text-foreground">{value}</span>
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
  secret = false,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Input
        readOnly
        value={value}
        type={secret ? "password" : "text"}
        className="h-8 font-mono text-xs"
        onClick={(e) => (e.target as HTMLInputElement)?.select()}
      />
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

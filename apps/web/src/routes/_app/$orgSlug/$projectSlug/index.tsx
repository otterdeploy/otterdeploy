import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { ServerStack01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Postgresql } from "@/shared/components/ui/svgs/postgresql";
import { Redis } from "@/shared/components/ui/svgs/redis";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/")({
  staticData: { crumb: "Overview" },
  component: RouteComponent,
});

type Health = "healthy" | "degraded" | "down";

const HEALTH_PILL: Record<Health, string> = {
  healthy: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  degraded: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  down: "bg-rose-500/15 text-rose-400 border-rose-500/25",
};

const HEALTH_DOT: Record<Health, string> = {
  healthy: "bg-emerald-500",
  degraded: "bg-amber-500",
  down: "bg-rose-500",
};

const stats = [
  { label: "Services", value: "6", sub: "5 healthy · 1 degraded" },
  { label: "Deploys / 24h", value: "14", sub: "2 failed · 1 rolled back" },
  { label: "Total RPS", value: "1.2k", sub: "+18% vs yesterday" },
  { label: "Compute", value: "6.4 vCPU", sub: "of 16 allocated" },
] as const;

interface Service {
  name: string;
  runtime?: string;
  replicas: number;
  health: Health;
  cpu: number;
  mem: number;
  commit?: { hash: string; message: string; age: string };
}

const services: Service[] = [
  {
    name: "web",
    runtime: "Next.js 14",
    replicas: 3,
    health: "healthy",
    cpu: 34,
    mem: 62,
    commit: { hash: "8a2c1f9", message: "fix: skeleton flash on /pricing", age: "4m ago" },
  },
  {
    name: "api",
    runtime: "Node / Fastify",
    replicas: 4,
    health: "healthy",
    cpu: 51,
    mem: 48,
    commit: {
      hash: "3f9b042",
      message: "feat: idempotency keys on /v1/charges",
      age: "11m ago",
    },
  },
  {
    name: "worker",
    runtime: "Python 3.12",
    replicas: 2,
    health: "degraded",
    cpu: 78,
    mem: 71,
    commit: { hash: "c1ad5e2", message: "chore: bump celery to 5.4", age: "38m ago" },
  },
  {
    name: "imgproxy",
    replicas: 1,
    health: "healthy",
    cpu: 12,
    mem: 20,
  },
];

interface Datastore {
  kind: "postgres" | "redis";
  name: string;
  version: string;
  health: Health;
  port: number;
  storage: { used: number; total: number; unit: string };
}

const datastores: Datastore[] = [
  {
    kind: "postgres",
    name: "postgres",
    version: "16.2",
    health: "healthy",
    port: 5432,
    storage: { used: 12.4, total: 50, unit: "GB" },
  },
  {
    kind: "redis",
    name: "redis",
    version: "7.2",
    health: "healthy",
    port: 6379,
    storage: { used: 0.12, total: 1, unit: "GB" },
  },
];

interface ActivityRow {
  state: "live" | "rolled back";
  service: string;
  message: string;
  hash: string;
  age: string;
}

const activity: ActivityRow[] = [
  { state: "live", service: "web", message: "fix: skeleton flash on /pricing", hash: "8a2c1f9", age: "4m ago" },
  { state: "live", service: "api", message: "feat: idempotency keys on /v1/charges", hash: "3f9b042", age: "11m ago" },
  { state: "live", service: "worker", message: "chore: bump celery to 5.4", hash: "c1ad5e2", age: "38m ago" },
  { state: "rolled back", service: "api", message: "wip: pg pool tweaks", hash: "71fa0c3", age: "2h ago" },
  { state: "live", service: "web", message: "feat: announcement bar", hash: "5b2e8d1", age: "5h ago" },
  { state: "live", service: "web", message: "feat: pricing tier copy", hash: "e042bb1", age: "1d ago" },
];

function RouteComponent() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">{project.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Internal SaaS · self-hosted on rack-2 · 5 services, 2 databases
          </p>
        </div>
        <HealthPill health="healthy" label="all systems normal" />
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading title="Services" hint="Compute units in this project" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {services.map((svc) => (
            <ServiceCard key={svc.name} service={svc} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading title="Datastores" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {datastores.map((ds) => (
            <DatastoreCard key={ds.name} datastore={ds} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading title="Recent activity" />
        <div className="overflow-hidden rounded-lg border bg-card">
          {activity.map((row, i) => (
            <ActivityItem key={row.hash + i} row={row} />
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function HealthPill({ health, label }: { health: Health; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs",
        HEALTH_PILL[health],
      )}
    >
      <span className={cn("size-1.5 rounded-full", HEALTH_DOT[health])} />
      {label}
    </span>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function ServiceCard({ service }: { service: Service }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={ServerStack01Icon}
            strokeWidth={2}
            className="size-4 text-muted-foreground"
          />
          <span className="font-mono text-sm">{service.name}</span>
        </div>
        <HealthPill health={service.health} label={service.health} />
      </div>
      <div className="text-xs text-muted-foreground">
        {service.runtime ? `${service.runtime} · ` : ""}
        {service.replicas} replicas
      </div>
      <div className="grid grid-cols-2 gap-3">
        <UsageBar label="cpu" value={service.cpu} />
        <UsageBar label="mem" value={service.mem} />
      </div>
      {service.commit && (
        <div className="mt-1 border-t pt-3 font-mono text-[11px] text-muted-foreground">
          <span className="text-foreground">{service.commit.hash}</span>{" "}
          {service.commit.message} · {service.commit.age}
        </div>
      )}
    </div>
  );
}

function UsageBar({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 75 ? "bg-amber-500" : value >= 90 ? "bg-rose-500" : "bg-muted-foreground/60";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono">{value}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function DatastoreCard({ datastore: ds }: { datastore: Datastore }) {
  const pct = Math.round((ds.storage.used / ds.storage.total) * 100);
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {ds.kind === "postgres" ? (
            <Postgresql className="size-4" />
          ) : (
            <Redis className="size-4" />
          )}
          <span className="font-mono text-sm">{ds.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{ds.version}</span>
        </div>
        <HealthPill health={ds.health} label={ds.health} />
      </div>
      <div className="font-mono text-[11px] text-muted-foreground">port {ds.port}</div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>storage</span>
          <span className="font-mono">
            {ds.storage.used} / {ds.storage.total} {ds.storage.unit}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-muted-foreground/60"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function ActivityItem({ row }: { row: ActivityRow }) {
  return (
    <div className="flex items-center gap-3 border-b px-4 py-2 text-sm last:border-b-0">
      <StatePill state={row.state} />
      <span className="w-16 shrink-0 truncate font-mono text-xs text-muted-foreground">
        {row.service}
      </span>
      <span className="flex-1 truncate text-xs text-muted-foreground">
        · {row.message}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {row.hash}
      </span>
      <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground">
        {row.age}
      </span>
    </div>
  );
}

function StatePill({ state }: { state: ActivityRow["state"] }) {
  const tone =
    state === "live"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
      : "bg-amber-500/15 text-amber-400 border-amber-500/25";
  const dot = state === "live" ? "bg-emerald-500" : "bg-amber-500";
  return (
    <span
      className={cn(
        "inline-flex w-24 shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px]",
        tone,
      )}
    >
      <span className={cn("size-1.5 rounded-full", dot)} />
      {state}
    </span>
  );
}

import { useMemo, type ComponentProps, type SVGProps } from "react";
import {
  ArrowReloadHorizontalIcon,
  Database02Icon,
  EarthIcon,
  HardDriveIcon,
  RocketIcon,
  ServerStack01Icon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { Button } from "@/shared/components/ui/button";
import { Docker } from "@/shared/components/ui/svgs/docker";
import { Mariadb } from "@/shared/components/ui/svgs/mariadb";
import { Mongodb } from "@/shared/components/ui/svgs/mongodb";
import { Mysql } from "@/shared/components/ui/svgs/mysql";
import { Postgresql } from "@/shared/components/ui/svgs/postgresql";
import { Redis } from "@/shared/components/ui/svgs/redis";
import { cn } from "@/shared/lib/utils";

import type {
  ResourceEngine,
  ResourceKind,
  ResourceNodeData,
  ResourceStatus,
} from "./resource-node";

type IconType = ComponentProps<typeof HugeiconsIcon>["icon"];
type BrandSvg = (props: SVGProps<SVGSVGElement>) => React.ReactNode;

const engineLogos: Record<ResourceEngine, BrandSvg> = {
  postgres: Postgresql,
  mysql: Mysql,
  mariadb: Mariadb,
  redis: Redis,
  mongodb: Mongodb,
  docker: Docker,
};

const kindIcon: Record<ResourceKind, IconType> = {
  service: ServerStack01Icon,
  database: Database02Icon,
  route: EarthIcon,
  volume: HardDriveIcon,
};

const statusToOnline: Record<
  ResourceStatus,
  { label: string; pillClass: string; dotClass: string; subtitle: string }
> = {
  running: {
    label: "ONLINE",
    pillClass: "bg-success/12 text-success",
    dotClass: "bg-success",
    subtitle: "Successful deployment (2:06)",
  },
  building: {
    label: "BUILDING",
    pillClass: "bg-warning/12 text-warning",
    dotClass: "bg-warning",
    subtitle: "Build in progress…",
  },
  error: {
    label: "FAILED",
    pillClass: "bg-destructive/12 text-destructive",
    dotClass: "bg-destructive",
    subtitle: "Deployment failed · check logs",
  },
};

/**
 * Mock the fields that don't exist on the graph node yet — source, branch,
 * commit, URLs, replicas, region, and resource-usage numbers — derived from
 * the node's name/kind so the sheet looks plausible per-resource.
 */
function mockDetails(data: ResourceNodeData) {
  const slug = data.name.replace(/[^a-z0-9-]/gi, "-");
  return {
    commit: "8a2c1f9",
    source: `paperhouse/helio-${slug}`,
    breadcrumbSource: `paperhouse/helio-${slug}`,
    branch: "main",
    publicUrl: data.kind === "service" ? "helio.so" : null,
    internal: `${slug}.helio.internal`,
    replicas: data.kind === "database" ? 3 : 1,
    region: "sf-bay / rack-2",
    cpu: 34,
    mem: 62,
    rps: 412,
  };
}

const TABS = [
  "Details",
  "Deployments",
  "Logs",
  "Metrics",
  "Variables",
  "Terminal",
  "Settings",
] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ResourceNodeData | null;
}

export function ResourceDetailSheet({ open, onOpenChange, data }: Props) {
  const details = useMemo(() => (data ? mockDetails(data) : null), [data]);

  if (!data || !details) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-none w-[min(1200px,95vw)] overflow-y-auto p-0">
          <SheetTitle className="sr-only">Resource details</SheetTitle>
          <SheetDescription className="sr-only">Loading…</SheetDescription>
        </SheetContent>
      </Sheet>
    );
  }

  const BrandLogo = data.engine ? engineLogos[data.engine] : null;
  const fallbackIcon = kindIcon[data.kind];
  const status = data.status ? statusToOnline[data.status] : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="sm:max-w-none w-[min(1200px,95vw)] overflow-y-auto p-0"
        showCloseButton={false}
      >
        <SheetTitle className="sr-only">
          {data.name} — {data.kind}
        </SheetTitle>
        <SheetDescription className="sr-only">
          {data.description}
        </SheetDescription>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-8 pt-8">
          <div className="flex items-start gap-3.5">
            <div className="grid size-11 shrink-0 place-items-center rounded-[11px] border bg-background">
              {BrandLogo ? (
                <BrandLogo className="size-6" aria-label={data.engine} />
              ) : (
                <HugeiconsIcon
                  icon={fallbackIcon}
                  strokeWidth={1.8}
                  className="size-5 text-muted-foreground"
                />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <h1 className="text-[22px] font-bold leading-[1.1] tracking-[-0.01em]">
                {data.name}
              </h1>
              <p className="font-mono text-[12px] text-muted-foreground">
                <span className="text-muted-foreground/70">{details.commit}</span>
                <span className="mx-2 text-muted-foreground/40">·</span>
                <span>{details.breadcrumbSource}</span>
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="default" className="gap-2">
              <HugeiconsIcon
                icon={TerminalIcon}
                strokeWidth={1.8}
                className="size-3.5"
              />
              Terminal
            </Button>
            <Button variant="outline" size="default" className="gap-2">
              <HugeiconsIcon
                icon={ArrowReloadHorizontalIcon}
                strokeWidth={1.8}
                className="size-3.5"
              />
              Restart
            </Button>
            <Button size="default" className="gap-2 bg-success text-background hover:bg-success/90">
              <HugeiconsIcon
                icon={RocketIcon}
                strokeWidth={1.8}
                className="size-3.5"
              />
              Redeploy
            </Button>
          </div>
        </div>

        {/* Status row */}
        {status && (
          <div className="mt-5 flex items-center gap-3 px-8">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em]",
                status.pillClass,
              )}
            >
              <span className={cn("size-1.5 rounded-full", status.dotClass)} />
              {status.label}
            </span>
            <span className="text-sm text-muted-foreground">{status.subtitle}</span>
          </div>
        )}

        {/* Tabs */}
        <div className="mt-6 border-b border-border px-8">
          <nav className="flex gap-6">
            {TABS.map((tab, i) => (
              <button
                key={tab}
                type="button"
                className={cn(
                  "-mb-px py-2.5 text-sm font-medium transition-colors",
                  i === 0
                    ? "border-b-2 border-success text-success"
                    : "border-b-2 border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        {/* Details rows */}
        <dl className="mx-8 mt-5 divide-y divide-border rounded-lg border bg-muted/20">
          <DetailRow label="Source" value={details.source} />
          <DetailRow label="Branch" value={details.branch} />
          <DetailRow label="Commit" value={details.commit} valueClass="font-mono bg-muted/60 inline-block rounded px-1.5 py-0.5" />
          {details.publicUrl && (
            <DetailRow
              label="Public URL"
              value={details.publicUrl}
              valueClass="text-success"
            />
          )}
          <DetailRow
            label="Internal"
            value={details.internal}
            valueClass="font-mono bg-muted/60 inline-block rounded px-1.5 py-0.5"
          />
          <DetailRow label="Replicas" value={String(details.replicas)} />
          <DetailRow label="Region" value={details.region} />
        </dl>

        {/* Resource usage */}
        <div className="px-8 pt-8 pb-8">
          <h2 className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
            Resource usage
          </h2>
          <ResourceBar label="CPU" value={details.cpu} unit="%" tone="success" />
          <ResourceBar label="MEM" value={details.mem} unit="%" tone="success" />
          <ResourceBar
            label="RPS"
            value={details.rps}
            unit=""
            tone="info"
            scale={details.rps / 1000}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-4 px-5 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm text-foreground", valueClass)}>{value}</dd>
    </div>
  );
}

function ResourceBar({
  label,
  value,
  unit,
  tone,
  scale,
}: {
  label: string;
  value: number;
  unit: string;
  tone: "success" | "info";
  scale?: number;
}) {
  const fillPct = Math.min(100, Math.max(0, scale != null ? scale * 100 : value));
  const fillColor =
    tone === "success"
      ? "bg-success/60"
      : "bg-info/60 dark:bg-info";
  return (
    <div className="grid grid-cols-[60px_1fr_70px] items-center gap-3 py-1.5 font-mono text-[12px] text-muted-foreground">
      <span className="text-muted-foreground/70">{label}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", fillColor)}
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

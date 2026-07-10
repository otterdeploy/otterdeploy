/**
 * Overview tab for a deployed service — the panel's landing surface.
 *
 * Four stat tiles (runtime state, replicas, last deploy, public reach), nav
 * cards that jump to the other panel tabs, and the three most recent
 * deployments. Everything shown is real data the panel already loads: the
 * live `service.get` view, the resource row, and the shared deployments
 * collection — no invented numbers.
 */

import { useEffect, useState } from "react";

import {
  ArrowRight01Icon,
  Key01Icon,
  RocketIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";

import {
  DeploymentStatusBadge,
  type DeploymentInfo,
} from "@/features/resources/components/_shared/deployment-cards";
import { deploymentsCollection } from "@/features/resources/data/deployments";
import { shortImageRef } from "@/shared/lib/image-ref";
import { cn } from "@/shared/lib/utils";

import {
  deriveServicePanelState,
  PANEL_STATE_LABEL,
  type ServicePanelState,
  type ServiceRuntimeStatus,
} from "../service-status";

export interface OverviewResource {
  resourceId: string;
  projectId: string;
  name: string;
  image: string;
  source: "image" | "git";
  replicas: number;
  publicEnabled: boolean;
  publicDomain: string | null;
  extraEnv: Record<string, string>;
  secretKeys: string[];
}

/** The slice of the live `service.get` view the overview reads. Undefined
 *  while loading — tiles show an honest "—" instead of a guess. */
export interface OverviewLiveService {
  pausedReplicas: number | null;
  runtime: { status: ServiceRuntimeStatus };
}

const STATE_DOT: Record<ServicePanelState, string> = {
  running: "bg-success",
  starting: "bg-warning animate-pulse",
  stopped: "bg-muted-foreground/60",
  missing: "bg-muted-foreground/60",
  error: "bg-destructive",
  paused: "bg-muted-foreground/60",
  unknown: "bg-muted-foreground/40",
};

const STATE_TEXT: Record<ServicePanelState, string> = {
  running: "text-success",
  starting: "text-warning",
  stopped: "text-muted-foreground",
  missing: "text-muted-foreground",
  error: "text-destructive",
  paused: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

/** Coarse relative timestamp, re-rendered on a 30s tick so it stays honest. */
function relativeTime(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  if (s < 90) return "1m ago";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function useNowTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function StatTile({
  label,
  value,
  sub,
  mono = false,
  valueClass,
  dot,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  valueClass?: string;
  dot?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border bg-card px-3 py-2.5">
      <span className="text-[10.5px] font-medium tracking-[0.14em] text-muted-foreground/70 uppercase">
        {label}
      </span>
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-[13px] font-medium",
          mono && "font-mono text-[12.5px]",
          valueClass,
        )}
      >
        {dot && <span className={cn("size-2 shrink-0 rounded-full", dot)} />}
        <span className="truncate" title={value}>
          {value}
        </span>
      </span>
      {sub && <span className="truncate text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

function NavCard({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: typeof RocketIcon;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/30"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <HugeiconsIcon icon={icon} strokeWidth={2} className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-medium">{title}</span>
        <span className="truncate text-[11px] text-muted-foreground" title={detail}>
          {detail}
        </span>
      </span>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        strokeWidth={2}
        className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5"
      />
    </button>
  );
}

export function ServiceOverviewTab({
  resource,
  service,
  onGoTab,
}: {
  resource: OverviewResource;
  service: OverviewLiveService | undefined;
  onGoTab: (tab: "deployments" | "variables" | "settings") => void;
}) {
  const now = useNowTick();
  const { data: deployments } = useLiveQuery(
    (q) =>
      q
        .from({ d: deploymentsCollection })
        .where(({ d }) =>
          and(eq(d.projectId, resource.projectId), eq(d.resourceId, resource.resourceId)),
        )
        .orderBy(({ d }) => d.createdAt, "desc"),
    [resource.projectId, resource.resourceId],
  );

  const latest = (deployments.at(0) ?? null) as DeploymentInfo | null;
  const recent = deployments.slice(0, 3) as DeploymentInfo[];

  const state = deriveServicePanelState({
    pausedReplicas: service?.pausedReplicas ?? null,
    runtimeStatus: service?.runtime.status,
  });
  const paused = state === "paused";

  // Running count comes off the latest deployment's task labels (the same
  // number the Deployments tab shows); desired is the stored replica count.
  const desired = paused ? 0 : resource.replicas;
  const running = latest ? latest.runningTaskCount : null;

  const varCount = Object.keys(resource.extraEnv).length + resource.secretKeys.length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <StatTile
          label="Status"
          value={PANEL_STATE_LABEL[state]}
          sub={paused && service?.pausedReplicas ? "resume restores replicas" : undefined}
          dot={STATE_DOT[state]}
          valueClass={STATE_TEXT[state]}
        />
        <StatTile
          label="Replicas"
          value={running != null ? `${running} / ${desired}` : `${desired} desired`}
          sub={running != null ? "running / desired" : "no deployments yet"}
        />
        <StatTile
          label="Last deploy"
          value={latest ? relativeTime(latest.createdAt, now) : "never"}
          sub={latest ? `${latest.reason} · ${latest.status}` : "waiting on first deploy"}
        />
        <StatTile
          label="Public"
          value={
            resource.publicEnabled && resource.publicDomain
              ? resource.publicDomain
              : "internal only"
          }
          mono={resource.publicEnabled && !!resource.publicDomain}
          sub={
            resource.publicEnabled && resource.publicDomain
              ? "via the Caddy edge"
              : "project network only"
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
        <NavCard
          icon={RocketIcon}
          title="Deployments"
          detail={
            latest ? `${deployments.length} total · last ${latest.status}` : "No deployments yet"
          }
          onClick={() => onGoTab("deployments")}
        />
        <NavCard
          icon={Key01Icon}
          title="Variables"
          detail={
            varCount === 0 ? "No variables set" : `${varCount} variable${varCount === 1 ? "" : "s"}`
          }
          onClick={() => onGoTab("variables")}
        />
        <NavCard
          icon={Settings01Icon}
          title="Settings"
          detail={`${resource.source === "git" ? "Built from git" : "Pinned image"} · ${shortImageRef(resource.image)}`}
          onClick={() => onGoTab("settings")}
        />
      </div>

      <div>
        <div className="text-[10.5px] font-medium tracking-[0.16em] text-muted-foreground/70 uppercase">
          Recent deployments
        </div>
        {recent.length === 0 ? (
          <p className="mt-2 rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-[12px] text-muted-foreground">
            Nothing has been deployed yet — deployments will appear here.
          </p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-md border bg-card">
            <div className="divide-y divide-border/40">
              {recent.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onGoTab("deployments")}
                  className="grid w-full grid-cols-[92px_1fr_auto] items-center gap-3 px-3 py-2 text-left hover:bg-muted/20"
                >
                  <DeploymentStatusBadge status={d.status} compact />
                  <span
                    className="truncate font-mono text-[12px] text-foreground/80"
                    title={d.image}
                  >
                    {shortImageRef(d.image)}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {relativeTime(d.createdAt, now)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Presentational pieces for {@link ServiceOverviewTab} — the stat-tile row,
 * the nav cards, and the recent-deployments list, plus the small atoms they
 * share. Pulled into a sibling module so the tab component stays within the
 * complexity budget. Everything rendered is real data the panel already
 * loads — no invented numbers.
 */

import { useEffect, useState } from "react";

import {
  ArrowRight01Icon,
  Key01Icon,
  RocketIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { type DeploymentInfo } from "@/features/resources/components/_shared/deployment-cards";
import { shortImageRef } from "@/shared/lib/image-ref";
import { cn } from "@/shared/lib/utils";

import { PANEL_STATE_LABEL, type ServicePanelState } from "../service-status";

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
export function relativeTime(iso: string, now: number): string {
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

export function useNowTick(): number {
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

/** Four stat tiles: runtime state, replicas, last deploy, public reach. */
export function OverviewStatTiles({
  resource,
  service,
  state,
  latest,
  now,
}: {
  resource: { replicas: number; publicEnabled: boolean; publicDomain: string | null };
  service: { pausedReplicas: number | null } | undefined;
  state: ServicePanelState;
  latest: DeploymentInfo | null;
  now: number;
}) {
  const paused = state === "paused";
  // Running count comes off the latest deployment's task labels (the same
  // number the Deployments tab shows); desired is the stored replica count.
  const desired = paused ? 0 : resource.replicas;
  const running = latest ? latest.runningTaskCount : null;

  return (
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
          resource.publicEnabled && resource.publicDomain ? resource.publicDomain : "internal only"
        }
        mono={resource.publicEnabled && !!resource.publicDomain}
        sub={
          resource.publicEnabled && resource.publicDomain
            ? "via the Caddy edge"
            : "project network only"
        }
      />
    </div>
  );
}

/** Jump cards into the other panel tabs. */
export function OverviewNavCards({
  resource,
  deploymentsCount,
  latest,
  onGoTab,
}: {
  resource: {
    source: "image" | "git";
    image: string;
    extraEnv: Record<string, string>;
    secretKeys: string[];
  };
  deploymentsCount: number;
  latest: DeploymentInfo | null;
  onGoTab: (tab: "deployments" | "variables" | "settings") => void;
}) {
  const varCount = Object.keys(resource.extraEnv).length + resource.secretKeys.length;
  return (
    <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
      <NavCard
        icon={RocketIcon}
        title="Deployments"
        detail={latest ? `${deploymentsCount} total · last ${latest.status}` : "No deployments yet"}
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
  );
}

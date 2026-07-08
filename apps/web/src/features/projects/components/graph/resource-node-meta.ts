/**
 * Static metadata (icons, colours, status maps), the stack rollup helper, and
 * the toolbar-hover hook for the graph resource nodes. Split out of
 * resource-node.tsx to keep that file + its components under the line caps.
 */

import { useRef, useState } from "react";

import {
  ContainerIcon,
  Database02Icon,
  EarthIcon,
  GitPullRequestIcon,
  HardDriveIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";

import { Docker } from "@/shared/components/ui/svgs/docker";
import { Mariadb } from "@/shared/components/ui/svgs/mariadb";
import { Mongodb } from "@/shared/components/ui/svgs/mongodb";
import { Mysql } from "@/shared/components/ui/svgs/mysql";
import { Postgresql } from "@/shared/components/ui/svgs/postgresql";
import { Redis } from "@/shared/components/ui/svgs/redis";

import type {
  BrandSvg,
  ComposeServiceInfo,
  IconType,
  ResourceEngine,
  ResourceKind,
  ResourceStatus,
  StackServiceStatus,
} from "./resource-node-types";

/** Per-service status → its row's label + colour. `offline`/`pending` are the
 *  states a single top-level pill can't express (see StackServiceStatus). */
export const stackStatusMeta: Record<
  StackServiceStatus,
  { label: string; dotClass: string; textClass: string }
> = {
  running: {
    label: "Running",
    dotClass: "bg-success shadow-[0_0_0_3px] shadow-success/20",
    textClass: "text-success",
  },
  building: {
    label: "Building",
    dotClass: "bg-warning shadow-[0_0_0_3px] shadow-warning/20",
    textClass: "text-warning",
  },
  error: {
    label: "Failed",
    dotClass: "bg-destructive shadow-[0_0_0_3px] shadow-destructive/20",
    textClass: "text-destructive",
  },
  offline: {
    label: "Service is offline",
    dotClass: "bg-muted-foreground/40",
    textClass: "text-muted-foreground",
  },
  pending: {
    label: "Pending",
    dotClass: "bg-info shadow-[0_0_0_3px] shadow-info/20",
    textClass: "text-info",
  },
};

// Partial: engines without a dedicated brand logo (clickhouse, rabbitmq, minio,
// meilisearch) fall back to the generic icon at the call site (`BrandLogo ?`).
export const engineLogos: Partial<Record<ResourceEngine, BrandSvg>> = {
  postgres: Postgresql,
  mysql: Mysql,
  mariadb: Mariadb,
  redis: Redis,
  mongodb: Mongodb,
  docker: Docker,
};

export const kindMeta: Record<ResourceKind, { label: string; icon: IconType; iconColor: string }> =
  {
    service: {
      label: "Service",
      icon: ServerStack01Icon,
      iconColor: "text-amber-700 dark:text-amber-300",
    },
    database: {
      label: "Database",
      icon: Database02Icon,
      iconColor: "text-sky-700 dark:text-sky-300",
    },
    route: {
      label: "Route",
      icon: EarthIcon,
      iconColor: "text-emerald-700 dark:text-emerald-300",
    },
    volume: {
      label: "Volume",
      icon: HardDriveIcon,
      iconColor: "text-violet-700 dark:text-violet-300",
    },
    compose: {
      label: "Stack",
      icon: ContainerIcon,
      iconColor: "text-blue-700 dark:text-blue-300",
    },
    // Neutral tile on purpose (One Voice rule): a preview chip is chrome,
    // not an action/selection — Signal Blue stays reserved.
    preview: {
      label: "Preview",
      icon: GitPullRequestIcon,
      iconColor: "text-muted-foreground",
    },
  };

export const statusMeta: Record<
  ResourceStatus,
  { label: string; pillClass: string; dotClass: string }
> = {
  running: {
    label: "running",
    pillClass: "bg-success/12 text-success",
    dotClass: "bg-success shadow-[0_0_0_3px] shadow-success/20",
  },
  building: {
    label: "building",
    pillClass: "bg-warning/12 text-warning",
    dotClass: "bg-warning shadow-[0_0_0_3px] shadow-warning/20",
  },
  error: {
    label: "error",
    pillClass: "bg-destructive/12 text-destructive",
    dotClass: "bg-destructive shadow-[0_0_0_3px] shadow-destructive/20",
  },
};

/**
 * Roll a stack's per-service states up to one header summary — WITHOUT
 * collapsing them. The summary says "2/3 running"; the cards below say which 2.
 * Worst-state-wins for the dot colour so a single failure colours the header.
 */
export function stackRollup(services: ComposeServiceInfo[]): {
  summary: string;
  tone: "running" | "building" | "error" | "offline";
} {
  const total = services.length;
  const running = services.filter((s) => s.status === "running").length;
  const anyError = services.some((s) => s.status === "error");
  const anyBuilding = services.some((s) => s.status === "building" || s.status === "pending");
  if (anyError) return { summary: `${running}/${total} running`, tone: "error" };
  if (anyBuilding) return { summary: "Deploying…", tone: "building" };
  if (total > 0 && running === total) return { summary: "All running", tone: "running" };
  return { summary: `${running}/${total} running`, tone: "offline" };
}

export const stackToneClass: Record<
  ReturnType<typeof stackRollup>["tone"],
  { pill: string; dot: string }
> = {
  running: { pill: "bg-success/12 text-success", dot: "bg-success" },
  building: { pill: "bg-warning/12 text-warning", dot: "bg-warning" },
  error: { pill: "bg-destructive/12 text-destructive", dot: "bg-destructive" },
  offline: {
    pill: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/50",
  },
};

/**
 * Hover state for a node's floating toolbar, with a short close delay so the
 * pointer can travel from the node onto the toolbar without it vanishing.
 * Shared by both node variants.
 */
export function useToolbarHover() {
  const [isHovered, setIsHovered] = useState(false);
  const hideTimer = useRef<number | null>(null);

  const show = () => {
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setIsHovered(true);
  };

  const scheduleHide = () => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setIsHovered(false), 150);
  };

  return { isHovered, show, scheduleHide };
}

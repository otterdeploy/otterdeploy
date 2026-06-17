/**
 * Small layout atoms shared across multiple panels. Kept here so panels
 * don't need to reach back into layout.tsx for one-liner helpers.
 */

import type { ComponentProps, SVGProps } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  ContainerIcon,
  Database02Icon,
  EarthIcon,
  HardDriveIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";

import type {
  ResourceEngine,
  ResourceKind,
  ResourceNodeData,
} from "@/features/projects/components/graph/resource-node";
import { FrameworkLogo } from "@/features/projects/components/framework-logo";
import { Docker } from "@/shared/components/ui/svgs/docker";
import { Mariadb } from "@/shared/components/ui/svgs/mariadb";
import { Mongodb } from "@/shared/components/ui/svgs/mongodb";
import { Mysql } from "@/shared/components/ui/svgs/mysql";
import { Postgresql } from "@/shared/components/ui/svgs/postgresql";
import { Redis } from "@/shared/components/ui/svgs/redis";
import { cn } from "@/shared/lib/utils";

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
      {children}
    </div>
  );
}

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
  compose: {
    icon: ContainerIcon,
    tint: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
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

/**
 * Square brand tile rendered at the top-left of a resource panel.
 * Engine-branded resources show the brand SVG on a neutral background;
 * generic kinds fall back to a tinted hugeicon — matching the graph
 * node rendering for visual continuity between graph + detail panel.
 */
export function PanelIcon({ node }: { node: ResourceNodeData }) {
  // Detected framework wins for git-sourced services — same precedence as
  // the graph node header tile (framework > engine > kind), so the drawer
  // header matches the node the operator just clicked.
  if (node.framework) {
    return (
      <div className="grid size-10 shrink-0 place-items-center rounded-lg border bg-background">
        <FrameworkLogo framework={node.framework} className="size-5" />
      </div>
    );
  }
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

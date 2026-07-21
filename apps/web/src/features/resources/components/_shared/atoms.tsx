/**
 * Small layout atoms shared across multiple panels. Kept here so panels
 * don't need to reach back into layout.tsx for one-liner helpers.
 */

import type { ComponentProps, SVGProps } from "react";

import {
  ContainerIcon,
  Database02Icon,
  GitPullRequestIcon,
  HardDriveIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type {
  ResourceEngine,
  ResourceKind,
  ResourceNodeData,
} from "@/features/projects/components/graph/resource-node";

import { FrameworkLogo } from "@/features/projects/components/framework-logo";
import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Docker } from "@/shared/components/ui/svgs/docker";
import { Mariadb } from "@/shared/components/ui/svgs/mariadb";
import { Mongodb } from "@/shared/components/ui/svgs/mongodb";
import { Mysql } from "@/shared/components/ui/svgs/mysql";
import { Postgresql } from "@/shared/components/ui/svgs/postgresql";
import { Redis } from "@/shared/components/ui/svgs/redis";
import { cn } from "@/shared/lib/utils";

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] font-medium tracking-[0.16em] text-muted-foreground/70 uppercase">
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
  volume: {
    icon: HardDriveIcon,
    tint: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  },
  preview: {
    icon: GitPullRequestIcon,
    tint: "bg-muted text-muted-foreground",
  },
  compose: {
    icon: ContainerIcon,
    tint: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  },
};

// Engines without a dedicated brand SVG (clickhouse, meilisearch, minio,
// rabbitmq) fall through to the tinted kind icon — `PanelIcon` guards on the
// lookup, so a partial map is intentional here.
const ENGINE_LOGO: Partial<Record<ResourceEngine, BrandSvg>> = {
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
/** Tile + glyph sizing. `md` is the panel-header tile; `sm` is the compact
 *  tile the deployment card uses beside the trigger. */
const PANEL_ICON_SIZE = {
  md: { tile: "size-10", glyph: "size-5", svgl: 22 },
  sm: { tile: "size-7", glyph: "size-4", svgl: 16 },
} as const;

export function PanelIcon({
  node,
  size = "md",
}: {
  node: ResourceNodeData;
  size?: "sm" | "md";
}) {
  const s = PANEL_ICON_SIZE[size];
  const tile = cn("grid shrink-0 place-items-center rounded-lg border bg-background", s.tile);
  // Detected framework wins for git-sourced services — same precedence as
  // the graph node header tile (framework > engine > kind), so the drawer
  // header matches the node the operator just clicked.
  if (node.framework) {
    return (
      <div className={tile}>
        <FrameworkLogo framework={node.framework} className={s.glyph} />
      </div>
    );
  }
  if (node.engine) {
    const Brand = ENGINE_LOGO[node.engine];
    if (Brand) {
      return (
        <div className={tile}>
          <Brand className={s.glyph} aria-label={node.engine} />
        </div>
      );
    }
  }
  // Template/compose brand mark (e.g. Authentik) — persisted as `logoBrand` on
  // the stack. Same precedence + tile as the graph's compose group header, so a
  // template stack shows its logo in the detail header instead of the generic
  // blue container icon.
  if (node.logoBrand) {
    return (
      <div className={tile}>
        <SvglLogo
          search={node.logoBrand}
          fallback={node.name}
          size={s.svgl}
          border="none"
          background="transparent"
        />
      </div>
    );
  }
  const { icon, tint } = KIND_ICON[node.kind];
  return (
    <div className={cn("grid shrink-0 place-items-center rounded-lg", s.tile, tint)}>
      <HugeiconsIcon icon={icon} strokeWidth={1.8} className={s.glyph} />
    </div>
  );
}

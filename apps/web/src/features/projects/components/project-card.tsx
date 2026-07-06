import type { ProjectSlug } from "@otterdeploy/shared/id";

import { Link } from "@tanstack/react-router";

import { Badge } from "@/shared/components/ui/badge";

import { MiniCanvasPreview } from "./mini-canvas-preview";

interface ProjectCardItem {
  id: string;
  name: string;
  slug: string;
  serviceCount?: number;
  runningServiceCount?: number | null;
  databaseCount?: number;
  routeCount?: number;
}

interface Props {
  orgSlug: string;
  project: ProjectCardItem;
}

export function ProjectCard({ orgSlug, project }: Props) {
  const services = project.serviceCount ?? 0;
  const running = project.runningServiceCount;
  const databases = project.databaseCount ?? 0;
  const routes = project.routeCount ?? 0;
  // Show "2/3" when we know the running count, else just the configured total.
  const serviceLabel = running == null ? String(services) : `${running}/${services}`;

  return (
    <Link
      to="/$orgSlug/$projectSlug"
      params={{
        orgSlug,
        projectSlug: project.slug as ProjectSlug,
      }}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <div className="truncate text-sm font-semibold">{project.name}</div>
          <div className="truncate text-xs text-muted-foreground">{project.slug}</div>
        </div>
        <Badge variant="outline" className="text-[10px]">
          project
        </Badge>
      </div>
      <div className="overflow-hidden rounded-md border bg-muted/30">
        <MiniCanvasPreview databases={databases} routes={routes} className="h-20 w-full" />
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>
          <b className="text-foreground">{serviceLabel}</b>{" "}
          {services === 1 ? "service" : "services"}
        </span>
        <span>
          <b className="text-foreground">{databases}</b>{" "}
          {databases === 1 ? "database" : "databases"}
        </span>
        <span>
          <b className="text-foreground">{routes}</b> {routes === 1 ? "route" : "routes"}
        </span>
      </div>
    </Link>
  );
}

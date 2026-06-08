import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { MiniCanvasPreview } from "@/features/project-canvas";
import type { ProjectSummary } from "../types";

interface Props {
  summary: ProjectSummary;
}

export function ProjectCard({ summary }: Props) {
  const { project, databases, routes } = summary;
  return (
    <Link
      to="/project/$projectId"
      params={{ projectId: project.id }}
      data-project-card
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <div className="text-sm font-semibold">{project.name}</div>
          <div className="text-xs text-muted-foreground">{project.slug}</div>
        </div>
        <Badge variant="outline" className="text-[10px]">
          project
        </Badge>
      </div>
      <div className="overflow-hidden rounded-md border bg-muted/30">
        <MiniCanvasPreview
          databases={databases.count}
          routes={routes.count}
          className="h-20 w-full"
        />
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>
          <b className="text-foreground">{databases.count}</b>{" "}
          {databases.count === 1 ? "database" : "databases"}
        </span>
        <span>
          <b className="text-foreground">{routes.count}</b>{" "}
          {routes.count === 1 ? "route" : "routes"}
        </span>
      </div>
    </Link>
  );
}

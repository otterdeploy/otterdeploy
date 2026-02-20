import { Badge } from "@/components/ui/badge";
import { kindIcons, statusConfig, type Kind, type Status } from "@/components/resource/node";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export interface ProjectResource {
  kind: Kind;
  status: Status;
  name: string;
}

export interface ProjectCardProps {
  id: string;
  name: string;
  environment: string;
  resources: ProjectResource[];
}

export function ProjectCard({ id, name, environment, resources }: ProjectCardProps) {
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: id }}
      className="group block rounded-xl border bg-card text-card-foreground shadow-sm transition-all hover:shadow-md hover:border-primary/30"
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold truncate">{name}</h3>
      </div>

      {/* Mini architecture canvas */}
      <div
        className="relative mx-3 mb-3 h-28 rounded-lg bg-muted/30 overflow-hidden"
        style={{
          backgroundImage:
            "radial-gradient(circle, hsl(var(--muted-foreground) / 0.15) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      >
        <div className="absolute inset-0 flex flex-wrap items-center justify-center gap-3 p-4">
          {resources.slice(0, 6).map((resource, i) => {
            const icon = kindIcons[resource.kind];
            const status = statusConfig[resource.status] ?? statusConfig.unknown;
            return (
              <div
                key={`${resource.name}-${i}`}
                className="flex flex-col items-center gap-1"
              >
                <div className="relative flex items-center justify-center size-10 rounded-lg border bg-card shadow-sm">
                  <HugeiconsIcon icon={icon} className="size-4 text-muted-foreground" />
                  <span
                    className={cn(
                      "absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-card",
                      status.color,
                    )}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground truncate max-w-[60px]">
                  {resource.name}
                </span>
              </div>
            );
          })}
          {resources.length === 0 && (
            <span className="text-xs text-muted-foreground/50">No resources</span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <Badge variant="secondary" className="text-[10px]">
          {environment}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {resources.length} {resources.length === 1 ? "resource" : "resources"}
        </span>
        {resources.length > 0 && (
          <div className="ml-auto flex items-center gap-1">
            {Object.entries(
              resources.reduce(
                (acc, r) => {
                  acc[r.status] = (acc[r.status] || 0) + 1;
                  return acc;
                },
                {} as Record<string, number>,
              ),
            ).map(([status, count]) => (
              <span
                key={status}
                className={cn(
                  "size-2 rounded-full",
                  statusConfig[status as Status]?.color ?? "bg-gray-500",
                )}
                title={`${count} ${status}`}
              />
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

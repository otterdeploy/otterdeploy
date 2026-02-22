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
  const onlineCount = resources.filter((r) => r.status === "online").length;
  const totalCount = resources.length;

  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: id }}
      className="group block rounded-2xl border border-border/60 bg-card text-card-foreground transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-3">
        <h3 className="text-[15px] font-semibold truncate">{name}</h3>
      </div>

      {/* Mini architecture canvas */}
      <div
        className="relative mx-4 mb-4 h-36 rounded-xl bg-muted/20 overflow-hidden border border-border/30"
        style={{
          backgroundImage:
            "radial-gradient(circle, oklch(0.7 0 0 / 0.12) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
        <div className="absolute inset-0 grid grid-cols-3 gap-3 content-center justify-items-center p-5">
          {resources.slice(0, 6).map((resource, i) => {
            const icon = kindIcons[resource.kind];
            const status = statusConfig[resource.status] ?? statusConfig.unknown;
            return (
              <div
                key={`${resource.name}-${i}`}
                className="relative flex items-center justify-center size-11 rounded-xl border border-border/50 bg-card shadow-sm"
              >
                <HugeiconsIcon icon={icon} className="size-5 text-muted-foreground" />
                <span
                  className={cn(
                    "absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card",
                    status.color,
                  )}
                />
              </div>
            );
          })}
          {resources.length === 0 && (
            <div className="col-span-3 flex items-center justify-center">
              <span className="text-xs text-muted-foreground/40">No resources</span>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 pb-4">
        <span
          className={cn(
            "size-2 rounded-full shrink-0",
            onlineCount === totalCount && totalCount > 0
              ? "bg-emerald-500"
              : totalCount === 0
                ? "bg-muted-foreground/30"
                : "bg-amber-500",
          )}
        />
        <span className="text-[13px] text-foreground/80">{environment}</span>
        {totalCount > 0 && (
          <>
            <span className="text-muted-foreground/30 select-none">&middot;</span>
            <span className="text-[13px] text-muted-foreground">
              {onlineCount}/{totalCount} {totalCount === 1 ? "service" : "services"} online
            </span>
          </>
        )}
      </div>
    </Link>
  );
}

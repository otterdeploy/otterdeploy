import { ServerStack01Icon, FlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { cn } from "@/shared/lib/utils";

import type { SessionSource } from "../types";

/** Accent dot color per known project slug; unknown projects fall back to muted. */
export const PROJECT_DOT: Record<string, string> = {
  helio: "bg-success",
  billing: "bg-warning",
  "marketing-site": "bg-info",
  "lab-internal": "bg-pink-500",
  analytics: "bg-emerald-500",
};

export interface PickerService {
  project: string;
  projectName: string;
  name: string;
  replicas: Array<{ label: string; containerId: string }>;
}

interface ProjectFilters {
  total: number;
  list: Array<{ id: string; count: number; dot: string }>;
}

export function ContainerTab({
  projectFilter,
  setProjectFilter,
  projects,
  services,
  onPick,
}: {
  projectFilter: string;
  setProjectFilter: (v: string) => void;
  projects: ProjectFilters;
  services: PickerService[];
  onPick: (source: SessionSource) => void;
}) {
  return (
    <>
      {/* Project filter pills */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <FilterPill
          active={projectFilter === "all"}
          onClick={() => setProjectFilter("all")}
          label="All projects"
          count={projects.total}
        />
        {projects.list.map((p) => (
          <FilterPill
            key={p.id}
            active={projectFilter === p.id}
            onClick={() => setProjectFilter(p.id)}
            label={p.id}
            count={p.count}
            dot={p.dot}
          />
        ))}
      </div>

      <p className="mb-3 text-[12.5px] text-muted-foreground">
        Pick a service then a specific container (replica) to{" "}
        <span className="font-mono text-foreground/80">docker exec</span> into.
      </p>

      <div className="-mx-2.5 max-h-105 space-y-2 overflow-y-auto px-2.5 pb-8">
        {services.length === 0 ? (
          <Empty className="rounded-md border border-dashed bg-muted/20 py-8">
            <EmptyHeader>
              <HugeiconsIcon
                icon={ServerStack01Icon}
                strokeWidth={1.5}
                className="size-10 text-muted-foreground/50"
              />
              <EmptyTitle>No services</EmptyTitle>
              <EmptyDescription>No services in {projectFilter} to exec into.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          services.map((s) => (
            <ServiceRow
              key={`${s.project}/${s.name}`}
              service={s.name}
              project={s.project}
              projectDot={PROJECT_DOT[s.project] ?? "bg-muted-foreground"}
              replicas={s.replicas.map((r) => r.label)}
              onPickReplica={(label) => {
                const replica = s.replicas.find((r) => r.label === label);
                if (!replica) return;
                onPick({
                  kind: "container",
                  project: s.project,
                  service: s.name,
                  replica: replica.label,
                  containerId: replica.containerId,
                });
              }}
            />
          ))
        )}
      </div>
    </>
  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
  dot,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  dot?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
        active
          ? "border-foreground bg-card text-foreground"
          : "border-transparent text-muted-foreground hover:bg-muted",
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dot)} />}
      <span>{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
    </button>
  );
}

function ServiceRow({
  service,
  project,
  projectDot,
  replicas,
  onPickReplica,
}: {
  service: string;
  project: string;
  projectDot: string;
  replicas: string[];
  onPickReplica: (label: string) => void;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-2">
        <HugeiconsIcon
          icon={ServerStack01Icon}
          strokeWidth={1.8}
          className="size-3.5 text-muted-foreground"
        />
        <span className="font-mono text-[13px] font-medium">{service}</span>
        <span className="text-[11px] text-muted-foreground">
          · {replicas.length} {replicas.length === 1 ? "container" : "containers"}
        </span>
        <Badge variant="outline" className="gap-1 font-mono text-[10px] font-normal">
          <span className={cn("size-1.5 rounded-full", projectDot)} />
          {project}
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {replicas.map((r) => (
          <Button
            key={r}
            type="button"
            variant="outline"
            size="sm"
            className="gap-1 font-mono text-[12px]"
            onClick={() => onPickReplica(r)}
          >
            <HugeiconsIcon icon={FlashIcon} strokeWidth={2} className="size-3" />
            {r}
          </Button>
        ))}
      </div>
    </div>
  );
}

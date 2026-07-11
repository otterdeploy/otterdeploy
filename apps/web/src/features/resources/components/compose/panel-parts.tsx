/**
 * Header, status row, and status helpers for {@link ComposeResourcePanel} —
 * pulled into a sibling module so the panel component stays small. The content
 * tabs (Services / Compose / Settings) live in {@link ./panel-tabs}.
 */

import { ArrowLeft01Icon, Cancel01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { PanelIcon } from "@/features/resources/components/_shared/atoms";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

export type StackServiceStatus =
  | "running"
  | "building"
  | "deploying"
  | "error"
  | "offline"
  | "pending";

export interface ComposeService {
  name: string;
  image: string | null;
  hasBuild: boolean;
  ports: number[];
  volumes: string[];
}

type DeploymentStatus =
  | "pending"
  | "building"
  | "starting"
  | "running"
  | "crashed"
  | "failed"
  | "superseded"
  | "removed"
  | null;

interface StackTaskRow {
  resourceId: string;
  tasks: ReadonlyArray<{ service?: string | null; state: string }>;
}

/** Build-time base before live tasks arrive. `building` means an actual image
 *  build; `pending`/`starting` mean the rollout is pulling/starting containers
 *  — image-only stacks never build, so calling that phase "Building" was a
 *  lie. The two states render distinctly (Building vs Deploying). */
export function baseStatus(dep: DeploymentStatus): StackServiceStatus | undefined {
  switch (dep) {
    case "building":
      return "building";
    case "starting":
    case "pending":
      return "deploying";
    case "crashed":
    case "failed":
      return "error";
    case "running":
      return undefined;
    default:
      return dep == null ? "pending" : undefined;
  }
}

/** Roll task rows up to a per-service status, worst-state-wins within a
 *  service: error > building > running. */
export function rollupTaskStatus(
  taskRows: readonly StackTaskRow[],
  resourceId: string,
): Map<string, "running" | "building" | "error"> {
  const byService = new Map<string, "running" | "building" | "error">();
  for (const row of taskRows) {
    if (row.resourceId !== resourceId) continue;
    for (const task of row.tasks) {
      if (!task.service) continue;
      const prev = byService.get(task.service);
      if (task.state === "error" || prev === "error") {
        byService.set(task.service, "error");
      } else if (task.state === "building" || prev === "building") {
        byService.set(task.service, "building");
      } else {
        byService.set(task.service, "running");
      }
    }
  }
  return byService;
}

export function ComposePanelHeader({
  name,
  serviceCount,
  source,
  onClose,
  onRedeploy,
  redeploying,
}: {
  name: string;
  serviceCount: number;
  source: "inline" | "git";
  onClose: () => void;
  onRedeploy: () => void;
  redeploying: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-6">
      <div className="flex items-start gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Back to graph"
          onClick={onClose}
          className="mt-1"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
        </Button>
        <PanelIcon node={{ kind: "compose", name, description: "" }} />
        <div className="flex flex-col gap-0.5">
          <span className="text-xl leading-none font-bold tracking-tight">{name}</span>
          <span className="font-mono text-xs text-muted-foreground">
            Stack · {serviceCount} {serviceCount === 1 ? "service" : "services"} ·{" "}
            {source === "git" ? "from repo" : "inline file"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRedeploy}
          disabled={redeploying}
        >
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
          {redeploying ? "Redeploying…" : "Redeploy"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close panel"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function ComposeStatusBar({
  services,
  serviceStatus,
  stackName,
}: {
  services: ComposeService[];
  serviceStatus: (name: string) => StackServiceStatus;
  stackName: string;
}) {
  const runningCount = services.filter((s) => serviceStatus(s.name) === "running").length;
  const allRunning = runningCount === services.length && services.length > 0;
  const anyError = services.some((s) => serviceStatus(s.name) === "error");
  return (
    <div className="mt-5 flex items-center gap-3 border-t border-border/40 px-6 py-3">
      <span
        className={cn(
          "rounded-md px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em]",
          allRunning
            ? "bg-success/12 text-success"
            : anyError
              ? "bg-destructive/12 text-destructive"
              : "bg-muted text-muted-foreground",
        )}
      >
        {runningCount}/{services.length} RUNNING
      </span>
      <span className="font-mono text-[12px] text-muted-foreground">{stackName}</span>
    </div>
  );
}

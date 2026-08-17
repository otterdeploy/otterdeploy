/**
 * Header, status row, and status helpers for {@link ComposeResourcePanel},
 * pulled into a sibling module so the panel component stays small. The content
 * tabs (Services / Compose / Settings) live in {@link ./panel-tabs}.
 */

import { ArrowLeft01Icon, Cancel01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

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
  /** Runtime name (`composeSwarmServiceName(stack, name)`): the join key back
   *  to this service's materialized child resource. The child's `name` is
   *  collision-suffixed and must never be used for the match. */
  serviceName: string;
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
  | "paused"
  | "failed"
  | "cancelled"
  | "superseded"
  | "removed"
  | null;

/** Build-time base before live tasks arrive. `building` means an actual image
 *  build; `pending`/`starting` mean the rollout is pulling/starting containers.
 *  Image-only stacks never build, so calling that phase "Building" was a
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

export function ComposePanelHeader({
  name,
  serviceCount,
  source,
  logoBrand,
  onClose,
  onRedeploy,
  redeploying,
}: {
  name: string;
  serviceCount: number;
  source: "inline" | "git";
  logoBrand?: string | null;
  onClose: () => void;
  onRedeploy: () => void;
  redeploying: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-2 px-4 pt-4 sm:gap-4 sm:px-6 sm:pt-6">
      {/* min-w-0 so the stack name and its summary line truncate instead of
          forcing this row wider than the panel. */}
      <div className="flex min-w-0 items-start gap-2 sm:gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("resources.backToGraph")}
          onClick={onClose}
          className="mt-1 shrink-0"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
        </Button>
        <PanelIcon
          node={{ kind: "compose", name, description: "", logoBrand: logoBrand ?? undefined }}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-lg leading-tight font-bold tracking-tight sm:text-xl sm:leading-none">
            {name}
          </span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            Stack · {serviceCount} {serviceCount === 1 ? "service" : "services"} ·{" "}
            {source === "git" ? "from repo" : "inline file"}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRedeploy}
          disabled={redeploying}
          aria-label={redeploying ? "Redeploying" : "Redeploy"}
        >
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
          <span className="hidden sm:inline">{redeploying ? "Redeploying…" : "Redeploy"}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("resources.closePanel")}
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
  serviceStatus: (serviceName: string) => StackServiceStatus;
  stackName: string;
}) {
  const runningCount = services.filter((s) => serviceStatus(s.serviceName) === "running").length;
  const allRunning = runningCount === services.length && services.length > 0;
  const anyError = services.some((s) => serviceStatus(s.serviceName) === "error");
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/40 px-4 py-3 sm:px-6">
      <span
        className={cn(
          "shrink-0 rounded-md px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em]",
          allRunning
            ? "bg-success/12 text-success"
            : anyError
              ? "bg-destructive/12 text-destructive"
              : "bg-muted text-muted-foreground",
        )}
      >
        {runningCount}/{services.length} RUNNING
      </span>
      <span className="min-w-0 truncate font-mono text-[12px] text-muted-foreground">
        {stackName}
      </span>
    </div>
  );
}

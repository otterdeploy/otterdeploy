import { useProjectContext } from "@/components/project/context";
import type { DeploymentInfo } from "@/components/resource/deployment-logs-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  CircleIcon,
  Loading03Icon,
  MoreVerticalIcon,
  Package01Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { queries } from "@otterdeploy/zero";
import { useQuery } from "@rocicorp/zero/react";
import { RotateCwIcon } from "lucide-react";
import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StepStatus = "completed" | "failed" | "not_started";

interface DeploymentStep {
  name: string;
  status: StepStatus;
  duration?: string;
  error?: string;
  children?: DeploymentStep[];
}

type DeploymentStatus =
  | "active"
  | "completed"
  | "removed"
  | "failed"
  | "building"
  | "deploying"
  | "initializing";

interface Deployment {
  id: string;
  image: string;
  timeAgo: string;
  source: string;
  status: DeploymentStatus;
  message?: string;
  showLogs?: boolean;
  steps?: DeploymentStep[];
  createdAt?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeAgo(timestamp: number | null | undefined): string {
  if (!timestamp) return "just now";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function mapDeploymentStatus(status: string | null | undefined): DeploymentStatus {
  switch (status) {
    case "live":
      return "active";
    case "queued":
      return "initializing";
    case "building":
      return "building";
    case "deploying":
    case "verifying":
      return "deploying";
    case "failed":
    case "canceled":
      return "failed";
    case "rolled_back":
      return "removed";
    default:
      return "initializing";
  }
}

function mapEventsToSteps(
  events: readonly {
    status: string;
    reason?: string | null | undefined;
    createdAt?: number | null | undefined;
  }[],
): DeploymentStep[] {
  if (!events || events.length === 0) return [];

  const phaseOrder = ["queued", "building", "deploying", "verifying", "live"];
  const phaseLabels: Record<string, string> = {
    queued: "Initialization",
    building: "Build",
    deploying: "Deploy",
    verifying: "Verification",
    live: "Live",
  };

  const reachedStatuses = new Set(events.map((e) => e.status));
  const hasFailed = reachedStatuses.has("failed") || reachedStatuses.has("canceled");

  return phaseOrder.map((phase) => {
    const reached = reachedStatuses.has(phase);
    const failedEvent = events.find(
      (e) => (e.status === "failed" || e.status === "canceled") && !reachedStatuses.has(phase),
    );

    let stepStatus: StepStatus;
    if (reached) {
      stepStatus = "completed";
    } else if (hasFailed) {
      const lastReachedIndex = Math.max(
        ...Array.from(reachedStatuses).map((s) => phaseOrder.indexOf(s)),
      );
      const thisIndex = phaseOrder.indexOf(phase);
      if (thisIndex === lastReachedIndex + 1 && failedEvent) {
        stepStatus = "failed";
      } else {
        stepStatus = "not_started";
      }
    } else {
      stepStatus = "not_started";
    }

    const children: DeploymentStep[] = [];
    if (stepStatus === "failed") {
      const reason = events.find((e) => e.status === "failed" || e.status === "canceled")?.reason;
      if (reason) {
        children.push({
          name: `${phaseLabels[phase]} failed`,
          status: "failed",
          error: reason,
        });
      }
    }

    return {
      name: phaseLabels[phase] ?? phase,
      status: stepStatus,
      children: children.length > 0 ? children : undefined,
    };
  });
}

/** Derive a progress message from deployment events */
function getDeployingMessage(
  events: readonly { status: string; reason?: string | null | undefined }[],
): string {
  if (!events || events.length === 0) return "Deployment in progress...";

  const statuses = new Set(events.map((e) => e.status));

  if (statuses.has("verifying")) return "Deployment in progress:  Verifying health...";
  if (statuses.has("deploying")) return "Deployment in progress:  Creating containers...";
  if (statuses.has("building")) return "Deployment in progress:  Building image...";
  if (statuses.has("queued")) return "Deployment in progress:  Taking a snapshot of the code...";
  return "Deployment in progress...";
}

function isInProgress(status: DeploymentStatus): boolean {
  return status === "deploying" || status === "building" || status === "initializing";
}

// ---------------------------------------------------------------------------
// Status styles
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<DeploymentStatus, { label: string; className: string }> = {
  active: {
    label: "ACTIVE",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  },
  completed: {
    label: "COMPLETED",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  },
  removed: {
    label: "REMOVED",
    className: "bg-muted text-muted-foreground border-transparent",
  },
  failed: {
    label: "FAILED",
    className: "bg-destructive/15 text-destructive border-destructive/25",
  },
  building: {
    label: "BUILDING",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  },
  deploying: {
    label: "DEPLOYING",
    className: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  },
  initializing: {
    label: "INITIALIZING",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  },
};

// ---------------------------------------------------------------------------
// Step icon
// ---------------------------------------------------------------------------

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "completed":
      return <HugeiconsIcon icon={Tick01Icon} size={16} className="text-emerald-400" />;
    case "failed":
      return <HugeiconsIcon icon={Cancel01Icon} size={16} className="text-destructive" />;
    case "not_started":
      return <HugeiconsIcon icon={CircleIcon} size={16} className="text-muted-foreground" />;
  }
}

// ---------------------------------------------------------------------------
// Deployment steps list
// ---------------------------------------------------------------------------

function StepsList({
  steps,
  variant,
}: {
  steps: DeploymentStep[];
  variant: "success" | "error" | "progress";
}) {
  const borderColor =
    variant === "error"
      ? "border-destructive/30"
      : variant === "progress"
        ? "border-blue-500/30"
        : "border-emerald-500/30";
  const bgColor =
    variant === "error"
      ? "bg-destructive/5"
      : variant === "progress"
        ? "bg-blue-500/5"
        : "bg-emerald-500/5";

  return (
    <div className={`border-l-2 ${borderColor} ${bgColor}`}>
      {steps.map((step) => (
        <div key={step.name}>
          <div className="flex items-center gap-3 px-6 py-3">
            <StepIcon status={step.status} />
            <span className="flex-1 text-sm font-medium">{step.name}</span>
            {step.duration && (
              <span className="text-sm text-muted-foreground">({step.duration})</span>
            )}
            {step.status === "not_started" && (
              <span className="text-sm text-muted-foreground">Not started</span>
            )}
          </div>
          {step.children?.map((child) => (
            <div key={child.name}>
              <div className="flex items-center gap-3 px-6 py-2 pl-12">
                <StepIcon status={child.status} />
                <span className="flex-1 text-sm">{child.name}</span>
                {child.duration && (
                  <span className="text-sm text-muted-foreground">({child.duration})</span>
                )}
              </div>
              {child.error && (
                <div className="px-6 pb-3 pl-12">
                  <pre className="text-sm text-destructive whitespace-pre-wrap">{child.error}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deployment card
// ---------------------------------------------------------------------------

function DeploymentCard({
  deployment,
  active = false,
  onViewLogs,
}: {
  deployment: Deployment;
  active?: boolean;
  onViewLogs?: (id: string) => void;
}) {
  const style = STATUS_STYLES[deployment.status];
  const isFailed = deployment.status === "failed";
  const deploying = isInProgress(deployment.status);
  const hasDetails = deployment.message && deployment.steps;

  const bannerBorder = isFailed
    ? "border-destructive/20"
    : deploying
      ? "border-blue-500/20"
      : "border-emerald-500/20";
  const bannerBg = isFailed
    ? "bg-destructive/10"
    : deploying
      ? "bg-blue-500/10"
      : "bg-emerald-500/10";
  const bannerIcon = isFailed ? (
    <HugeiconsIcon icon={AlertCircleIcon} size={16} className="text-destructive" />
  ) : deploying ? (
    <HugeiconsIcon icon={Loading03Icon} size={16} className="text-blue-400 animate-spin" />
  ) : (
    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={16} className="text-emerald-400" />
  );
  const bannerTextColor = isFailed
    ? "text-destructive"
    : deploying
      ? "text-blue-400"
      : "text-emerald-400";

  const stepsVariant = isFailed
    ? ("error" as const)
    : deploying
      ? ("progress" as const)
      : ("success" as const);

  return (
    <div className="bg-card ring-foreground/10 overflow-hidden rounded-xl ring-1">
      <div className="flex items-center gap-3 px-4 py-3">
        <Badge
          variant="outline"
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${style.className}`}
        >
          {style.label}
        </Badge>

        <HugeiconsIcon icon={Package01Icon} size={20} className="shrink-0 text-muted-foreground" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{deployment.image}</p>
          <p className="text-xs text-muted-foreground">
            {deployment.timeAgo} via {deployment.source}
          </p>
        </div>

        {(active || deployment.showLogs || deploying) && (
          <Button variant="outline" size="sm" onClick={() => onViewLogs?.(deployment.id)}>
            View logs
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
            <HugeiconsIcon icon={MoreVerticalIcon} size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onViewLogs?.(deployment.id)}>
              View logs
            </DropdownMenuItem>
            <DropdownMenuItem>Redeploy</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">Remove</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {hasDetails && (
        <Collapsible>
          <CollapsibleTrigger
            className={`flex w-full items-center gap-2 border-t ${bannerBorder} ${bannerBg} px-4 py-2`}
          >
            {bannerIcon}
            <span className={`flex-1 text-left text-sm ${bannerTextColor}`}>
              {deployment.message}
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={16}
              className="text-muted-foreground transition-transform [[data-panel-open]_&]:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <StepsList steps={deployment.steps!} variant={stepsVariant} />
          </CollapsibleContent>
        </Collapsible>
      )}

      {deployment.message && !deployment.steps && (
        <div className={`flex items-center gap-2 border-t ${bannerBorder} ${bannerBg} px-4 py-2`}>
          {bannerIcon}
          <span className={`text-sm ${bannerTextColor}`}>{deployment.message}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface DeploymentsPanelProps {
  resourceId: string;
  resourceKind: string;
  resourceStatus: string;
  resourceName?: string;
  onViewLogs?: (deploymentId: string) => void;
  onDeploymentsChange?: (deployments: DeploymentInfo[]) => void;
}

export function DeploymentsPanel({
  resourceId,
  resourceKind,
  resourceStatus,
  resourceName,
  onViewLogs,
  onDeploymentsChange,
}: DeploymentsPanelProps) {
  const { onRedeploy } = useProjectContext();
  const rawDeployments = useQuery(queries.deployment.listForResource({ resourceId }));
  const deployments = rawDeployments[0] ?? [];

  // Sort by createdAt descending
  const sorted = [...deployments].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  // Map Zero rows to UI Deployment type
  const mapped: Deployment[] = sorted.map((d) => {
    const uiStatus = mapDeploymentStatus(d.status);
    const events = d.events ?? [];
    const steps = mapEventsToSteps(events);
    const hasSteps = steps.some((s) => s.status !== "not_started");

    let message: string | undefined;
    if (uiStatus === "active") {
      message = "Deployment successful";
    } else if (uiStatus === "failed") {
      const failEvent = events.find((e) => e.status === "failed" || e.status === "canceled");
      message = failEvent?.reason ?? "Deployment failed";
    } else if (isInProgress(uiStatus)) {
      message = getDeployingMessage(events);
    }

    return {
      id: d.id,
      image: d.gitCommitMessage ?? d.imageTag ?? `${d.source ?? "manual"} deployment`,
      timeAgo: formatTimeAgo(d.createdAt),
      source: d.source ?? "manual",
      status: uiStatus,
      message,
      showLogs: uiStatus === "failed" || uiStatus === "active",
      steps: hasSteps ? steps : undefined,
      createdAt: d.createdAt ?? undefined,
    };
  });

  // Synthetic card when the resource has a meaningful status but no deployment rows
  // (e.g. database provisioning which doesn't create deployment rows)
  if (mapped.length === 0 && resourceStatus !== "unknown" && resourceStatus !== "stopped") {
    const resourceIsDeploying = resourceStatus === "deploying";
    const resourceIsOnline = resourceStatus === "online" || resourceStatus === "degraded";
    const resourceIsCrashed = resourceStatus === "crashed";
    const label = resourceName ?? resourceKind;

    if (resourceIsDeploying) {
      mapped.push({
        id: "__provisioning__",
        image: label,
        timeAgo: "just now",
        source: "manual",
        status: "initializing",
        message: "Deployment in progress:  Provisioning resource...",
        showLogs: true,
      });
    } else if (resourceIsOnline) {
      mapped.push({
        id: "__provisioned__",
        image: label,
        timeAgo: "",
        source: "manual",
        status: "active",
        message: "Deployment successful",
        showLogs: true,
      });
    } else if (resourceIsCrashed) {
      mapped.push({
        id: "__crashed__",
        image: label,
        timeAgo: "",
        source: "manual",
        status: "failed",
        message: "Resource crashed",
        showLogs: true,
      });
    }
  }

  const activeDeployment = mapped.find((d) => d.status === "active");
  const inProgressDeployment = mapped.find((d) => isInProgress(d.status));
  const history = mapped.filter((d) => d !== activeDeployment && d !== inProgressDeployment);
  const isDeploying = resourceStatus === "deploying" || !!inProgressDeployment;

  useEffect(() => {
    if (!onDeploymentsChange) return;
    onDeploymentsChange(
      mapped.map((deployment) => ({
        id: deployment.id,
        status: deployment.status,
        image: deployment.image,
        source: deployment.source,
        createdAt: deployment.createdAt,
        message: deployment.message,
        steps: deployment.steps,
      })),
    );
  }, [mapped, onDeploymentsChange]);

  const redeployButton = (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5" disabled={isDeploying} />}
      >
        <RotateCwIcon className="size-3.5" />
        {isDeploying ? "Deploying..." : mapped.length === 0 ? "Deploy" : "Redeploy"}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Redeploy deployment</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to redeploy this deployment? This will rebuild and deploy your
            code with the exact same configuration.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => onRedeploy({ id: resourceId, kind: resourceKind })}>
            Redeploy
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const hasNoContent = mapped.length === 0;

  const handleViewLogs = (deploymentId: string) => {
    onViewLogs?.(deploymentId);
  };

  return (
    <div className="space-y-4 pt-4">
      <div className={`flex items-center ${hasNoContent ? "justify-between" : "justify-end"}`}>
        {hasNoContent && <p className="text-sm text-muted-foreground">No deployments yet.</p>}
        {redeployButton}
      </div>

      {activeDeployment && (
        <DeploymentCard deployment={activeDeployment} active onViewLogs={handleViewLogs} />
      )}

      {inProgressDeployment && (
        <DeploymentCard deployment={inProgressDeployment} onViewLogs={handleViewLogs} />
      )}

      {history.length > 0 && (
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="flex w-full items-center gap-2 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={16}
              className="transition-transform [[data-panel-open]_&]:rotate-0 [[data-panel-closed]_&]:-rotate-90"
            />
            History
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3">
              {history.map((d) => (
                <DeploymentCard key={d.id} deployment={d} onViewLogs={handleViewLogs} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

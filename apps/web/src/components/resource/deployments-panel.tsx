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
  GlobeIcon,
  Location01Icon,
  MoreVerticalIcon,
  Package01Icon,
  Tick01Icon,
  Wifi01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

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

interface Deployment {
  id: string;
  image: string;
  timeAgo: string;
  source: string;
  status: "active" | "completed" | "removed" | "failed" | "building";
  message?: string;
  showLogs?: boolean;
  steps?: DeploymentStep[];
}

interface ServiceInfo {
  domain: string;
  region: string;
  replicas: number;
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const SERVICE_INFO: ServiceInfo = {
  domain: "repoweb-production-b6a6.up.railway.app",
  region: "europe-west4-drams3a",
  replicas: 1,
};

const ACTIVE_DEPLOYMENT: Deployment = {
  id: "1",
  image: "refactor: update ZeroQueryProvider to us...",
  timeAgo: "3 months ago",
  source: "GitHub",
  status: "active",
  message: "Deployment successful",
  showLogs: true,
  steps: [
    { name: "Initialization", status: "completed", duration: "00:10" },
    { name: "Build", status: "completed", duration: "06:01" },
    { name: "Deploy", status: "completed", duration: "00:38" },
    { name: "Post-deploy", status: "completed", duration: "00:00" },
  ],
};

const DEPLOYMENT_HISTORY: Deployment[] = [
  {
    id: "2",
    image: "refactor: remove unused WarnIfOffline an...",
    timeAgo: "2 months ago",
    source: "GitHub",
    status: "failed",
    message: "Deployment failed during build process",
    showLogs: true,
    steps: [
      { name: "Initialization", status: "completed", duration: "00:27" },
      {
        name: "Build",
        status: "failed",
        children: [
          {
            name: "Build › Build image",
            status: "failed",
            duration: "01:51",
            error: "Failed to build an image. Please check the build logs for more details.",
          },
        ],
      },
      { name: "Deploy", status: "not_started" },
      { name: "Post-deploy", status: "not_started" },
    ],
  },
  {
    id: "3",
    image: "refactor: rename build script to build:dev i...",
    timeAgo: "2 months ago",
    source: "GitHub",
    status: "failed",
  },
  {
    id: "4",
    image: "Merge pull request #21 from next-oral/fea...",
    timeAgo: "2 months ago",
    source: "GitHub",
    status: "failed",
  },
  {
    id: "5",
    image: "Merge pull request #19 from next-oral/fea...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "failed",
    showLogs: true,
  },
  {
    id: "6",
    image: "feat: enhance sidebar components with n...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "failed",
  },
  {
    id: "7",
    image: "feat: add webworker support in TypeScri...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "failed",
  },
  {
    id: "8",
    image: "feat: integrate Serwist for service worker ...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "failed",
  },
  {
    id: "9",
    image: "feat: integrate PostHog for feature flags a...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "failed",
  },
  {
    id: "10",
    image: "fix: update logging message in proxy func...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "removed",
  },
  {
    id: "11",
    image: "chore: remove m.html file and update Rea...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "removed",
  },
  {
    id: "12",
    image: "chore: update package versions in pnpm-...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "removed",
  },
  {
    id: "13",
    image: "feat: integrate @vercel/toolbar for enhan...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "removed",
  },
  {
    id: "14",
    image: "refactor: integrate @rocicorp/zero and up...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "removed",
  },
  {
    id: "15",
    image: "fix: refine proxy URL handling in middlew...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "removed",
  },
  {
    id: "16",
    image: "fix: refine proxy URL handling in middlew...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "removed",
  },
  {
    id: "17",
    image: "fix: refine proxy URL handling in middlew...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "removed",
  },
  {
    id: "18",
    image: "fix: correct proxy URL format in middlewa...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "removed",
  },
  {
    id: "19",
    image: "fix: correct proxy URL format in middlewa...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "removed",
  },
  {
    id: "20",
    image: "fix: update proxy URL handling in middle...",
    timeAgo: "3 months ago",
    source: "GitHub",
    status: "removed",
  },
];

// ---------------------------------------------------------------------------
// Status styles
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<Deployment["status"], { label: string; className: string }> = {
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

function StepsList({ steps, variant }: { steps: DeploymentStep[]; variant: "success" | "error" }) {
  const borderColor = variant === "success" ? "border-emerald-500/30" : "border-destructive/30";
  const bgColor = variant === "success" ? "bg-emerald-500/5" : "bg-destructive/5";

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
                  <pre className="text-sm text-destructive">
                    {child.error
                      .split(/(Please check the build logs for more details\.)/)
                      .map((part, i) =>
                        part === "Please check the build logs for more details." ? (
                          <a
                            key={i}
                            href="#"
                            className="underline underline-offset-2 hover:text-destructive/80 transition-colors"
                          >
                            {part}
                          </a>
                        ) : (
                          <span key={i}>{part}</span>
                        ),
                      )}
                  </pre>
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
}: {
  deployment: Deployment;
  active?: boolean;
}) {
  const style = STATUS_STYLES[deployment.status];
  const isFailed = deployment.status === "failed";
  const isSuccess = deployment.status === "active" || deployment.status === "completed";
  const hasDetails = deployment.message && deployment.steps;

  const bannerBorder = isFailed ? "border-destructive/20" : "border-emerald-500/20";
  const bannerBg = isFailed ? "bg-destructive/10" : "bg-emerald-500/10";
  const bannerIcon = isFailed ? (
    <HugeiconsIcon icon={AlertCircleIcon} size={16} className="text-destructive" />
  ) : (
    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={16} className="text-emerald-400" />
  );
  const bannerTextColor = isFailed ? "text-destructive" : "text-emerald-400";

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

        {(active || deployment.showLogs) && (
          <Button variant="outline" size="sm">
            View logs
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
            <HugeiconsIcon icon={MoreVerticalIcon} size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>View logs</DropdownMenuItem>
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
            <StepsList steps={deployment.steps!} variant={isFailed ? "error" : "success"} />
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

export function DeploymentsPanel() {
  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <a
          href={`https://${SERVICE_INFO.domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          <HugeiconsIcon icon={GlobeIcon} size={16} />
          {SERVICE_INFO.domain}
        </a>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <HugeiconsIcon icon={Location01Icon} size={14} />
            {SERVICE_INFO.region}
          </span>
          <span className="flex items-center gap-1.5">
            <HugeiconsIcon icon={Wifi01Icon} size={14} />
            {SERVICE_INFO.replicas} Replica
            {SERVICE_INFO.replicas !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <DeploymentCard deployment={ACTIVE_DEPLOYMENT} active />

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
            {DEPLOYMENT_HISTORY.map((d) => (
              <DeploymentCard key={d.id} deployment={d} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

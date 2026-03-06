import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getOrganizationId, orpc } from "@/utils/orpc";
import { env } from "@otterdeploy/env/web";
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  CircleIcon,
  FileSearchIcon,
  Loading03Icon,
  MoreHorizontalCircle01Icon,
  Settings01Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { DownloadIcon, ExternalLinkIcon, SearchIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

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

export interface DeploymentInfo {
  id: string;
  status: string;
  image: string;
  source: string;
  createdAt?: number;
  message?: string;
  steps?: DeploymentStep[];
}

interface DeploymentLogsPanelProps {
  deployment: DeploymentInfo;
  resourceId: string;
  resourceName: string;
  logTab: "build" | "deploy" | "runtime";
  onLogTabChange: (tab: "build" | "deploy" | "runtime") => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_BADGE_STYLES: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  removed: "bg-muted text-muted-foreground border-transparent",
  failed: "bg-destructive/15 text-destructive border-destructive/25",
  building: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  deploying: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  initializing: "bg-blue-500/15 text-blue-400 border-blue-500/25",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  removed: "Removed",
  failed: "Failed",
  building: "Building",
  deploying: "Deploying",
  initializing: "Initializing",
};

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const month = d.toLocaleString(undefined, { month: "short" });
  const day = d.getDate();
  const year = d.getFullYear();
  const time = d.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const tz = d.toLocaleString(undefined, { timeZoneName: "short" }).split(" ").pop();
  return `${month} ${day}, ${year}, ${time} ${tz}`;
}

function formatLogTimestamp(ts: string): string {
  const d = new Date(ts);
  const month = d.toLocaleString(undefined, { month: "short" });
  const day = String(d.getDate()).padStart(2, "0");
  const year = d.getFullYear();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${month} ${day} ${year} ${h}:${m}:${s}`;
}

// ---------------------------------------------------------------------------
// Step icon (reusing the pattern from deployments-panel)
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
// Deployment steps banner (Railway-style collapsible)
// ---------------------------------------------------------------------------

function DeploymentStepsBanner({
  message,
  steps,
}: {
  message: string;
  steps: DeploymentStep[];
}) {
  const hasFailed = steps.some((s) => s.status === "failed");
  const inProgress = steps.some(
    (s) => s.status === "not_started" && steps.some((p) => p.status === "completed"),
  );

  const bannerBorder = hasFailed
    ? "border-destructive/20"
    : inProgress
      ? "border-blue-500/20"
      : "border-emerald-500/20";
  const bannerBg = hasFailed
    ? "bg-destructive/10"
    : inProgress
      ? "bg-blue-500/10"
      : "bg-emerald-500/10";
  const bannerTextColor = hasFailed
    ? "text-destructive"
    : inProgress
      ? "text-blue-400"
      : "text-emerald-400";
  const bannerIcon = hasFailed ? (
    <HugeiconsIcon icon={AlertCircleIcon} size={16} className="text-destructive" />
  ) : inProgress ? (
    <HugeiconsIcon icon={Loading03Icon} size={16} className="animate-spin text-blue-400" />
  ) : (
    <HugeiconsIcon icon={CheckmarkCircle01Icon} size={16} className="text-emerald-400" />
  );

  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger
        className={`flex w-full items-center gap-2 rounded-lg border ${bannerBorder} ${bannerBg} px-4 py-2.5`}
      >
        {bannerIcon}
        <span className={`flex-1 text-left text-sm font-medium ${bannerTextColor}`}>
          {message}
        </span>
        <span className="text-xs text-muted-foreground">View less</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={14}
          className="text-muted-foreground transition-transform [[data-panel-open]_&]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-px space-y-0">
          {steps.map((step) => (
            <div
              key={step.name}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <StepIcon status={step.status} />
              <span className="flex-1 text-sm">{step.name}</span>
              {step.duration && (
                <span className="font-mono text-xs text-muted-foreground">
                  ({step.duration})
                </span>
              )}
              {step.status === "not_started" && (
                <span className="text-xs text-muted-foreground">Not started</span>
              )}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function LogsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
        <HugeiconsIcon icon={FileSearchIcon} size={24} className="text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">No logs in this time range</p>
        <p className="text-sm text-muted-foreground">
          Logs will show up here as they are found.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log search bar (Railway-style)
// ---------------------------------------------------------------------------

function LogSearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter and search logs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-9 pr-10"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-white/10 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          /
        </kbd>
      </div>
      <Button variant="outline" size="icon-sm" className="shrink-0">
        <DownloadIcon className="size-3.5" />
      </Button>
      <Button variant="outline" size="icon-sm" className="shrink-0">
        <ExternalLinkIcon className="size-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log table (Railway-style)
// ---------------------------------------------------------------------------

function LogTable({
  items,
  search,
  onSearchChange,
}: {
  items: readonly { timestamp: string; message: string; level?: string }[];
  search: string;
  onSearchChange: (v: string) => void;
}) {
  const filtered = search
    ? items.filter((l) => l.message.toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <div className="flex flex-col gap-3">
      <LogSearchBar value={search} onChange={onSearchChange} />
      {filtered.length === 0 ? (
        <LogsEmptyState />
      ) : (
        <>
          <div className="flex items-center border-b border-white/10 pb-1.5 text-xs text-muted-foreground">
            <span className="w-48 shrink-0 px-3 font-medium">
              Time ({Intl.DateTimeFormat().resolvedOptions().timeZone.split("/").pop()})
            </span>
            <span className="flex-1 px-3 font-medium">Data</span>
            <Button variant="ghost" size="icon-sm" className="shrink-0">
              <HugeiconsIcon icon={Settings01Icon} size={14} />
            </Button>
          </div>
          <div className="overflow-auto font-mono text-xs">
            {filtered.map((log, i) => (
              <div
                key={i}
                className="group flex border-l-2 border-white/10 hover:bg-white/[0.02]"
              >
                <span className="w-48 shrink-0 whitespace-nowrap px-3 py-1 text-muted-foreground">
                  {formatLogTimestamp(log.timestamp)}
                </span>
                <span className="flex-1 break-all px-3 py-1">{log.message}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details tab (Railway-style)
// ---------------------------------------------------------------------------

function DetailsTab({ deployment }: { deployment: DeploymentInfo }) {
  return (
    <div className="space-y-6">
      {/* Steps banner */}
      {deployment.message && deployment.steps && deployment.steps.length > 0 && (
        <DeploymentStepsBanner message={deployment.message} steps={deployment.steps} />
      )}

      {/* Message without steps */}
      {deployment.message && (!deployment.steps || deployment.steps.length === 0) && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5">
          <HugeiconsIcon icon={CheckmarkCircle01Icon} size={16} className="text-emerald-400" />
          <span className="text-sm font-medium text-emerald-400">{deployment.message}</span>
        </div>
      )}

      {/* Configuration grid */}
      <div className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Configuration
        </h3>
        <div className="grid grid-cols-2 gap-6">
          {/* Build */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <HugeiconsIcon icon={Settings01Icon} size={14} className="text-muted-foreground" />
              Build
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-xs text-muted-foreground">Source</span>
                <p className="font-medium">{deployment.source}</p>
              </div>
            </div>
          </div>
          {/* Deploy */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <HugeiconsIcon icon={Loading03Icon} size={14} className="text-muted-foreground" />
              Deploy
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-xs text-muted-foreground">Started at</span>
                <p className="font-medium">{formatTimestamp(deployment.createdAt)}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Image</span>
                <p className="font-medium">{deployment.image}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function DeploymentLogsPanel({
  deployment,
  resourceId,
  resourceName,
  logTab,
  onLogTabChange,
  onClose,
}: DeploymentLogsPanelProps) {
  const shortId = deployment.id.slice(0, 7);
  const badgeStyle = STATUS_BADGE_STYLES[deployment.status] ?? STATUS_BADGE_STYLES.initializing;
  const statusLabel = STATUS_LABELS[deployment.status] ?? deployment.status;

  const [buildSearch, setBuildSearch] = useState("");
  const [deploySearch, setDeploySearch] = useState("");
  const [runtimeSearch, setRuntimeSearch] = useState("");

  const isSyntheticDeployment = deployment.id.startsWith("__");
  const shouldStreamLive =
    !isSyntheticDeployment &&
    (deployment.status === "initializing" ||
      deployment.status === "building" ||
      deployment.status === "deploying");

  const { data: deploymentLogsData } = useQuery({
    ...orpc.deployment.streamLogs.queryOptions({
      input: { deploymentId: deployment.id, limit: 2 * 1024 * 1024 },
    }),
    enabled: !isSyntheticDeployment,
  });

  const { data: runtimeLogsData, error: runtimeLogsError } = useQuery({
    ...orpc.monitoring.getLogs.queryOptions({
      input: { resourceId, page: 1, pageSize: 100 },
    }),
    enabled: logTab === "runtime" || isSyntheticDeployment,
  });

  const [deploymentLogItems, setDeploymentLogItems] = useState<
    Array<{
      id: string;
      deploymentId: string;
      timestamp: string;
      tab: "build" | "deploy" | "runtime";
      level: "debug" | "info" | "warn" | "error";
      message: string;
    }>
  >([]);

  useEffect(() => {
    setDeploymentLogItems((deploymentLogsData?.items as typeof deploymentLogItems) ?? []);
    setBuildSearch("");
    setDeploySearch("");
    setRuntimeSearch("");
  }, [deployment.id, deploymentLogsData?.cursor, deploymentLogsData?.nextCursor]);

  useEffect(() => {
    if (!shouldStreamLive) return;

    const wsUrl = new URL("/listen-deployment", env.VITE_SERVER_URL);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.searchParams.set("deploymentId", deployment.id);
    const organizationId = getOrganizationId();
    if (organizationId) {
      wsUrl.searchParams.set("organizationId", organizationId);
    }

    const socket = new WebSocket(wsUrl.toString());

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string) as {
          type: string;
          log?: {
            id?: string;
            deploymentId: string;
            timestamp: string;
            tab: "build" | "deploy" | "runtime";
            level: "debug" | "info" | "warn" | "error";
            message: string;
          };
        };
        if (payload.type !== "log" || !payload.log) return;
        if (payload.log.deploymentId !== deployment.id) return;

        const id =
          payload.log.id ??
          `${payload.log.timestamp}:${payload.log.tab}:${payload.log.message}`;

        setDeploymentLogItems((prev) => {
          if (prev.some((item) => item.id === id)) return prev;
          const next = [...prev, { ...payload.log!, id }];
          return next.slice(-5000);
        });
      } catch {
        // Ignore malformed messages to keep streaming resilient.
      }
    };

    return () => {
      socket.close();
    };
  }, [deployment.id, shouldStreamLive]);

  const buildLogs = useMemo(
    () => deploymentLogItems.filter((item) => item.tab === "build"),
    [deploymentLogItems],
  );
  const deployLogs = useMemo(
    () => deploymentLogItems.filter((item) => item.tab === "deploy"),
    [deploymentLogItems],
  );
  const runtimeLogs = useMemo(
    () =>
      isSyntheticDeployment
        ? (runtimeLogsData?.items ?? [])
        : (runtimeLogsData?.items ?? deploymentLogItems.filter((item) => item.tab === "runtime")),
    [deploymentLogItems, isSyntheticDeployment, runtimeLogsData?.items],
  );

  const runtimeLogsWithErrors = useMemo(() => {
    if (!runtimeLogsError) return runtimeLogs;
    return [
      ...runtimeLogs,
      {
        id: "runtime-log-query-error",
        timestamp: new Date().toISOString(),
        message:
          runtimeLogsError instanceof Error
            ? `Failed to load runtime logs: ${runtimeLogsError.message}`
            : "Failed to load runtime logs",
        deploymentId: deployment.id,
        tab: "runtime" as const,
        level: "error" as const,
      },
    ];
  }, [deployment.id, runtimeLogs, runtimeLogsError]);

  return (
    <motion.div
      key="deployment-logs-panel"
      className="absolute inset-0 z-10 flex flex-col bg-background"
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "tween", duration: 0.25 }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-base font-semibold">{resourceName}</span>
          <span className="text-base text-muted-foreground">/</span>
          <span className="text-base font-medium text-muted-foreground">{shortId}</span>
        </div>
        <Badge
          variant="outline"
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badgeStyle}`}
        >
          {statusLabel}
        </Badge>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
            <HugeiconsIcon icon={MoreHorizontalCircle01Icon} size={18} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Restart</DropdownMenuItem>
            <DropdownMenuItem>Redeploy</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">Remove</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-xs text-muted-foreground">
          {formatTimestamp(deployment.createdAt)}
        </span>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} size={18} />
        </Button>
      </div>

      {/* Tabbed content */}
      <Tabs
        value={logTab}
        onValueChange={(value) => onLogTabChange(value as "build" | "deploy" | "runtime")}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="border-b border-white/10 px-5">
          <TabsList variant="line">
            <TabsTrigger value="build">Build Logs</TabsTrigger>
            <TabsTrigger value="deploy">Deploy Logs</TabsTrigger>
            <TabsTrigger value="runtime">Runtime Logs</TabsTrigger>
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <TabsContent value="build">
            <LogTable items={buildLogs} search={buildSearch} onSearchChange={setBuildSearch} />
          </TabsContent>

          <TabsContent value="deploy">
            <LogTable items={deployLogs} search={deploySearch} onSearchChange={setDeploySearch} />
          </TabsContent>

          <TabsContent value="runtime">
            <LogTable
              items={runtimeLogsWithErrors}
              search={runtimeSearch}
              onSearchChange={setRuntimeSearch}
            />
          </TabsContent>
        </div>
      </Tabs>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Wrapper with AnimatePresence for parent use
// ---------------------------------------------------------------------------

export function DeploymentLogsPanelPresence({
  deployment,
  ...rest
}: Omit<DeploymentLogsPanelProps, "deployment"> & { deployment: DeploymentInfo | null }) {
  return (
    <AnimatePresence>
      {deployment && <DeploymentLogsPanel deployment={deployment} {...rest} />}
    </AnimatePresence>
  );
}

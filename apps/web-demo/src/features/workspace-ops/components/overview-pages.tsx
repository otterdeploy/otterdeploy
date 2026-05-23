import {
  AlertTriangleIcon,
  ArrowUpRightIcon,
  Clock3Icon,
  ContainerIcon,
  GaugeIcon,
  HardDriveIcon,
  Layers3Icon,
  NetworkIcon,
  ServerIcon,
  WorkflowIcon,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Toolbar, ToolbarButton, ToolbarSeparator } from "../ui/toolbar";

export function MonitoringOverview() {
  return (
    <div className="grid gap-4">
      <PageHeader
        title="Monitoring"
        description="Cluster health across services, ingress, certificates, and build capacity."
      />
      <Toolbar className="flex items-center gap-1 rounded-lg border bg-background p-1">
        <ToolbarButton disabled>Last 24h</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton disabled>All projects</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton disabled>Alert rules</ToolbarButton>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" disabled>
          Export
        </Button>
      </Toolbar>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="CPU saturation"
          value="61%"
          detail="2 nodes above target, autoscale queued"
          icon={<GaugeIcon className="size-4" />}
        />
        <MetricCard
          title="Ingress p95"
          value="182 ms"
          detail="Requests trending down after last deploy"
          icon={<ArrowUpRightIcon className="size-4" />}
        />
        <MetricCard
          title="Certificates due"
          value="1"
          detail="One custom PEM chain expires in 11 days"
          icon={<Clock3Icon className="size-4" />}
        />
        <MetricCard
          title="Open incidents"
          value="2"
          detail="One degraded route, one slow image pull"
          icon={<AlertTriangleIcon className="size-4" />}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Service health</CardTitle>
            <CardDescription>
              Top workloads by pressure and deployment confidence.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead>Memory</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  ["api", "paperhouse-web", "72%", "1.8 GB", "healthy"],
                  ["worker", "paperhouse-web", "84%", "2.4 GB", "watch"],
                  ["analytics", "ops", "39%", "740 MB", "healthy"],
                  ["preview-builder", "platform", "91%", "3.1 GB", "degraded"],
                ].map(([service, project, cpu, memory, status]) => (
                  <TableRow key={service}>
                    <TableCell className="font-medium">{service}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {project}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {cpu}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {memory}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Incident queue</CardTitle>
            <CardDescription>
              High-signal issues surfaced from builds, ingress, and backup jobs.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 pt-0">
            <AlertRow
              title="preview-builder image pull slowness"
              detail="Registry auth fallback added 13s to the last deploy."
              status="watch"
            />
            <AlertRow
              title="console.paperhouse.dev certificate"
              detail="Custom chain expires soon and needs rotation."
              status="renew soon"
            />
            <AlertRow
              title="nightly volume backup"
              detail="Completed with retry against the cold-storage destination."
              status="healthy"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function RequestsOverview() {
  return (
    <div className="grid gap-4">
      <PageHeader
        title="Requests"
        description="Edge access logs for every request flowing through the workspace ingress."
      />
      <Toolbar className="flex items-center gap-1 rounded-lg border bg-background p-1">
        <ToolbarButton disabled>Last 15m</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton disabled>All hosts</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton disabled>Any status</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton disabled>Search path</ToolbarButton>
      </Toolbar>
      <Card>
        <CardHeader>
          <CardTitle>Recent edge traffic</CardTitle>
          <CardDescription>
            Caddy access log stream for public routes. Retention and export
            policies will plug into this view.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Method</TableHead>
                <TableHead>Host</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Latency</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                [
                  "GET",
                  "app.paperhouse.dev",
                  "/api/health",
                  "200",
                  "38 ms",
                  "DE",
                ],
                [
                  "POST",
                  "app.paperhouse.dev",
                  "/api/deploy/hooks/github",
                  "202",
                  "118 ms",
                  "US",
                ],
                [
                  "GET",
                  "console.paperhouse.dev",
                  "/settings",
                  "304",
                  "24 ms",
                  "FR",
                ],
                [
                  "GET",
                  "preview.otterstack.dev",
                  "/assets/index.js",
                  "503",
                  "861 ms",
                  "GB",
                ],
              ].map(([method, host, path, status, latency, source]) => (
                <TableRow key={`${method}-${host}-${path}`}>
                  <TableCell className="font-medium">{method}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {host}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {path}
                  </TableCell>
                  <TableCell>
                    <StatusCodeBadge code={status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {latency}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {source}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function DockerResourcesOverview() {
  return (
    <div className="grid gap-4">
      <PageHeader
        title="Docker"
        description="Raw daemon-level inventory for containers, images, volumes, and networks outside the project abstraction."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Running containers"
          value="28"
          detail="3 unmanaged sidecars are flagged for review"
          icon={<ContainerIcon className="size-4" />}
        />
        <MetricCard
          title="Images cached"
          value="94"
          detail="17 are older than 14 days"
          icon={<Layers3Icon className="size-4" />}
        />
        <MetricCard
          title="Persistent volumes"
          value="32"
          detail="6 detached volumes can be pruned"
          icon={<HardDriveIcon className="size-4" />}
        />
        <MetricCard
          title="Networks"
          value="11"
          detail="2 bridge networks are non-project scoped"
          icon={<NetworkIcon className="size-4" />}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Containers</CardTitle>
            <CardDescription>
              Useful when something is stuck outside the Stack abstraction.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Image</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  ["caddy", "caddy:2.9", "ingress", "healthy"],
                  ["registry-cache", "registry:2", "cluster", "healthy"],
                  [
                    "preview-builder-7",
                    "ghcr.io/paperhouse/builder:canary",
                    "unmanaged",
                    "watch",
                  ],
                  ["volume-restorer", "alpine:3.22", "maintenance", "idle"],
                ].map(([name, image, scope, status]) => (
                  <TableRow key={name}>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {image}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {scope}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Volumes</CardTitle>
            <CardDescription>
              Track attach state, ownership, and backup eligibility.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Volume</TableHead>
                  <TableHead>Attached to</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  ["postgres_data", "postgres-primary", "14 GB", "healthy"],
                  ["builder_cache", "preview-builder-7", "9 GB", "watch"],
                  ["staging_uploads", "api", "4.2 GB", "healthy"],
                  [
                    "orphaned_restore_2026_05_01",
                    "detached",
                    "1.8 GB",
                    "prune",
                  ],
                ].map(([name, attachedTo, size, status]) => (
                  <TableRow key={name}>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {attachedTo}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {size}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function SwarmOverview() {
  return (
    <div className="grid gap-4">
      <PageHeader
        title="Swarm"
        description="Cluster orchestration status across managers, workers, services, and pending tasks."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Managers"
          value="3 / 3"
          detail="Raft quorum healthy"
          icon={<ServerIcon className="size-4" />}
        />
        <MetricCard
          title="Workers"
          value="5"
          detail="1 node draining for maintenance"
          icon={<WorkflowIcon className="size-4" />}
        />
        <MetricCard
          title="Services"
          value="43"
          detail="2 canary rollouts active"
          icon={<Layers3Icon className="size-4" />}
        />
        <MetricCard
          title="Pending tasks"
          value="1"
          detail="Waiting on private registry auth refresh"
          icon={<Clock3Icon className="size-4" />}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Nodes</CardTitle>
            <CardDescription>
              Placement, availability, and health at the swarm layer.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Node</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Availability</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  ["fra-manager-1", "manager", "active", "healthy"],
                  ["fra-manager-2", "manager", "active", "healthy"],
                  ["fra-worker-1", "worker", "drain", "watch"],
                  ["fra-worker-gpu-1", "worker", "active", "healthy"],
                ].map(([name, role, availability, status]) => (
                  <TableRow key={name}>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {role}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {availability}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Service rollouts</CardTitle>
            <CardDescription>
              Current placement and deployment state.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Replicas</TableHead>
                  <TableHead>Placement</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  ["api", "4 / 4", "spread by zone", "healthy"],
                  ["worker", "6 / 6", "workers only", "healthy"],
                  ["preview-builder", "1 / 2", "gpu preferred", "degraded"],
                  ["caddy", "3 / 3", "managers only", "healthy"],
                ].map(([name, replicas, placement, status]) => (
                  <TableRow key={name}>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {replicas}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {placement}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="grid gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function MetricCard({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardDescription>{title}</CardDescription>
          <div className="rounded-md border bg-background p-2 text-muted-foreground">
            {icon}
          </div>
        </div>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm text-muted-foreground">
        {detail}
      </CardContent>
    </Card>
  );
}

function AlertRow({
  title,
  detail,
  status,
}: {
  title: string;
  detail: string;
  status: string;
}) {
  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-sm text-muted-foreground">{detail}</div>
        </div>
        <StatusBadge status={status} />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const variant =
    normalized === "healthy"
      ? "success"
      : normalized === "watch" || normalized === "renew soon"
        ? "warning"
        : normalized === "degraded"
          ? "error"
          : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}

function StatusCodeBadge({ code }: { code: string }) {
  const variant = code.startsWith("2")
    ? "success"
    : code.startsWith("3")
      ? "info"
      : code.startsWith("4")
        ? "warning"
        : "error";
  return <Badge variant={variant}>{code}</Badge>;
}

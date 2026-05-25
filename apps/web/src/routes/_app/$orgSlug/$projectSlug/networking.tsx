import { useMemo, useState } from "react";
import {
  ArrowRight01Icon,
  Database02Icon,
  EarthIcon,
  Link01Icon,
  CheckmarkCircle02Icon,
  PencilEdit01Icon,
  PlusSignIcon,
  RefreshIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/networking")({
  staticData: { crumb: "Networking" },
  component: RouteComponent,
});

// ─── Mock data ─────────────────────────────────────────────────────────────
type RouteRow = {
  id: string;
  service: string;
  kind: "service" | "database";
  project: string;
  projectColor: string; // dot color
  internalHost: string;
  internalPort: number;
  publicHost: string | null;
  tls: "letsencrypt" | null;
  isPublic: boolean;
};

const PROJECTS = [
  { id: "all", name: "All projects", count: 6 },
  { id: "helio", name: "helio", count: 6, dot: "bg-success" },
  { id: "billing", name: "billing", count: 0, dot: "bg-warning" },
  { id: "marketing-site", name: "marketing-site", count: 0, dot: "bg-info" },
  { id: "internal-tools", name: "internal-tools", count: 0, dot: "bg-violet-500" },
];

const INITIAL_ROUTES: RouteRow[] = [
  {
    id: "web",
    service: "web",
    kind: "service",
    project: "helio",
    projectColor: "bg-success",
    internalHost: "web.helio.internal",
    internalPort: 3000,
    publicHost: "https://helio.so",
    tls: "letsencrypt",
    isPublic: true,
  },
  {
    id: "api",
    service: "api",
    kind: "service",
    project: "helio",
    projectColor: "bg-success",
    internalHost: "api.helio.internal",
    internalPort: 8080,
    publicHost: "https://api.helio.so",
    tls: "letsencrypt",
    isPublic: true,
  },
  {
    id: "worker",
    service: "worker",
    kind: "service",
    project: "helio",
    projectColor: "bg-success",
    internalHost: "worker.helio.internal",
    internalPort: 80,
    publicHost: null,
    tls: null,
    isPublic: false,
  },
  {
    id: "postgres",
    service: "postgres",
    kind: "database",
    project: "helio",
    projectColor: "bg-success",
    internalHost: "postgres.helio.internal",
    internalPort: 5432,
    publicHost: null,
    tls: null,
    isPublic: false,
  },
  {
    id: "redis",
    service: "redis",
    kind: "database",
    project: "helio",
    projectColor: "bg-success",
    internalHost: "redis.helio.internal",
    internalPort: 6379,
    publicHost: null,
    tls: null,
    isPublic: false,
  },
  {
    id: "imgproxy",
    service: "imgproxy",
    kind: "service",
    project: "helio",
    projectColor: "bg-success",
    internalHost: "imgproxy.helio.internal",
    internalPort: 8081,
    publicHost: "https://img.helio.so",
    tls: "letsencrypt",
    isPublic: true,
  },
];

function RouteComponent() {
  const [routes, setRoutes] = useState(INITIAL_ROUTES);
  const [projectFilter, setProjectFilter] = useState("all");
  const [tab, setTab] = useState<string>("routes");

  const filtered = useMemo(
    () =>
      projectFilter === "all" ? routes : routes.filter((r) => r.project === projectFilter),
    [routes, projectFilter],
  );

  const publicCount = routes.filter((r) => r.isPublic).length;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab((v as string) ?? "routes")}
        className="gap-0"
      >
        <div className="flex items-center justify-between border-b">
          <TabsList variant="line" className="h-auto bg-transparent p-0">
            <TabsTrigger value="routes" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon icon={Link01Icon} strokeWidth={2} className="size-3.5" />
              Routes
            </TabsTrigger>
            <TabsTrigger value="caddyfile" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon icon={ServerStack01Icon} strokeWidth={2} className="size-3.5" />
              Caddyfile
            </TabsTrigger>
            <TabsTrigger value="global" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon icon={EarthIcon} strokeWidth={2} className="size-3.5" />
              Global options
            </TabsTrigger>
            <TabsTrigger value="tls" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-3.5" />
              TLS / certificates
            </TabsTrigger>
          </TabsList>
          <Button variant="outline" size="sm" className="gap-1.5">
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
            Reload Caddy
          </Button>
        </div>

        <TabsContents>
        <TabsContent value="routes" className="mt-5 flex flex-col gap-4">
          {/* Section heading */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">Routes</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Caddy edge proxy on{" "}
                <span className="font-mono text-foreground/80">:443</span> · routes
                auto-published via internal DNS
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5">
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
              Custom route
            </Button>
          </div>

          {/* Project filter — scales to any number of projects */}
          <div className="flex items-center justify-between gap-4">
            <Select
              value={projectFilter}
              onValueChange={(v) => {
                if (typeof v === "string") setProjectFilter(v);
              }}
              items={PROJECTS.map((p) => ({ value: p.id, label: p.name }))}
            >
              <SelectTrigger className="min-w-[220px]">
                <SelectValue>
                  {(() => {
                    const selected = PROJECTS.find((p) => p.id === projectFilter);
                    if (!selected) return null;
                    return (
                      <span className="flex items-center gap-2">
                        {selected.dot && (
                          <span className={cn("size-1.5 rounded-full", selected.dot)} />
                        )}
                        <span>{selected.name}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {selected.count}
                        </span>
                      </span>
                    );
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PROJECTS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex w-full items-center gap-2">
                      {p.dot ? (
                        <span className={cn("size-1.5 rounded-full", p.dot)} />
                      ) : (
                        <span className="size-1.5" />
                      )}
                      <span className="flex-1">{p.name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {p.count}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {filtered.length} / {routes.length} routes
            </span>
          </div>

          {/* Flow boxes */}
          <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-2">
            <FlowCard
              icon={EarthIcon}
              label="Public internet"
              detail="0.0.0.0:443"
            />
            <FlowArrow />
            <FlowCard
              icon={ServerStack01Icon}
              label="Caddy edge proxy"
              detail={`${publicCount} domains · letsencrypt`}
              active
            />
            <FlowArrow />
            <FlowCard
              icon={Link01Icon}
              label="Service mesh"
              detail={`${routes.length} services · *.helio.internal`}
            />
          </div>

          {/* Routes table */}
          <Card className="gap-0 overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-[10px] font-semibold uppercase tracking-[0.08em]">
                    Service
                  </TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-[0.08em]">
                    Internal address
                  </TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-[0.08em]">
                    Public hostname
                  </TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-[0.08em]">
                    TLS
                  </TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-[0.08em]">
                    Public
                  </TableHead>
                  <TableHead className="text-right text-[10px] font-semibold uppercase tracking-[0.08em]">
                    Configure
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="p-0">
                      <Empty className="border-0 bg-transparent">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <HugeiconsIcon
                              icon={Link01Icon}
                              strokeWidth={1.6}
                              className="size-5 text-muted-foreground"
                            />
                          </EmptyMedia>
                          <EmptyTitle>No routes yet</EmptyTitle>
                          <EmptyDescription>
                            {projectFilter === "all"
                              ? "No services have been published through the Caddy edge proxy."
                              : `${
                                  PROJECTS.find((p) => p.id === projectFilter)?.name ??
                                  "This project"
                                } doesn't have any routes. Add a service or create a custom route to expose traffic.`}
                          </EmptyDescription>
                        </EmptyHeader>
                        <div className="mt-3 flex items-center gap-2">
                          <Button variant="outline" size="sm" className="gap-1.5">
                            <HugeiconsIcon
                              icon={PlusSignIcon}
                              strokeWidth={2}
                              className="size-3.5"
                            />
                            Custom route
                          </Button>
                          {projectFilter !== "all" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setProjectFilter("all")}
                            >
                              Show all projects
                            </Button>
                          )}
                        </div>
                      </Empty>
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="py-3">
                      <div className="flex items-center gap-2">
                        <HugeiconsIcon
                          icon={r.kind === "database" ? Database02Icon : ServerStack01Icon}
                          strokeWidth={1.8}
                          className="size-4 text-muted-foreground"
                        />
                        <div className="flex flex-col gap-1">
                          <span className="font-mono text-[13px]">{r.service}</span>
                          <Badge
                            variant="outline"
                            className="gap-1 self-start font-mono text-[10px] font-normal"
                          >
                            <span className={cn("size-1.5 rounded-full", r.projectColor)} />
                            {r.project}
                          </Badge>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[12.5px] text-foreground/80">
                      {r.internalHost}
                      <span className="text-muted-foreground">:{r.internalPort}</span>
                    </TableCell>
                    <TableCell>
                      {r.publicHost ? (
                        <span className="font-mono text-[12.5px] text-success">{r.publicHost}</span>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">— internal only —</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.tls ? (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[12px]">
                          <span className="size-1.5 rounded-full bg-success" />
                          {r.tls}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={r.isPublic}
                        onCheckedChange={(v) => {
                          setRoutes((prev) =>
                            prev.map((row) => (row.id === r.id ? { ...row, isPublic: v } : row)),
                          );
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" className="gap-1.5">
                        <HugeiconsIcon
                          icon={PencilEdit01Icon}
                          strokeWidth={2}
                          className="size-3.5"
                        />
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <p className="text-[12.5px] text-muted-foreground">
            Caddyfile is auto-generated from these rows. Switch to the{" "}
            <span className="font-mono text-foreground/80">Caddyfile</span> tab to edit it directly.
          </p>
        </TabsContent>

        <TabsContent value="caddyfile" className="mt-5">
          <Card className="bg-muted/30 p-4 font-mono text-[12px] leading-relaxed text-muted-foreground">
            <pre className="m-0 whitespace-pre-wrap">{`# Auto-generated from the Routes tab\n\nhelio.so {\n  reverse_proxy web.helio.internal:3000\n}\n\napi.helio.so {\n  reverse_proxy api.helio.internal:8080\n}\n\nimg.helio.so {\n  reverse_proxy imgproxy.helio.internal:8081\n}`}</pre>
          </Card>
        </TabsContent>

        <TabsContent value="global" className="mt-5 text-sm text-muted-foreground">
          Global Caddy options — admin endpoint, default SNI, automatic HTTPS, logs.
        </TabsContent>

        <TabsContent value="tls" className="mt-5 text-sm text-muted-foreground">
          TLS issuers, ACME accounts, custom certificate uploads.
        </TabsContent>
        </TabsContents>
      </Tabs>
    </div>
  );
}

function FlowCard({
  icon,
  label,
  detail,
  active,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  label: string;
  detail: string;
  active?: boolean;
}) {
  return (
    <Card
      className={cn(
        "gap-1 rounded-lg p-3.5 transition-colors",
        active ? "border-foreground" : "border-border",
      )}
    >
      <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />
        {label}
      </div>
      <div className="font-mono text-[13px]">{detail}</div>
    </Card>
  );
}

function FlowArrow() {
  return (
    <div className="flex items-center justify-center text-muted-foreground/40">
      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-4" />
    </div>
  );
}

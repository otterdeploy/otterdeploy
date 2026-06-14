import { Fragment, useMemo } from "react";
import {
  ArrowRight01Icon,
  CodeIcon,
  Database02Icon,
  EarthIcon,
  Link01Icon,
  LinkSquare02Icon,
  CheckmarkCircle02Icon,
  RefreshIcon,
  ServerStack01Icon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { proxyRoutesCollection } from "@/features/projects/data/proxy-routes";

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
import { Skeleton } from "@/shared/components/ui/skeleton";
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
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";
import { CaddyfileViewer } from "@/features/projects/components/networking/caddyfile-viewer";
import { CustomConfigEditor } from "@/features/projects/components/networking/custom-config-editor";
import { DeploymentAccessTab } from "@/features/projects/components/networking/deployment-access-tab";
import { DeploymentProtectionCell } from "@/features/projects/components/networking/deployment-protection-cell";
import { RouteDirectivesButton } from "@/features/projects/components/networking/route-directives-dialog";
import { orpc, queryClient } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/networking")({
  staticData: { crumb: "Networking" },
  component: RouteComponent,
});

type ResourceListItem = Awaited<
  ReturnType<typeof orpc.project.resource.list.call>
>[number];
type ProxyRouteItem = Awaited<
  ReturnType<typeof orpc.project.proxyRoute.list.call>
>[number];

interface RouteRow {
  id: string;
  name: string;
  kind: "service" | "database" | "platform";
  internalHost: string;
  internalPort: number;
  domain: string;
  publicHost: string;
  tls: "letsencrypt" | "internal";
  enabled: boolean;
  isHttp: boolean;
  protected: boolean;
  customDirectives: string | null;
}

interface RouteGroup {
  key: string;
  name: string;
  kind: RouteRow["kind"];
  internalHost: string;
  internalPort: number;
  routes: RouteRow[];
}

function RouteComponent() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const projectId = project.id;

  const { data: routesData, isLoading: routesLoading } = useLiveQuery(
    (q) =>
      q
        .from({ r: proxyRoutesCollection })
        .where(({ r }) => eq(r.projectId, projectId)),
    [projectId],
  );
  const resourcesQuery = useQuery(
    orpc.project.resource.list.queryOptions({
      input: { projectId: projectId as never },
    }),
  );
  const caddyfileQuery = useQuery(
    orpc.project.proxyRoute.caddyfile.queryOptions({
      input: { projectId: projectId as never },
    }),
  );

  const rows = useMemo<RouteRow[]>(() => {
    const routes = routesData ?? [];
    const resources = resourcesQuery.data ?? [];
    const byResourceId = new Map<string, ResourceListItem>();
    for (const r of resources) byResourceId.set(r.resourceId, r);
    return routes.map((r) => mapRoute(r, byResourceId));
  }, [routesData, resourcesQuery.data]);

  // Group routes by service so a multi-domain service collapses into one header
  // instead of repeating its name + internal address on every row.
  const groups = useMemo<RouteGroup[]>(() => {
    const map = new Map<string, RouteGroup>();
    for (const r of rows) {
      const key = `${r.name}@${r.internalHost}:${r.internalPort}`;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          name: r.name,
          kind: r.kind,
          internalHost: r.internalHost,
          internalPort: r.internalPort,
          routes: [],
        };
        map.set(key, group);
      }
      group.routes.push(r);
    }
    return Array.from(map.values());
  }, [rows]);

  const isLoading = routesLoading || resourcesQuery.isLoading;
  const acmeCount = rows.filter((r) => r.tls === "letsencrypt" && r.enabled).length;
  const httpCount = rows.filter((r) => r.isHttp).length;
  // Public ports are derived from the routes actually published: HTTP terminates
  // on :443, a TCP route (e.g. an exposed database) contributes its own port.
  const publicPorts = Array.from(
    new Set(
      rows
        .filter((r) => r.enabled)
        .map((r) => (r.isHttp ? 443 : r.internalPort)),
    ),
  ).sort((a, b) => a - b);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <Tabs defaultValue="routes" className="gap-0">
        <div className="flex items-center justify-between border-b">
          <TabsList variant="line" className="h-auto bg-transparent p-0">
            <TabsTrigger value="routes" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon icon={Link01Icon} strokeWidth={2} className="size-3.5" />
              Routes
            </TabsTrigger>
            <TabsTrigger value="access" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon icon={ShieldKeyIcon} strokeWidth={2} className="size-3.5" />
              Access
            </TabsTrigger>
            <TabsTrigger value="caddyfile" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon icon={ServerStack01Icon} strokeWidth={2} className="size-3.5" />
              Caddyfile
            </TabsTrigger>
            <TabsTrigger value="custom" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon icon={CodeIcon} strokeWidth={2} className="size-3.5" />
              Custom config
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
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              void queryClient.invalidateQueries({
                queryKey: orpc.project.proxyRoute.list.queryKey({
                  input: { projectId: projectId as never },
                }),
              });
              void resourcesQuery.refetch();
              void caddyfileQuery.refetch();
            }}
          >
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
            Refresh
          </Button>
        </div>

        <div className="relative flex-1">
          <TabsContent value="routes" className="pt-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">Routes</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  Caddy edge proxy on{" "}
                  <span className="font-mono text-foreground/80">:443</span> · routes
                  auto-published when resources expose a public hostname.
                </p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {rows.length} route{rows.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-2">
              <FlowCard
                icon={EarthIcon}
                label="Public internet"
                detail={
                  publicPorts.length
                    ? publicPorts.map((p) => `:${p}`).join(" · ")
                    : "no ports exposed"
                }
              />
              <FlowArrow />
              <FlowCard
                icon={ServerStack01Icon}
                label="Caddy edge proxy"
                detail={`${httpCount} http · ${acmeCount} letsencrypt`}
                active
              />
              <FlowArrow />
              <FlowCard
                icon={Link01Icon}
                label="Service mesh"
                detail={`${rows.length} upstream${rows.length === 1 ? "" : "s"}`}
              />
            </div>

            <Card className="gap-0 overflow-hidden p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-[10px] font-semibold uppercase tracking-[0.08em]">
                      Public hostname
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-[0.08em]">
                      TLS
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-[0.08em]">
                      Protection
                    </TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-[0.08em]">
                      Status
                    </TableHead>
                    <TableHead className="w-10 text-right text-[10px] font-semibold uppercase tracking-[0.08em]">
                      Custom
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && rows.length === 0 ? (
                    <SkeletonRows />
                  ) : groups.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={5} className="p-0">
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
                              Expose a service or enable public access on a database
                              to publish it through the Caddy edge proxy.
                            </EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      </TableCell>
                    </TableRow>
                  ) : (
                    groups.map((group) => (
                      <Fragment key={group.key}>
                        <TableRow className="border-b-0 bg-muted/25 hover:bg-muted/25">
                          <TableCell colSpan={5} className="py-2.5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <HugeiconsIcon
                                  icon={
                                    group.kind === "database"
                                      ? Database02Icon
                                      : ServerStack01Icon
                                  }
                                  strokeWidth={1.8}
                                  className="size-4 text-muted-foreground"
                                />
                                <span className="font-mono text-[13px] font-medium">
                                  {group.name}
                                </span>
                                <span className="font-mono text-[12px] text-muted-foreground">
                                  {group.internalHost}:{group.internalPort}
                                </span>
                              </div>
                              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                                {group.routes.length} route
                                {group.routes.length === 1 ? "" : "s"}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                        {group.routes.map((r, i) => (
                          <TableRow
                            key={r.id}
                            className={
                              i === group.routes.length - 1 ? undefined : "border-b-0"
                            }
                          >
                            <TableCell className="py-2.5">
                              <div className="flex items-center gap-2 pl-6">
                                <span className="text-muted-foreground/40">└</span>
                                {r.isHttp ? (
                                  <a
                                    href={r.publicHost}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={cn(
                                      "group inline-flex items-center gap-1 font-mono text-[12.5px] hover:underline",
                                      r.enabled ? "text-success" : "text-muted-foreground",
                                    )}
                                  >
                                    {r.publicHost}
                                    <HugeiconsIcon
                                      icon={LinkSquare02Icon}
                                      strokeWidth={2}
                                      className="size-3 opacity-0 transition-opacity group-hover:opacity-60"
                                    />
                                  </a>
                                ) : (
                                  <span
                                    className={cn(
                                      "font-mono text-[12.5px]",
                                      r.enabled ? "text-success" : "text-muted-foreground",
                                    )}
                                  >
                                    {r.publicHost}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-1.5 font-mono text-[12px]">
                                <span
                                  className={cn(
                                    "size-1.5 rounded-full",
                                    r.tls === "letsencrypt"
                                      ? "bg-success"
                                      : "bg-muted-foreground/60",
                                  )}
                                />
                                {r.tls}
                              </span>
                            </TableCell>
                            <TableCell>
                              <DeploymentProtectionCell route={r} projectId={projectId} />
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={r.enabled ? "outline" : "secondary"}
                                className="font-mono text-[10px] font-normal"
                              >
                                {r.enabled ? "enabled" : "disabled"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {r.isHttp ? (
                                <RouteDirectivesButton
                                  routeId={r.id}
                                  domain={r.domain}
                                  customDirectives={r.customDirectives}
                                />
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </Fragment>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>

            <p className="text-[12.5px] text-muted-foreground">
              Caddyfile is auto-generated by the reconciler. Switch to the{" "}
              <span className="font-mono text-foreground/80">Caddyfile</span> tab for
              the full generated config.
            </p>
          </TabsContent>

          <TabsContent value="access" className="pt-5">
            <DeploymentAccessTab
              routes={rows}
              projectId={projectId}
              isLoading={isLoading}
            />
          </TabsContent>

          <TabsContent value="caddyfile" className="pt-5">
            {rows.length === 0 && !caddyfileQuery.isLoading ? (
              <Empty className="border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <HugeiconsIcon
                      icon={ServerStack01Icon}
                      strokeWidth={1.6}
                      className="size-5 text-muted-foreground"
                    />
                  </EmptyMedia>
                  <EmptyTitle>No Caddyfile yet</EmptyTitle>
                  <EmptyDescription>
                    The Caddyfile is auto-generated once at least one route is
                    published. Expose a service or enable public access on a
                    database to see the rendered HTTP blocks here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <CaddyfileViewer
                source={caddyfileQuery.data?.caddyfile ?? ""}
                revision={caddyfileQuery.data?.revision}
                loading={caddyfileQuery.isLoading}
              />
            )}
          </TabsContent>

          <TabsContent value="custom" className="pt-5">
            <CustomConfigEditor projectId={projectId} />
          </TabsContent>

          <TabsContent value="global" className="pt-5">
            <Empty className="border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon
                    icon={EarthIcon}
                    strokeWidth={1.6}
                    className="size-5 text-muted-foreground"
                  />
                </EmptyMedia>
                <EmptyTitle>Global options</EmptyTitle>
                <EmptyDescription>
                  Admin endpoint, default SNI, automatic HTTPS, and access-log
                  configuration. Coming soon.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </TabsContent>

          <TabsContent value="tls" className="pt-5">
            <Empty className="border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    strokeWidth={1.6}
                    className="size-5 text-muted-foreground"
                  />
                </EmptyMedia>
                <EmptyTitle>TLS / certificates</EmptyTitle>
                <EmptyDescription>
                  ACME accounts and custom certificate uploads. Today every public
                  route is issued via Let's Encrypt; bring-your-own certs are coming
                  soon.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function mapRoute(
  route: ProxyRouteItem,
  byResourceId: Map<string, ResourceListItem>,
): RouteRow {
  const resource = route.resourceId ? byResourceId.get(route.resourceId) : null;
  const kind: RouteRow["kind"] = resource
    ? resource.type === "database"
      ? "database"
      : "service"
    : "platform";
  const name = resource?.name ?? deriveNameFromUpstream(route.upstreamHost);
  const isHttp = route.type === "http";
  const publicHost = isHttp
    ? `https://${route.domain}`
    : `${route.domain}:${route.upstreamPort}`;
  return {
    id: route.id,
    name,
    kind,
    internalHost: route.upstreamHost,
    internalPort: route.upstreamPort,
    domain: route.domain,
    publicHost,
    tls: route.usesAcme ? "letsencrypt" : "internal",
    enabled: route.enabled,
    isHttp,
    protected: route.protected,
    customDirectives: route.customDirectives ?? null,
  };
}

function deriveNameFromUpstream(host: string): string {
  // Upstream hosts look like "<resource>.<project>.otterdeploy.internal". Surface
  // the leading label so platform routes (no resourceId) still show something
  // human-readable.
  const label = host.split(".")[0];
  return label && label.length > 0 ? label : host;
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: 5 }).map((__, j) => (
            <TableCell key={j} className="py-3">
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
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

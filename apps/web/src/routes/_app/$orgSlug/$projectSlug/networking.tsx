import { useMemo } from "react";
import {
  ArrowRight01Icon,
  Database02Icon,
  EarthIcon,
  Link01Icon,
  CheckmarkCircle02Icon,
  PlusSignIcon,
  RefreshIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

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
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

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
  publicHost: string;
  tls: "letsencrypt" | "internal";
  enabled: boolean;
  isHttp: boolean;
}

function RouteComponent() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const projectId = project.id;

  const routesQuery = useQuery(
    orpc.project.proxyRoute.list.queryOptions({
      input: { projectId: projectId as never },
    }),
  );
  const resourcesQuery = useQuery(
    orpc.project.resource.list.queryOptions({
      input: { projectId: projectId as never },
    }),
  );

  const rows = useMemo<RouteRow[]>(() => {
    const routes = routesQuery.data ?? [];
    const resources = resourcesQuery.data ?? [];
    const byResourceId = new Map<string, ResourceListItem>();
    for (const r of resources) byResourceId.set(r.resourceId, r);
    return routes.map((r) => mapRoute(r, byResourceId));
  }, [routesQuery.data, resourcesQuery.data]);

  const isLoading = routesQuery.isLoading || resourcesQuery.isLoading;
  const acmeCount = rows.filter((r) => r.tls === "letsencrypt" && r.enabled).length;
  const httpCount = rows.filter((r) => r.isHttp).length;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <Tabs defaultValue="routes" className="gap-0">
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
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              void routesQuery.refetch();
              void resourcesQuery.refetch();
            }}
          >
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
            Refresh
          </Button>
        </div>

        <TabsContents>
          <TabsContent value="routes" className="mt-5 flex flex-col gap-4">
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
                detail=":443 / :5432"
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
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && rows.length === 0 ? (
                    <SkeletonRows />
                  ) : rows.length === 0 ? (
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
                    rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="py-3">
                          <div className="flex items-center gap-2">
                            <HugeiconsIcon
                              icon={
                                r.kind === "database" ? Database02Icon : ServerStack01Icon
                              }
                              strokeWidth={1.8}
                              className="size-4 text-muted-foreground"
                            />
                            <span className="font-mono text-[13px]">{r.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-[12.5px] text-foreground/80">
                          {r.internalHost}
                          <span className="text-muted-foreground">:{r.internalPort}</span>
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "font-mono text-[12.5px]",
                              r.enabled ? "text-success" : "text-muted-foreground",
                            )}
                          >
                            {r.publicHost}
                          </span>
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
                          <Badge
                            variant={r.enabled ? "outline" : "secondary"}
                            className="font-mono text-[10px] font-normal"
                          >
                            {r.enabled ? "enabled" : "disabled"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>

            <p className="text-[12.5px] text-muted-foreground">
              Caddyfile is auto-generated by the reconciler. Switch to the{" "}
              <span className="font-mono text-foreground/80">Caddyfile</span> tab for
              a preview of the HTTP blocks.
            </p>
          </TabsContent>

          <TabsContent value="caddyfile" className="mt-5">
            <Card className="bg-muted/30 p-4 font-mono text-[12px] leading-relaxed text-muted-foreground">
              {rows.length === 0 ? (
                <span className="text-muted-foreground">
                  # No routes published yet
                </span>
              ) : (
                <pre className="m-0 whitespace-pre-wrap">
                  {renderCaddyfilePreview(rows)}
                </pre>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="global" className="mt-5">
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

          <TabsContent value="tls" className="mt-5">
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
        </TabsContents>
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
    publicHost,
    tls: route.usesAcme ? "letsencrypt" : "internal",
    enabled: route.enabled,
    isHttp,
  };
}

function deriveNameFromUpstream(host: string): string {
  // Upstream hosts look like "<resource>.<project>.otterstack.internal". Surface
  // the leading label so platform routes (no resourceId) still show something
  // human-readable.
  const label = host.split(".")[0];
  return label && label.length > 0 ? label : host;
}

function renderCaddyfilePreview(rows: RouteRow[]): string {
  const httpBlocks = rows
    .filter((r) => r.isHttp && r.enabled)
    .map(
      (r) =>
        `${stripProtocol(r.publicHost)} {\n  reverse_proxy ${r.internalHost}:${r.internalPort}\n}`,
    );
  if (httpBlocks.length === 0) return "# No HTTP routes enabled";
  return `# Auto-generated from the Routes tab\n\n${httpBlocks.join("\n\n")}`;
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "");
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

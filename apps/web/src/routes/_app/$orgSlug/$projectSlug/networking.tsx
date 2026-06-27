import { useMemo } from "react";
import {
  CodeIcon,
  EarthIcon,
  Link01Icon,
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

import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { CaddyfileViewer } from "@/features/projects/components/networking/caddyfile-viewer";
import { CertificatesTab } from "@/features/projects/components/networking/certificates-tab";
import { CustomConfigEditor } from "@/features/projects/components/networking/custom-config-editor";
import { GlobalOptionsEditor } from "@/features/projects/components/networking/global-options-editor";
import { DeploymentAccessTab } from "@/features/projects/components/networking/deployment-access-tab";
import { orpc, queryClient } from "@/shared/server/orpc";

import {
  mapRoute,
  RoutesTab,
  type ResourceListItem,
  type RouteRow,
} from "./-components/networking-routes-tab";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/networking")({
  staticData: { crumb: "Networking" },
  component: RouteComponent,
});

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

  const isLoading = routesLoading || resourcesQuery.isLoading;

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
          <RoutesTab rows={rows} projectId={projectId} isLoading={isLoading} />

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
            <GlobalOptionsEditor projectId={projectId} />
          </TabsContent>

          <TabsContent value="tls" className="pt-5">
            <CertificatesTab projectId={projectId} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

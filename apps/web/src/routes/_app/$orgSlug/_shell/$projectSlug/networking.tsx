import { useState } from "react";

import { ArrowRight01Icon, RefreshIcon, ServerStack01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import type { RouteCertificate } from "@/features/projects/components/networking/certificate-status";

import { CaddyfileViewer } from "@/features/projects/components/networking/caddyfile-viewer";
import { projectIdBySlug } from "@/features/projects/data/project";
import { proxyRoutesCollection } from "@/features/projects/data/proxy-routes";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { orpc, queryClient } from "@/shared/server/orpc";
import { cn } from "@/shared/lib/utils";

import {
  mapRoute,
  RoutesTable,
  type ResourceListItem,
  type RouteRow,
} from "./-components/networking-routes-tab";

export const Route = createFileRoute("/_app/$orgSlug/_shell/$projectSlug/networking")({
  staticData: { crumb: "Networking" },
  component: RouteComponent,
  // Warm the on-mount data on hover (intent-preload) so the page renders from
  // cache instead of spinning. Non-blocking + best-effort: a cold project row
  // or failed prefetch just falls back to fetch-on-mount, as before.
  loader: ({ params }) => {
    // The routes table's own data is a live react-db collection with syncMode
    // "on-demand": preload() is a no-op for those (it loads when the live
    // query subscribes with its projectId filter), so we don't call it.
    const projectId = projectIdBySlug(params.projectSlug);
    if (!projectId) return;
    void queryClient
      .prefetchQuery(orpc.project.resource.list.queryOptions({ input: { projectId } }))
      .catch(() => undefined);
    void queryClient
      .prefetchQuery(orpc.project.proxyRoute.caddyfile.queryOptions({ input: { projectId } }))
      .catch(() => undefined);
    void queryClient
      .prefetchQuery(orpc.project.proxyRoute.certificates.queryOptions({ input: { projectId } }))
      .catch(() => undefined);
  },
});

function RouteComponent() {
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  const projectId = project.id;

  const { data: routesData, isLoading: routesLoading } = useLiveQuery(
    (q) => q.from({ r: proxyRoutesCollection }).where(({ r }) => eq(r.projectId, projectId)),
    [projectId],
  );
  const resourcesQuery = useQuery(
    orpc.project.resource.list.queryOptions({ input: { projectId } }),
  );
  const caddyfileQuery = useQuery(
    orpc.project.proxyRoute.caddyfile.queryOptions({ input: { projectId } }),
  );
  // Certificates are probed live at the edge and now hang off each route row,
  // so the page owns the query and hands each row its own domain's result.
  const certificatesQuery = useQuery(
    orpc.project.proxyRoute.certificates.queryOptions({ input: { projectId } }),
  );

  const rows: RouteRow[] = (() => {
    const routes = routesData ?? [];
    const resources = resourcesQuery.data ?? [];
    const byResourceId = new Map<string, ResourceListItem>();
    for (const r of resources) byResourceId.set(r.resourceId, r);
    return routes.map((r) => mapRoute(r, byResourceId));
  })();

  const certsByDomain = new Map<string, RouteCertificate>(
    (certificatesQuery.data?.certificates ?? []).map((c) => [c.domain, c]),
  );

  const isLoading = routesLoading || resourcesQuery.isLoading;
  const probe = certificatesQuery.data;

  const refreshAll = () => {
    // The routes table reads the COLLECTION (live query above), whose cache
    // key is namespaced `["proxyRoutes", …]`. Invalidating the bare orpc key
    // matched nothing, so this button refreshed everything on the page except
    // the routes it is sitting on top of.
    void proxyRoutesCollection.utils.refetch();
    void resourcesQuery.refetch();
    void caddyfileQuery.refetch();
    void certificatesQuery.refetch();
  };

  return (
    <div className="flex flex-1 flex-col gap-5 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Networking</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Caddy edge proxy on <span className="font-mono text-foreground/80">:443</span> ·
            routes auto-published when resources expose a public hostname. Open a route for its
            certificate and access controls.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-[11px] text-muted-foreground">
            {rows.length} route{rows.length === 1 ? "" : "s"}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={certificatesQuery.isFetching}
            onClick={refreshAll}
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              strokeWidth={2}
              className={cn("size-3.5", certificatesQuery.isFetching && "animate-spin")}
            />
            Refresh
          </Button>
        </div>
      </div>

      <RoutesTable
        rows={rows}
        projectId={projectId}
        isLoading={isLoading}
        certsByDomain={certsByDomain}
        certsLoading={certificatesQuery.isLoading}
      />

      {/* The generated Caddyfile is the OUTPUT of every route above, not a
          property of any one of them, so it stays page-level, but folded away
          by default rather than owning a tab. */}
      <CaddyfileDisclosure
        source={caddyfileQuery.data?.caddyfile ?? ""}
        revision={caddyfileQuery.data?.revision}
        loading={caddyfileQuery.isLoading}
        hasRoutes={rows.length > 0}
        probedVia={probe ? `${probe.edgeHost} · ${new Date(probe.probedAt).toLocaleTimeString()}` : null}
      />
    </div>
  );
}

function CaddyfileDisclosure({
  source,
  revision,
  loading,
  hasRoutes,
  probedVia,
}: {
  source: string;
  revision?: string;
  loading: boolean;
  hasRoutes: boolean;
  probedVia: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/30"
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/50 transition-transform",
            open && "rotate-90",
          )}
        />
        <HugeiconsIcon
          icon={ServerStack01Icon}
          strokeWidth={1.8}
          className="size-4 text-muted-foreground"
        />
        <span className="text-[13px] font-medium">Generated Caddyfile</span>
        <span className="text-[12.5px] text-muted-foreground">
          auto-generated by the reconciler, read-only
        </span>
        <span className="flex-1" />
        {probedVia ? (
          <span className="hidden font-mono text-[11px] text-muted-foreground/70 sm:inline">
            probed via {probedVia}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="border-t p-4">
          {!hasRoutes && !loading ? (
            <p className="text-[12.5px] text-muted-foreground">
              No Caddyfile yet. It is generated once at least one route is published. Expose a
              service or enable public access on a database to see the rendered HTTP blocks.
            </p>
          ) : (
            <CaddyfileViewer source={source} revision={revision} loading={loading} />
          )}
        </div>
      ) : null}
    </Card>
  );
}

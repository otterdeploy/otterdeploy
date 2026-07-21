// oxlint-disable-next-line unicorn/filename-case -- TanStack route-param file; the `$deploymentId.tsx` name is a framework requirement, not a style choice.
import { useState } from "react";

import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import * as m from "motion/react-client";

import type { ProjectResource } from "@/features/projects/components/graph/resource-to-node";

import { deploymentsCollection } from "@/features/resources/data/deployments";
import { orpc } from "@/shared/server/orpc";
import { resourceCollection } from "@/features/resources/data/resource";

import { DeploymentStatusDot } from "./-components/deployment-detail";
import { DeploymentTabs, type DeploymentTab, DEPLOYMENT_TABS } from "./-components/deployment-tabs";

import * as z from "zod";

const searchSchema = z.object({
  tab: z.enum(DEPLOYMENT_TABS).catch("details"),
  // Present when opened from a PR-preview panel — the base deployments
  // collection only loads previewId-null rows, so a preview row must be
  // fetched with this scope or the Details panel loads forever.
  previewId: z.string().optional(),
});



export const Route = createFileRoute(
  "/_app/$orgSlug/_shell/$projectSlug/graph/$resourceId/deployment/$deploymentId",
)({
  staticData: { crumb: "Deployment" },
  validateSearch: searchSchema,
  component: RouteComponent,
});

function getSubline(resource?: ProjectResource): string {
  if (resource?.type === "database") return resource.internalHostname;
  if (resource?.type === "service") return resource.publicDomain ?? "";
  if (resource?.type === "compose")
    return resource.services.length === 1
      ? "1 service"
      : `${resource.services.length} services`;
  return "";
}

function RouteComponent() {
  const { orgSlug, projectSlug, resourceId, deploymentId } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  const { tab, previewId } = Route.useSearch();
  const navigate = Route.useNavigate();
  // Drives the slide-OUT. Closing navigates back to the resource, which makes
  // TanStack's <Outlet> render null at once — so the unmount-time `exit` has
  // nothing to animate and the overlay just vanishes. Animate to x:"100%" on
  // `closing`, then navigate when it finishes (see onAnimationComplete below).
  const [closing, setClosing] = useState(false);
  const setTab = (next: DeploymentTab) =>
    void navigate({ search: (prev) => ({ ...prev, tab: next }), replace: true });

  // Base rows come from the shared reactive collection. A preview row isn't in
  // that collection (it's previewId-scoped), so fetch it directly when the
  // panel was opened from a preview.
  const { data: baseDeployment = null } = useLiveQuery(
    (q) =>
      q
        .from({ d: deploymentsCollection })
        .where(({ d }) =>
          and(
            eq(d.projectId, project.id),
            eq(d.resourceId, resourceId),
            eq(d.id, deploymentId),
          ),
        )
        .findOne(),
    [project.id, resourceId, deploymentId],
  );
  const previewDeployments = useQuery(
    orpc.project.resource.deployments.list.queryOptions({
      input: { projectId: project.id, resourceId, previewId: previewId ?? "" },
      enabled: !!previewId,
      refetchInterval: 5_000,
    }),
  );
  const deployment = previewId
    ? (previewDeployments.data?.find((d) => d.id === deploymentId) ?? null)
    : baseDeployment;

  const { data: resource } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) =>
          and(eq(r.projectId, project.id), eq(r.resourceId, resourceId)),
        )
        .findOne(),
    [project.id, resourceId],
  );

  const subline = getSubline(resource);

  return (
    <m.div
      key={deploymentId}
      initial={{ x: "100%" }}
      animate={{ x: closing ? "100%" : 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      onAnimationComplete={() => {
        // Only the close (slide-out) navigates; the mount slide-in completes
        // with closing=false and is a no-op. By now the overlay is off-screen,
        // so removing the route is invisible.
        if (closing)
          void navigate({
            to: "/$orgSlug/$projectSlug/graph/$resourceId",
            params: { orgSlug, projectSlug, resourceId },
          });
      }}
      className="absolute size-full bg-muted -top-5 -right-4 border rounded-tl-lg shadow-md overflow-hidden"
    >
      <div className="pointer-events-auto absolute inset-0 flex flex-col overflow-hidden bg-background">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <span className="text-[18px] font-semibold tracking-tight">
                {resource?.name ?? "Deployment"}
              </span>
              <span className="text-muted-foreground/40">/</span>
              <span className="font-mono text-[14px] text-muted-foreground">
                {deploymentId.split("_")[1]?.slice(0, 8) ??
                  deploymentId.slice(0, 8)}
              </span>
              {deployment && <DeploymentStatusDot status={deployment.status} />}
            </div>
            {subline && (
              <div className="font-mono text-[12px] text-muted-foreground/80">
                {subline}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {deployment
                ? new Date(deployment.createdAt).toLocaleString()
                : "—"}
            </span>
            <button
              type="button"
              onClick={() => setClosing(true)}
              aria-label="Close deployment"
              className="grid size-7 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
            >
              <HugeiconsIcon
                icon={Cancel01Icon}
                strokeWidth={2}
                className="size-4"
              />
            </button>
          </div>
        </div>

        <DeploymentTabs
          tab={tab}
          onTabChange={setTab}
          deployment={deployment}
          resource={resource}
          projectId={project.id}
          resourceId={resourceId}
          deploymentId={deploymentId}
        />
      </div>
    </m.div>
  );
}

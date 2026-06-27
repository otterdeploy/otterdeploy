// oxlint-disable-next-line unicorn/filename-case -- TanStack route-param file; the `$deploymentId.tsx` name is a framework requirement, not a style choice.
import { useState } from "react";
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import * as m from "motion/react-client";

import type { ProjectResource } from "@/features/projects/components/graph/resource-to-node";

import { deploymentsCollection } from "@/features/resources/data/deployments";
import { resourceCollection } from "@/features/resources/data/resource";

import { DeploymentStatusBadge } from "./-components/deployment-detail";
import { DeploymentTabs, type DeploymentTab } from "./-components/deployment-tabs";

export const Route = createFileRoute(
  "/_app/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId",
)({
  staticData: { crumb: "Deployment" },
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
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });
  const [tab, setTab] = useState<DeploymentTab>("deploy-logs");

  const { data: deployment = null } = useLiveQuery(
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
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="absolute size-full bg-muted -top-5 -right-4 border rounded-tl-3xl shadow-md overflow-hidden"
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
              {deployment && (
                <DeploymentStatusBadge status={deployment.status} />
              )}
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
            <Link
              to="/$orgSlug/$projectSlug/graph/$resourceId"
              params={{ orgSlug, projectSlug, resourceId }}
              aria-label="Close deployment"
              className="grid size-7 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
            >
              <HugeiconsIcon
                icon={Cancel01Icon}
                strokeWidth={2}
                className="size-4"
              />
            </Link>
          </div>
        </div>

        <DeploymentTabs
          tab={tab}
          onTabChange={setTab}
          deployment={deployment}
          projectId={project.id}
          resourceId={resourceId}
          deploymentId={deploymentId}
        />
      </div>
    </m.div>
  );
}

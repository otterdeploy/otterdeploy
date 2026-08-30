// oxlint-disable-next-line unicorn/filename-case -- TanStack route-param file; the `$deploymentId.tsx` name is a framework requirement, not a style choice.
import { useState } from "react";

import { createFileRoute, redirect, useLoaderData } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, LinkSquare02Icon } from "@hugeicons/core-free-icons";
import * as m from "motion/react-client";

import type { ProjectResource } from "@/features/projects/components/graph/resource-to-node";

import { useResolvedDeployment } from "./-components/use-resolved-deployment";
import { orpc } from "@/shared/server/orpc";
import { cn } from "@/shared/lib/utils";
import { resourceCollection } from "@/features/resources/data/resource";

import { CancelDeploymentButton } from "@/features/deployments/components/cancel-deployment-button";
import { useEscapeKey } from "@/shared/hooks/use-escape-key";
import { DeploymentStatusDot } from "@/features/resources/components/_shared/deployment-detail";
import { DeploymentTabs, type DeploymentTab, DEPLOYMENT_TABS } from "./-components/deployment-tabs";

import * as z from "zod";

const searchSchema = z.object({
  // Deliberately NOT `tab`: the parent /graph/$resourceId route owns that key
  // for the panel behind this overlay, and search params are one flat object
  // per URL. Sharing the key meant switching a log tab here rewrote the panel's
  // tab to a value it doesn't recognize, so closing the overlay dumped you on
  // the panel's default tab instead of the Deployments tab you opened it from.
  deploymentTab: z.enum(DEPLOYMENT_TABS).catch("details"),
  // Present when opened from a PR-preview panel. The base deployments
  // collection only loads previewId-null rows, so a preview row must be
  // fetched with this scope or the Details panel loads forever.
  previewId: z.string().optional(),
});



/**
 * Deployments live INSIDE the resource panel now (expanded on its Deployments
 * tab, with the build/deploy log as a source of its Logs tab), so this overlay
 * is retired for base deployments: an old link redirects to the panel with the
 * deployment focused. Preview deployments still come here. A preview row is
 * `previewId`-scoped and not in the panel's collection, so the overlay stays
 * their home until the panel learns preview scope.
 */
function panelSearchFor(deploymentTab: DeploymentTab, deploymentId: string) {
  switch (deploymentTab) {
    case "build-logs":
      return { tab: "logs", deployment: deploymentId, logSource: "build" as const };
    case "deploy-logs":
      return { tab: "logs", deployment: deploymentId, logSource: "deploy" as const };
    default:
      return { tab: "deployments", deployment: deploymentId };
  }
}

export const Route = createFileRoute(
  "/_app/$orgSlug/_shell/$projectSlug/graph/$resourceId/deployment/$deploymentId",
)({
  staticData: { crumb: "Deployment" },
  validateSearch: searchSchema,
  beforeLoad: ({ params, search }) => {
    if (search.previewId) return;
    throw redirect({
      to: "/$orgSlug/$projectSlug/graph/$resourceId",
      params: {
        orgSlug: params.orgSlug,
        projectSlug: params.projectSlug,
        resourceId: params.resourceId,
      },
      search: panelSearchFor(search.deploymentTab, params.deploymentId),
      replace: true,
    });
  },
  component: RouteComponent,
});

/** The address this deployment is actually reachable at.
 *
 *  A preview deployment does NOT serve the base service's domain. It has its
 *  own `<service>-pr-N-<project>` host. Showing `resource.publicDomain` in a
 *  preview panel pointed at production while you were looking at a pull
 *  request's build, which is a confusing thing to hand someone and a dangerous
 *  one to click. `previewUrl` wins whenever we're in a preview. */
function getSubline(resource?: ProjectResource, previewUrl?: string | null): string {
  if (previewUrl) return previewUrl.replace(/^https?:\/\//, "");
  if (resource?.type === "database") return resource.internalHostname;
  if (resource?.type === "service") return resource.publicDomain ?? "";
  if (resource?.type === "compose")
    return resource.services.length === 1
      ? "1 service"
      : `${resource.services.length} services`;
  return "";
}

/** The preview's own host for THIS service. Null outside a preview, so the
 *  panel falls back to the resource's own address. */
function usePreviewServiceUrl(
  projectId: string,
  previewId: string | undefined,
  resourceId: string,
): string | null {
  const previews = useQuery(
    orpc.project.previews.list.queryOptions({
      input: { projectId },
      enabled: !!previewId,
    }),
  );
  if (!previewId) return null;
  return (
    previews.data
      ?.find((p) => p.id === previewId)
      ?.services.find((s) => s.resourceId === resourceId)?.url ?? null
  );
}

/** The address a browser can actually open, or null. A database's internal
 *  hostname is reachable only inside the mesh, so it stays plain text. */
function reachableUrl(resource: ProjectResource | undefined, previewUrl: string | null) {
  if (previewUrl) return previewUrl;
  if (resource?.type === "service" && resource.publicEnabled && resource.publicDomain) {
    return `https://${resource.publicDomain}`;
  }
  return null;
}

/** The deployment's address. A link when a browser can open it. That is the
 *  one thing anyone wants from this line, plain text otherwise. */
function Subline({ text, href }: { text: string; href: string | null }) {
  if (!text) return null;
  if (!href) return <div className="font-mono text-[12px] text-muted-foreground/80">{text}</div>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex w-fit items-center gap-1 font-mono text-[12px] text-muted-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
    >
      {text}
      <HugeiconsIcon
        icon={LinkSquare02Icon}
        strokeWidth={2}
        className="size-3 opacity-0 transition-opacity group-hover:opacity-60"
      />
    </a>
  );
}

/** Marks a build as belonging to a pull request rather than to production.
 *  Dashed to match the graph's preview edges and the preview panel's chrome.
 *  One vocabulary for "ephemeral, PR-scoped" wherever it appears. */
function PreviewChip({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-dashed border-border bg-muted/30 px-2 py-0.5 font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground uppercase"
      title="A pull-request preview build. Temporary, and torn down with its PR."
    >
      preview
    </span>
  );
}

function RouteComponent() {
  const { orgSlug, projectSlug, resourceId, deploymentId } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  const { deploymentTab: tab, previewId } = Route.useSearch();
  const navigate = Route.useNavigate();
  // Drives the slide-OUT. Closing navigates back to the resource, which makes
  // TanStack's <Outlet> render null at once, so the unmount-time `exit` has
  // nothing to animate and the overlay just vanishes. Animate to x:"100%" on
  // `closing`, then navigate when it finishes (see onAnimationComplete below).
  const [closing, setClosing] = useState(false);
  // Escape closes the overlay the same way its X does. Set `closing`, let the
  // slide-out finish, then navigate back to the resource panel. Guarded on
  // `closing` so a second press mid-animation is not a second close.
  useEscapeKey(!closing, () => setClosing(true));
  const setTab = (next: DeploymentTab) =>
    void navigate({ search: (prev) => ({ ...prev, deploymentTab: next }), replace: true });

  const deployment = useResolvedDeployment({
    projectId: project.id,
    resourceId,
    deploymentId,
    previewId,
  });

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

  const previewUrl = usePreviewServiceUrl(project.id, previewId, resourceId);
  const subline = getSubline(resource, previewUrl);
  const sublineHref = reachableUrl(resource, previewUrl);

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
            // Carry the panel's tab back out, and drop this overlay's own
            // `deploymentTab`/`previewId` (meaningless once it's gone). Without
            // this you'd return to the panel's DEFAULT tab rather than the
            // Deployments tab you opened the deployment from.
            search: (prev) => ({ tab: prev.tab }),
          });
      }}
      className="absolute size-full bg-muted -top-5 -right-4 border rounded-tl-lg shadow-md overflow-hidden"
    >
      <div className="pointer-events-auto absolute inset-0 flex flex-col overflow-hidden bg-background">
        {/* Header */}
        <div
          className={cn(
            "flex items-start justify-between gap-4 px-6 pt-6",
            previewId && "border-b border-dashed border-border bg-muted/20 pb-4",
          )}
        >
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
              {/* Same dashed vocabulary the graph uses for a preview's
                  attachment, and the preview panel's own chrome: this build
                  belongs to a pull request, not to production. Without it the
                  panel is indistinguishable from a production deployment while
                  showing an ephemeral one. */}
              <PreviewChip active={!!previewId} />
            </div>
            <Subline text={subline} href={sublineHref} />
          </div>
          <div className="flex items-center gap-3">
            {/* Renders itself away unless this deployment is still in flight. */}
            {deployment && (
              // The loaded row's id, not the route param. It carries the
              // branded type, and it is the row we are actually acting on.
              <CancelDeploymentButton
                deploymentId={deployment.id}
                status={deployment.status}
              />
            )}
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {deployment
                ? new Date(deployment.createdAt).toLocaleString()
                : "–"}
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
          previewUrl={previewUrl}
        />
      </div>
    </m.div>
  );
}

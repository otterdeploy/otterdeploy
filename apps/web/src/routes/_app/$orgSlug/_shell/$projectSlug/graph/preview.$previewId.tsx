/**
 * PR-preview detail panel — slides in from the right when a preview satellite
 * is clicked. Tabbed: Overview (identity + URL + per-service status),
 * Deployments (preview-scoped history → the existing deployment detail panel
 * with build/deploy logs), Variables (effective env per service: inherited base
 * vars + this preview's overrides, revertable), and Settings (rebuild/redeploy,
 * pause/resume, teardown, keep-alive/TTL, DB branch toggle + reset).
 * The tab bodies live in `-components/preview-panel/`.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useLoaderData, useNavigate } from "@tanstack/react-router";
import * as m from "motion/react-client";

import { ArrowUpRight01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Tabs, TabsContent, TabsContents, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { DeploymentHistory } from "./-components/preview-panel/deployment-history";
import { OverviewTab } from "./-components/preview-panel/overview-tab";
import { SettingsTab } from "./-components/preview-panel/settings-tab";
import { badgeBase, label } from "./-components/preview-panel/shared";
import { VariablesTab } from "./-components/preview-panel/variables-tab";

export const Route = createFileRoute("/_app/$orgSlug/_shell/$projectSlug/graph/preview/$previewId")({
  staticData: { crumb: "Preview" },
  component: PreviewPanel,
});

function PreviewPanel() {
  const { orgSlug, projectSlug, previewId } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });
  const navigate = useNavigate();

  const previews = useQuery(
    orpc.project.previews.list.queryOptions({
      input: { projectId: project.id },
      refetchInterval: 5_000,
    }),
  );
  const preview = (previews.data ?? []).find((p) => p.id === previewId);
  const close = () =>
    void navigate({ to: "/$orgSlug/$projectSlug/graph", params: { orgSlug, projectSlug } });
  const url = preview?.services.find((s) => s.url)?.url ?? null;

  return (
    <m.div
      key={previewId}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="pointer-events-auto relative h-full w-full rounded-lg rounded-tr-none border border-r-0 border-border bg-card lg:w-4/5 xl:w-3/5"
    >
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-border/60 px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[15px] font-semibold tabular-nums">
                {preview ? `#${preview.prNumber}` : "…"}
              </span>
              <span className={label}>preview</span>
              {preview ? (
                <span
                  className={cn(
                    badgeBase,
                    preview.paused
                      ? "bg-muted text-muted-foreground"
                      : preview.state === "active"
                        ? "bg-success/12 text-success"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {preview.paused ? "paused" : preview.state}
                </span>
              ) : null}
            </div>
            {preview ? (
              <div className="mt-0.5 truncate font-mono text-[12.5px] text-muted-foreground">
                {preview.branch}
              </div>
            ) : null}
          </div>
          {url ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => window.open(url, "_blank", "noopener")}
            >
              Open preview
              <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} className="size-3.5" />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close panel">
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
          </Button>
        </header>

        {!preview && !previews.isLoading ? (
          <p className="px-6 py-5 text-sm text-muted-foreground">
            This preview is gone — its PR was likely closed.
          </p>
        ) : preview ? (
          <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="border-b border-border/60 px-6">
              <TabsList variant="line" className="h-auto bg-transparent p-0">
                <TabsTrigger value="overview" className="px-2.5 py-2.5">
                  Overview
                </TabsTrigger>
                <TabsTrigger value="deployments" className="px-2.5 py-2.5">
                  Deployments
                </TabsTrigger>
                <TabsTrigger value="variables" className="px-2.5 py-2.5">
                  Variables
                </TabsTrigger>
                <TabsTrigger value="settings" className="px-2.5 py-2.5">
                  Settings
                </TabsTrigger>
              </TabsList>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <TabsContents>
                <TabsContent value="overview">
                  <OverviewTab preview={preview} />
                </TabsContent>
                <TabsContent value="deployments">
                  {preview.services.map((svc) => (
                    <DeploymentHistory
                      key={svc.resourceId}
                      orgSlug={orgSlug}
                      projectSlug={projectSlug}
                      projectId={project.id}
                      previewId={previewId}
                      service={svc}
                    />
                  ))}
                </TabsContent>
                <TabsContent value="variables">
                  {preview.services.map((svc) => (
                    <VariablesTab
                      key={svc.resourceId}
                      projectId={project.id}
                      previewId={previewId}
                      service={svc}
                    />
                  ))}
                </TabsContent>
                <TabsContent value="settings">
                  <SettingsTab projectId={project.id} preview={preview} />
                </TabsContent>
              </TabsContents>
            </div>
          </Tabs>
        ) : null}
      </div>
    </m.div>
  );
}

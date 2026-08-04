/**
 * PR-preview detail panel — slides in from the right when a preview satellite
 * is clicked. Tabbed: Overview (identity + URL + per-service status),
 * Deployments (preview-scoped history → the existing deployment detail panel
 * with build/deploy logs), Variables (effective env per service: inherited base
 * vars + this preview's overrides, revertable), and Settings (rebuild/redeploy,
 * pause/resume, teardown, keep-alive/TTL, DB branch toggle + reset).
 * The tab bodies live in `-components/preview-panel/`.
 *
 * The drawer it slides in as belongs to the parent graph layout
 * (`-components/panel-shell`), so clicking a satellite opens it immediately and
 * this route's chunk + previews query fill in behind a skeleton.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { ArrowUpRight01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { GraphPanelPending, useGraphPanelClose } from "./-components/panel-shell";
import { DeploymentHistory } from "./-components/preview-panel/deployment-history";
import { OverviewTab } from "./-components/preview-panel/overview-tab";
import { SettingsTab } from "./-components/preview-panel/settings-tab";
import { badgeBase, label, type Preview } from "./-components/preview-panel/shared";
import { VariablesTab } from "./-components/preview-panel/variables-tab";

export const Route = createFileRoute("/_app/$orgSlug/_shell/$projectSlug/graph/preview/$previewId")({
  staticData: { crumb: "Preview" },
  component: PreviewPanel,
  // Open the drawer on click, not after this route's chunk loads — same
  // reasoning as the $resourceId route; see panel-shell.tsx.
  pendingMs: 0,
  pendingMinMs: 0,
  pendingComponent: GraphPanelPending,
});

/**
 * Who and what this preview is: number, PR title, author, branch, and a hop to
 * the pull request itself.
 *
 * A number and a branch name identify a preview to the machine; they say
 * nothing about whose work is running or what it changes — which is what you
 * need when several previews are open at once. Every PR field is optional:
 * previews created before that metadata was captured, and providers that omit
 * it, degrade to what they have rather than rendering blanks.
 */
/** Spell the teardown clock out on hover — "temporary" alone doesn't say when,
 *  and a preview quietly disappearing is the surprise worth pre-empting. */
function expiryTitle(autoTeardownAt: string | null): string {
  return autoTeardownAt
    ? `Torn down automatically after ${new Date(autoTeardownAt).toLocaleString()} unless there is new activity`
    : "Pinned with keep-alive — never torn down automatically";
}

function PreviewIdentity({ preview }: { preview: Preview | undefined }) {
  if (!preview) {
    return (
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[15px] font-semibold tabular-nums">…</span>
        <span className={label}>preview</span>
      </div>
    );
  }
  return (
    <>
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 font-mono text-[15px] font-semibold tabular-nums">
          #{preview.prNumber}
        </span>
        {preview.prTitle ? (
          <span className="min-w-0 truncate text-[13.5px] text-foreground/90" title={preview.prTitle}>
            {preview.prTitle}
          </span>
        ) : (
          <span className={label}>preview</span>
        )}
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
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[12.5px] text-muted-foreground">
        {preview.prAuthorAvatarUrl ? (
          <img
            src={preview.prAuthorAvatarUrl}
            alt=""
            loading="lazy"
            className="size-4 shrink-0 rounded-full ring-1 ring-border"
          />
        ) : null}
        {preview.prAuthorLogin ? <span className="shrink-0">{preview.prAuthorLogin}</span> : null}
        {preview.prAuthorLogin ? <span className="text-muted-foreground/40">·</span> : null}
        <span className="min-w-0 truncate font-mono">{preview.branch}</span>
        {/* The defining property of a preview is that it goes away. Saying so
            in the header is what separates it from a resource at a glance. */}
        <span className="text-muted-foreground/40">·</span>
        <span className="shrink-0" title={expiryTitle(preview.autoTeardownAt)}>
          {preview.autoTeardownAt ? "temporary" : "pinned"}
        </span>
        {preview.prUrl ? (
          <a
            href={preview.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 underline-offset-2 hover:text-foreground hover:underline"
            title="Open the pull request on GitHub"
          >
            PR ↗
          </a>
        ) : null}
      </div>
    </>
  );
}

function PreviewPanel() {
  const { orgSlug, projectSlug, previewId } = Route.useParams();
  const { project } = useLoaderData({ from: "/_app/$orgSlug/_shell/$projectSlug" });

  const previews = useQuery(
    orpc.project.previews.list.queryOptions({
      input: { projectId: project.id },
      refetchInterval: 5_000,
    }),
  );
  const preview = (previews.data ?? []).find((p) => p.id === previewId);
  // Owned by the parent's drawer: slides out and pans the camera back before
  // the route change lands.
  const close = useGraphPanelClose();
  const url = preview?.services.find((s) => s.url)?.url ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
        {/* Preview panels wear the same dashed edge the graph uses for a
            preview's attachment to its service, so "this is ephemeral, and it
            belongs to a PR rather than to production" is the same visual idea
            in both places. Restrained on purpose: a tint and a dashed rule,
            not a coloured chrome — it has to read as the same instrument. */}
        <header className="flex items-center gap-3 border-b border-dashed border-border bg-muted/20 px-6 py-4">
          <div className="min-w-0 flex-1">
            <PreviewIdentity preview={preview} />
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
              <div className="relative">
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
              </div>
            </div>
          </Tabs>
        ) : null}
    </div>
  );
}

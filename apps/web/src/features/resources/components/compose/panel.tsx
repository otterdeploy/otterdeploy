/**
 * Detail panel for a `type: compose` stack. A stack is N services deployed as
 * one unit, so the panel answers the three questions a single node can't:
 *   - Deployments → is it building / did the build fail / where are the logs.
 *   - Services    → how many services, what's in each, which one is up/down.
 *   - Compose     → the exact file being deployed (read-only).
 *   - Settings    → redeploy the whole stack / delete it.
 *
 * Build progress reuses the same ResourceTasksTab as services/databases —
 * compose deployments are stored under the compose resourceId, so the
 * deployment cards + per-deployment build logs work unchanged.
 */

import { useState } from "react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  Delete02Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";

import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { serviceTasksCollection } from "@/features/resources/data/service-tasks";
import { orpc } from "@/shared/server/orpc";
import { cn } from "@/shared/lib/utils";

import { PanelIcon } from "@/features/resources/components/_shared/atoms";
import { ResourceTasksTab } from "@/features/resources/components/_shared/resource-tasks-tab";

type ComposeTab = "deployments" | "services" | "file" | "settings";

type StackServiceStatus =
  | "running"
  | "building"
  | "error"
  | "offline"
  | "pending";

interface ComposeService {
  name: string;
  image: string | null;
  hasBuild: boolean;
  ports: number[];
  volumes: string[];
}

interface ComposeResourcePanelProps {
  resource: {
    resourceId: string;
    projectId: string;
    name: string;
    status: string;
    latestDeploymentStatus:
      | "pending"
      | "building"
      | "running"
      | "failed"
      | "superseded"
      | "removed"
      | null;
    source: "inline" | "git";
    stackName: string;
    services: ComposeService[];
  };
  orgSlug: string;
  projectSlug: string;
  onClose: () => void;
}

// Read-only YAML viewer — transparent so it inherits the panel surface.
const editorTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily:
        "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
      lineHeight: "1.6",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      border: "none",
      color: "color-mix(in srgb, currentColor 35%, transparent)",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 10px" },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-activeLine": { backgroundColor: "transparent" },
  },
  { dark: true },
);

const highlightStyle = HighlightStyle.define([
  { tag: [t.definition(t.propertyName), t.propertyName], color: "#79c0ff" },
  { tag: [t.string, t.special(t.string), t.content], color: "#7ee787" },
  { tag: [t.typeName, t.labelName], color: "#ffa657" },
  {
    tag: [t.comment, t.lineComment],
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
]);

const viewerExtensions = [
  editorTheme,
  yaml(),
  syntaxHighlighting(highlightStyle),
];

const stackStatusMeta: Record<
  StackServiceStatus,
  { label: string; dot: string; text: string }
> = {
  running: { label: "Running", dot: "bg-success", text: "text-success" },
  building: { label: "Building", dot: "bg-warning", text: "text-warning" },
  error: { label: "Failed", dot: "bg-destructive", text: "text-destructive" },
  offline: {
    label: "Offline",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
  },
  pending: { label: "Pending", dot: "bg-info", text: "text-info" },
};

/** Build-time base before live tasks arrive (mirrors the graph's mapping). */
function baseStatus(
  dep: ComposeResourcePanelProps["resource"]["latestDeploymentStatus"],
): StackServiceStatus | undefined {
  switch (dep) {
    case "building":
    case "pending":
      return "building";
    case "failed":
      return "error";
    case "running":
      return undefined;
    default:
      return dep == null ? "pending" : undefined;
  }
}

export function ComposeResourcePanel({
  resource,
  orgSlug,
  projectSlug,
  onClose,
}: ComposeResourcePanelProps) {
  const [tab, setTab] = useState<ComposeTab>("deployments");

  // Live per-service status from swarm tasks (the same feed the graph group
  // uses). Each task carries its compose sub-service key, so we roll up per
  // service — "which one is down?" is answerable here too.
  const { data: taskRows = [] } = useLiveQuery(
    (q) =>
      q
        .from({ d: serviceTasksCollection })
        .where(({ d }) => eq(d.projectId, resource.projectId)),
    [resource.projectId],
  );
  const byService = new Map<string, "running" | "building" | "error">();
  for (const row of taskRows) {
    if (row.resourceId !== resource.resourceId) continue;
    for (const task of row.tasks) {
      if (!task.service) continue;
      const prev = byService.get(task.service);
      // Worst-state-wins within a service: error > building > running.
      if (task.state === "error" || prev === "error") {
        byService.set(task.service, "error");
      } else if (task.state === "building" || prev === "building") {
        byService.set(task.service, "building");
      } else {
        byService.set(task.service, "running");
      }
    }
  }
  const base = baseStatus(resource.latestDeploymentStatus);
  const serviceStatus = (name: string): StackServiceStatus =>
    byService.get(name) ?? base ?? "offline";

  const runningCount = resource.services.filter(
    (s) => serviceStatus(s.name) === "running",
  ).length;

  // The raw compose file (inline source) for the read-only viewer.
  const fileQuery = useQuery(
    orpc.compose.get.queryOptions({
      input: {
        projectId: resource.projectId,
        resourceId: resource.resourceId,
      },
    }),
  );

  const redeploy = useMutation({
    ...orpc.compose.redeploy.mutationOptions(),
    onSuccess: () => {
      toast.success("Redeploying stack", {
        description: "Track progress in the Deployments tab.",
      });
      setTab("deployments");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to redeploy"),
  });

  const remove = useMutation({
    ...orpc.compose.delete.mutationOptions(),
    onSuccess: () => {
      toast.success(`Deleted ${resource.name}`);
      onClose();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to delete"),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to graph"
            onClick={onClose}
            className="mt-1"
          >
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              strokeWidth={2}
              className="size-4"
            />
          </Button>
          <PanelIcon
            node={{ kind: "compose", name: resource.name, description: "" }}
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-xl font-bold leading-none tracking-tight">
              {resource.name}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              Stack · {resource.services.length}{" "}
              {resource.services.length === 1 ? "service" : "services"} ·{" "}
              {resource.source === "git" ? "from repo" : "inline file"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              redeploy.mutate({
                projectId: resource.projectId,
                resourceId: resource.resourceId,
              })
            }
            disabled={redeploy.isPending}
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              strokeWidth={2}
              className="size-3.5"
            />
            {redeploy.isPending ? "Redeploying…" : "Redeploy"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close panel"
            onClick={onClose}
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              strokeWidth={2}
              className="size-4"
            />
          </Button>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3 border-t border-border/40 px-6 py-3">
        <span
          className={cn(
            "rounded-md px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em]",
            runningCount === resource.services.length &&
              resource.services.length > 0
              ? "bg-success/12 text-success"
              : resource.services.some((s) => serviceStatus(s.name) === "error")
                ? "bg-destructive/12 text-destructive"
                : "bg-muted text-muted-foreground",
          )}
        >
          {runningCount}/{resource.services.length} RUNNING
        </span>
        <span className="font-mono text-[12px] text-muted-foreground">
          {resource.stackName}
        </span>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v: ComposeTab) => {
          if (v) setTab(v);
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-b border-border/60 px-6">
          <TabsList variant="line" className="h-auto bg-transparent p-0">
            <TabsTrigger value="deployments" className="px-2.5 py-2.5">
              Deployments
            </TabsTrigger>
            <TabsTrigger value="services" className="px-2.5 py-2.5">
              Services
            </TabsTrigger>
            <TabsTrigger value="file" className="px-2.5 py-2.5">
              Compose
            </TabsTrigger>
            <TabsTrigger value="settings" className="px-2.5 py-2.5">
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="relative min-h-0 flex-1">
          <div className="h-full overflow-y-auto">
            <TabsContents>
              <TabsContent value="deployments" className="px-6 pt-5 pb-6">
                <ResourceTasksTab
                  projectId={resource.projectId}
                  resourceId={resource.resourceId}
                  orgSlug={orgSlug}
                  projectSlug={projectSlug}
                />
              </TabsContent>

              <TabsContent value="services" className="px-6 pt-5 pb-6">
                {resource.services.length === 0 ? (
                  <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
                    <EmptyHeader>
                      <EmptyTitle>No services parsed</EmptyTitle>
                      <EmptyDescription>
                        {resource.source === "git"
                          ? "Services appear once the stack is built from the repo."
                          : "This stack's compose file declares no services."}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {resource.services.map((s) => (
                      <ServiceRow
                        key={s.name}
                        service={s}
                        status={serviceStatus(s.name)}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="file" className="px-6 pt-5 pb-6">
                {resource.source === "git" ? (
                  <p className="mb-3 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-[12px] text-muted-foreground">
                    This stack builds from a repository — the compose file lives
                    in the repo and is resolved at build time.
                  </p>
                ) : null}
                {fileQuery.isLoading ? (
                  <div className="rounded-lg border bg-card px-4 py-6 text-center text-[12px] text-muted-foreground">
                    Loading compose file…
                  </div>
                ) : fileQuery.data?.composeContent ? (
                  <div className="overflow-hidden rounded-lg border bg-background/40">
                    <CodeMirror
                      value={fileQuery.data.composeContent}
                      readOnly
                      editable={false}
                      theme="none"
                      extensions={viewerExtensions}
                      basicSetup={{
                        lineNumbers: true,
                        foldGutter: false,
                        highlightActiveLine: false,
                        highlightActiveLineGutter: false,
                      }}
                    />
                  </div>
                ) : (
                  <p className="text-[12.5px] text-muted-foreground">
                    No compose file stored yet.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="settings" className="px-6 pt-5 pb-8">
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <div className="text-[13px] font-semibold text-destructive">
                    Delete stack
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Removes every service in this stack from swarm, its routes,
                    and the resource record. This can't be undone.
                  </p>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Delete the "${resource.name}" stack and all ${resource.services.length} of its services?`,
                        )
                      )
                        return;
                      remove.mutate({
                        projectId: resource.projectId,
                        resourceId: resource.resourceId,
                      });
                    }}
                    disabled={remove.isPending}
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      strokeWidth={2}
                      className="size-3.5"
                    />
                    {remove.isPending ? "Deleting…" : "Delete stack"}
                  </Button>
                </div>
              </TabsContent>
            </TabsContents>
          </div>
        </div>
      </Tabs>
    </div>
  );
}

function ServiceRow({
  service,
  status,
}: {
  service: ComposeService;
  status: StackServiceStatus;
}) {
  const meta = stackStatusMeta[status];
  const label =
    status === "error" && service.hasBuild ? "Build failed" : meta.label;
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[14px] font-semibold text-card-foreground">
          {service.name}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
          <span className={cn("text-[12px] leading-none", meta.text)}>
            {label}
          </span>
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
        <span className="truncate">
          {service.image ?? (service.hasBuild ? "built from source" : "—")}
        </span>
        {service.ports.length > 0 && (
          <span>· ports {service.ports.join(", ")}</span>
        )}
      </div>
      {service.volumes.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {service.volumes.map((v) => (
            <span
              key={v}
              className="rounded-md bg-muted/60 px-1.5 py-1 font-mono text-[11px] leading-none text-muted-foreground"
            >
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Logs tab every kind shares: the running container's tail (default), or
 * one deployment's build / deploy log, chosen by a source toggle. The source
 * and the deployment ride the URL (`?logSource=build&deployment=…`, see
 * panel-tab.ts PanelFocus), which is what "View logs" on a deployment sets.
 *
 * Build and deploy logs used to live on a third overlay that slid over the
 * panel with its own five-tab strip. They are a source here now: one Logs tab,
 * one place, and the panel stays where it is.
 */

import { and, eq, useLiveQuery } from "@tanstack/react-db";

import { deploymentsCollection } from "@/features/resources/data/deployments";
import { cn } from "@/shared/lib/utils";

import type { LogSource, PanelFocus } from "./panel-tab";

import { BuildLogsBody, DeploymentLogsBody } from "./deployment-logs";
import { ServiceLogsTab } from "../service/tabs/logs";

const SOURCES: Array<{ value: LogSource; label: string }> = [
  { value: "runtime", label: "Runtime" },
  { value: "build", label: "Build" },
  { value: "deploy", label: "Deploy" },
];

export function ResourceLogsTab({
  projectId,
  resourceId,
  resourceIds,
  focus,
}: {
  projectId: string;
  /** The resource whose deployments the build/deploy sources read. */
  resourceId: string;
  /** What the runtime tail follows: the resource itself, or every member of
   *  a stack. */
  resourceIds: string[];
  focus: PanelFocus;
}) {
  const source: LogSource = focus.logSource ?? "runtime";
  // Newest first, so a build/deploy source with no explicit deployment shows
  // the latest one rather than nothing.
  const { data: deployments } = useLiveQuery(
    (q) =>
      q
        .from({ d: deploymentsCollection })
        .where(({ d }) => and(eq(d.projectId, projectId), eq(d.resourceId, resourceId)))
        .orderBy(({ d }) => d.createdAt, "desc")
        .limit(20),
    [projectId, resourceId],
  );
  const focused =
    (focus.deploymentId ? deployments.find((d) => d.id === focus.deploymentId) : undefined) ??
    deployments.at(0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-1">
        <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
          {SOURCES.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={source === s.value}
              onClick={() =>
                focus.set({
                  logSource: s.value === "runtime" ? null : s.value,
                  ...(s.value === "runtime" ? {} : { deployment: focused?.id ?? null }),
                })
              }
              className={cn(
                "rounded-[5px] px-2.5 py-1 text-[12px] transition-colors",
                source === s.value
                  ? "bg-card font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        {source !== "runtime" && focused && (
          <span className="ml-2 truncate font-mono text-[11px] text-muted-foreground">
            {focused.gitSha ? focused.gitSha.slice(0, 7) : focused.image} ·{" "}
            {new Date(focused.createdAt).toLocaleString()}
          </span>
        )}
      </div>

      {source === "runtime" ? (
        <ServiceLogsTab projectId={projectId} resourceIds={resourceIds} />
      ) : !focused ? (
        <p className="text-[12.5px] text-muted-foreground">No deployment to show logs for.</p>
      ) : source === "build" ? (
        <BuildLogsBody key={focused.id} deploymentId={focused.id} deploymentStatus={focused.status} />
      ) : (
        <DeploymentLogsBody
          key={focused.id}
          projectId={projectId}
          resourceId={resourceId}
          deploymentId={focused.id}
          deploymentStatus={focused.status}
        />
      )}
    </div>
  );
}

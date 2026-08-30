/**
 * The parts of the database panel that are not its wiring: the tab list, the
 * restart mutation, and the absolutely-positioned Logs/Terminal surfaces.
 * Split out of panel.tsx under the file-length cap.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";

import { Activity } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PanelFocus } from "@/features/resources/components/_shared/panel-tab";

import { ResourceLogsTab } from "@/features/resources/components/_shared/resource-logs-tab";
import { ResourceTerminal } from "@/features/resources/components/_shared/resource-terminal";
import { orpc } from "@/shared/server/orpc";

import type { PanelTabDef } from "../_shared/panel-tabs-layout";
import type { PostgresBodyProps } from "./types";

export type DatabaseTab =
  | "overview"
  | "deployments"
  | "logs"
  | "variables"
  | "settings"
  | "data"
  | "metrics"
  | "terminal";

/** Runtime tabs are disabled until the database is deployed: no tasks, data,
 *  metrics, logs, or container exist yet. */
export function databaseTabs(pending: boolean): PanelTabDef[] {
  return [
    { value: "overview", label: "Overview", disabled: pending },
    { value: "deployments", label: "Deployments", disabled: pending },
    { value: "logs", label: "Logs", disabled: pending },
    { value: "variables", label: "Variables" },
    { value: "settings", label: "Settings" },
    { value: "data", label: "Data", disabled: pending },
    { value: "metrics", label: "Metrics", disabled: pending },
    { value: "terminal", label: "Terminal", disabled: pending },
  ];
}

/** Re-roll the running container with its current spec: same image, env, and
 *  public flag. Distinct from the wizard's create; this just bounces the swarm
 *  task (and re-applies container labels, so a DB created before a label
 *  change starts reporting metrics). */
export function useDatabaseRestart(onStarted: () => void) {
  return useMutation({
    ...orpc.project.resource.database.postgres.restart.mutationOptions(),
    onSuccess: () => {
      toast.success("Restarting database", {
        description: "Track progress in the Deployments tab.",
      });
      onStarted();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to restart"),
  });
}

/**
 * Logs and Terminal fill the pane absolutely, outside the height-animated
 * scroll container (which sizes to its content and would collapse them). Logs
 * mount on visit so a panel opened for Overview never spins up a stream;
 * the terminal stays mounted via Activity so its PTY + scrollback survive
 * tab switches.
 */
export function DatabaseSurfaces({
  resource,
  tab,
  projectSlug,
  focus,
}: {
  resource: PostgresBodyProps["resource"];
  tab: DatabaseTab;
  projectSlug: ProjectSlug;
  focus: PanelFocus;
}) {
  return (
    <>
      {tab === "logs" && (
        <div className="absolute inset-0 flex flex-col bg-card px-4 pt-5 pb-6 sm:px-6">
          <ResourceLogsTab
            projectId={resource.projectId}
            resourceId={resource.resourceId}
            resourceIds={[resource.resourceId]}
            focus={focus}
          />
        </div>
      )}
      <Activity mode={tab === "terminal" ? "visible" : "hidden"}>
        <div className="absolute inset-0 flex flex-col p-px">
          <ResourceTerminal
            match={{
              kind: "database",
              engine: resource.engine,
              serviceName: resource.runtime.serviceName,
            }}
            fallbackLabel={resource.runtime.serviceName}
            projectSlug={projectSlug}
          />
        </div>
      </Activity>
    </>
  );
}

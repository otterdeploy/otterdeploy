/**
 * The two runtime actions the service panel's header fires — Build (git) and
 * Restart — plus their post-success navigation. Deploy jumps into the new
 * deployment's Build Logs; Restart (which re-rolls the current deployment in
 * place, no new row) jumps into the active deployment's Deploy Logs. Extracted
 * so the panel component stays within the line budget.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { orpc } from "@/shared/server/orpc";

export function useServiceRuntimeActions({
  projectId,
  resourceId,
  orgSlug,
  projectSlug,
  onNoDeployment,
}: {
  projectId: string;
  resourceId: string;
  orgSlug: string;
  projectSlug: ProjectSlug;
  onNoDeployment: () => void;
}) {
  const navigate = useNavigate();
  const toDeployment = (deploymentId: string, logTab: "build-logs" | "deploy-logs") =>
    navigate({
      to: "/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId",
      params: { orgSlug, projectSlug, resourceId, deploymentId },
      search: { tab: logTab },
    });

  const buildMut = useMutation({
    ...orpc.service.build.mutationOptions(),
    // Drop straight into the new deployment's Build Logs (Railway-style) — the
    // whole point of hitting Deploy is to watch it build.
    onSuccess: ({ deploymentId }) => void toDeployment(deploymentId, "build-logs"),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to start build"),
  });

  const restartMut = useMutation({
    ...orpc.service.restart.mutationOptions(),
    onSuccess: async () => {
      // Restart re-rolls the current deployment — jump into its Deploy Logs to
      // watch the containers bounce (newest deployment is first in the list).
      const deployments = await orpc.project.resource.deployments.list.call({
        projectId,
        resourceId,
      });
      const latest = deployments[0];
      if (latest) void toDeployment(latest.id, "deploy-logs");
      else onNoDeployment();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to restart"),
  });

  return { buildMut, restartMut };
}

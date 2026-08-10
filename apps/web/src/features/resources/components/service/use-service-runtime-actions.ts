/**
 * The two runtime actions the service panel's header fires: Build (git) and
 * Restart. Deploy jumps into the new deployment's Build Logs. There's a new
 * row worth watching build. Restart re-rolls the current deployment in place
 * (no new row) and stays put. See the `restartMut` comment below. Extracted
 * so the panel component stays within the line budget.
 */

import type { ProjectSlug } from "@otterdeploy/shared/id";

import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { orpc } from "@/shared/server/orpc";

export function useServiceRuntimeActions({
  resourceId,
  orgSlug,
  projectSlug,
}: {
  resourceId: string;
  orgSlug: string;
  projectSlug: ProjectSlug;
}) {
  const navigate = useNavigate();
  const toDeployment = (deploymentId: string, logTab: "build-logs" | "deploy-logs") =>
    navigate({
      to: "/$orgSlug/$projectSlug/graph/$resourceId/deployment/$deploymentId",
      params: { orgSlug, projectSlug, resourceId, deploymentId },
      search: (prev) => ({ ...prev, deploymentTab: logTab }),
    });

  const buildMut = useMutation({
    ...orpc.service.build.mutationOptions(),
    // Drop straight into the new deployment's Build Logs (Railway-style). The
    // whole point of hitting Deploy is to watch it build.
    onSuccess: ({ deploymentId }) => void toDeployment(deploymentId, "build-logs"),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to start build"),
  });

  const restartMut = useMutation({
    ...orpc.service.restart.mutationOptions(),
    // Restart re-rolls the current deployment in place: unlike Deploy, there's
    // no new thing to look at, so stay put instead of yanking the panel over to
    // Deploy Logs (that used to blow away whatever tab (often Terminal) the
    // user was on). A toast is enough feedback; the loading state on the
    // button itself covers the in-flight gap.
    onSuccess: () => toast.success("Service restarted"),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to restart"),
  });

  return { buildMut, restartMut };
}

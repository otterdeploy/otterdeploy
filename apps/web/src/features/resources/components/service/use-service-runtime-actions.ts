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

import { usePanelRouteContext } from "../_shared/panel-routes";

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
  const { envSlug } = usePanelRouteContext();
  // Straight into the panel's Logs tab with the new deployment focused: the
  // build/deploy log is a log SOURCE of the panel now, not an overlay route.
  const toDeployment = (deploymentId: string, logSource: "build" | "deploy") =>
    navigate({
      // The environment is a path segment and stays put: Deploy or Restart on
      // Staging lands on Staging's log, never the default environment's.
      to:
        logSource === "build"
          ? "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/logs/build"
          : "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/logs/deploy",
      params: { orgSlug, projectSlug, envSlug, resourceId },
      search: { deployment: deploymentId },
      replace: true,
    });

  const buildMut = useMutation({
    ...orpc.service.build.mutationOptions(),
    // Drop straight into the new deployment's Build Logs (Railway-style). The
    // whole point of hitting Deploy is to watch it build.
    onSuccess: ({ deploymentId }) => void toDeployment(deploymentId, "build"),
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

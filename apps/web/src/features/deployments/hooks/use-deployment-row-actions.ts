/**
 * What the row actions do. Rollback opens the styled confirm the route owns;
 * the rest act here: redeploy (re-roll the deploy being served) or retry (a
 * fresh build or pull after a failure), open the build or deploy log in the
 * resource panel, copy the SHA.
 */

import type { Slug } from "@otterdeploy/shared/id";

import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { logSourceForStatus } from "@/features/resources/lib/deployment-log-tab";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { RowActions } from "../components/deployment-row-menu";
import type { ProjectDeployment } from "../data/deployments-search";

import { canRedeploy, copyTarget } from "../model/deployment-actions";
import { failedDuring } from "../model/deployments-view";

const refresh = () =>
  void queryClient.invalidateQueries({ queryKey: orpc.deployment.listByProject.key() });
const failed = (what: string) => (err: unknown) =>
  toast.error(err instanceof Error ? err.message : `Couldn't ${what}`);

export function useDeploymentRowActions(args: {
  projectId: string;
  orgSlug: string;
  projectSlug: Slug<"prj">;
  envSlug: string;
  onRollback: (d: ProjectDeployment) => void;
}): RowActions {
  const navigate = useNavigate();
  const done = (message: string) => () => {
    toast.success(message);
    refresh();
  };
  const build = useMutation({
    ...orpc.service.build.mutationOptions(),
    onSuccess: done("Build started"),
    onError: failed("start the build"),
  });
  const redeploy = useMutation({
    ...orpc.service.redeploy.mutationOptions(),
    onSuccess: done("Redeploying"),
    onError: failed("redeploy"),
  });
  const restart = useMutation({
    ...orpc.service.restart.mutationOptions(),
    onSuccess: done("Redeploying"),
    onError: failed("redeploy"),
  });

  return {
    onRedeploy: (d) => {
      const kind = canRedeploy(d);
      if (!kind) return;
      const input = { projectId: args.projectId, resourceId: d.resourceId };
      // Image services pull their image again either way. A built service
      // re-rolls the image it is serving on Redeploy, and builds afresh on
      // Retry, since the failed build left nothing to roll.
      if (!d.gitSha) redeploy.mutate(input);
      else if (kind === "Retry") build.mutate(input);
      else restart.mutate(input);
    },
    onRollback: args.onRollback,
    onViewLogs: (d) => {
      const source =
        d.status === "failed"
          ? failedDuring(d) === "build"
            ? "build"
            : "deploy"
          : logSourceForStatus(d.status);
      const params = {
        orgSlug: args.orgSlug,
        projectSlug: args.projectSlug,
        envSlug: args.envSlug,
        resourceId: d.resourceId,
      };
      void navigate({
        to:
          source === "build"
            ? "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/logs/build"
            : "/$orgSlug/projects/$projectSlug/$envSlug/r/$resourceId/logs/deploy",
        params,
        search: { deployment: d.id },
      });
    },
    onCopy: (d) => {
      const ref = copyTarget(d);
      void copyToClipboard(ref).then((ok) =>
        ok ? toast.success(`Copied ${ref.slice(0, 24)}`) : toast.error("Couldn't copy"),
      );
    },
  };
}

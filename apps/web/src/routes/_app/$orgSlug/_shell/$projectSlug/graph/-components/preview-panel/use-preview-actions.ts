/**
 * The Settings tab's lifecycle mutations — rebuild/redeploy, pause/resume,
 * teardown, keep-alive, and the DB-branch enable/disable/reset trio. Each
 * invalidates the previews list on success and toasts either way.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { orpc } from "@/shared/server/orpc";

export function usePreviewActions(projectId: string) {
  const queryClient = useQueryClient();
  const invalidatePreviews = () =>
    void queryClient.invalidateQueries({
      queryKey: orpc.project.previews.list.queryKey({ input: { projectId } }),
    });

  const opts = (successMsg: string, errorMsg: string) => ({
    onSuccess: () => {
      invalidatePreviews();
      toast.success(successMsg);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : errorMsg),
  });

  return {
    rebuild: useMutation(
      orpc.project.previews.rebuild.mutationOptions(opts("Rebuild queued", "Rebuild failed")),
    ),
    redeploy: useMutation(
      orpc.project.previews.redeploy.mutationOptions(opts("Redeployed", "Redeploy failed")),
    ),
    pause: useMutation(
      orpc.project.previews.pause.mutationOptions(opts("Preview paused", "Pause failed")),
    ),
    resume: useMutation(
      orpc.project.previews.resume.mutationOptions(opts("Preview resumed", "Resume failed")),
    ),
    teardown: useMutation(
      orpc.project.previews.teardown.mutationOptions(
        opts("Preview torn down", "Teardown failed"),
      ),
    ),
    keepAlive: useMutation(
      orpc.project.previews.keepAlive.mutationOptions(
        opts("Keep-alive updated", "Update failed"),
      ),
    ),
    dbEnable: useMutation(
      orpc.project.previews.dbBranch.enable.mutationOptions(
        opts("Database branched", "Branch failed"),
      ),
    ),
    dbDisable: useMutation(
      orpc.project.previews.dbBranch.disable.mutationOptions(
        opts("Now using base DB", "Failed"),
      ),
    ),
    dbReset: useMutation(
      orpc.project.previews.dbBranch.reset.mutationOptions(
        opts("Database re-seeded", "Re-seed failed"),
      ),
    ),
  };
}

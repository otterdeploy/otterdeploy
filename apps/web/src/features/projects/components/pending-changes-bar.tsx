/**
 * Floating "Apply N change(s)" bar — sits at the bottom of a project
 * view whenever the saved manifest diverges from current resources.
 *
 * Reads from manifest.diff (the same diff the CLI `status` command
 * uses), so the UI and CLI agree on what "pending" means:
 *   - someone saved a manifest via CLI `sync --preview` but didn't apply
 *   - a stack-code edit saved without applying
 *   - resources drifted out-of-band
 *
 * Hidden when there are no meaningful changes (`no-op` rows excluded).
 * Deploy = manifest.apply on the saved manifest. No second code path.
 */

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Id, ID_PREFIX } from "@otterstack/shared/id";

import { Button } from "@/shared/components/ui/button";
import { orpc, queryClient } from "@/shared/server/orpc";

interface PendingChangesBarProps {
  projectId: Id<typeof ID_PREFIX.project>;
  environment?: string;
}

export function PendingChangesBar({ projectId, environment }: PendingChangesBarProps) {
  const diff = useQuery(
    orpc.project.manifest.diff.queryOptions({
      input: { projectId, environment },
      // Periodic refetch — picks up out-of-band changes (CLI sync from
      // another shell, etc.) without needing a project-wide event push.
      refetchInterval: 5_000,
    }),
  );

  const apply = async () => {
    try {
      const result = await orpc.project.manifest.apply.call({ projectId, environment });
      toast.success(`Applied ${result.appliedCount} change(s)`);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.project.manifest.diff.queryKey({
            input: { projectId, environment },
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.project.resource.list.queryKey({ input: { projectId } }),
        }),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message || "Apply failed");
    }
  };

  const meaningful = (diff.data?.changes ?? []).filter((c) => c.kind !== "no-op");
  if (meaningful.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border bg-card/95 px-4 py-2 shadow-lg backdrop-blur">
        <span className="text-sm font-medium text-primary">
          Apply {meaningful.length} change{meaningful.length === 1 ? "" : "s"}
        </span>
        <Button
          size="sm"
          variant="default"
          onClick={() => void apply()}
          disabled={diff.isFetching}
        >
          Deploy
        </Button>
      </div>
    </div>
  );
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@otterstack/ui/components/ui/button";
import { Skeleton } from "@otterstack/ui/components/ui/skeleton";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";
import { toUserMessage } from "@/lib/result";
import { DeploymentStatusBadge } from "@/components/deployments/deployment-status-badge";
import { DeploymentLogViewer } from "@/components/deployments/deployment-log-viewer";

export const Route = createFileRoute(
  "/_dashboard/projects/$projectId/deployments/$deploymentId",
)({
  component: DeploymentDetailPage,
});

function DeploymentDetailPage() {
  const { projectId, deploymentId } = Route.useParams();
  const queryClient = useQueryClient();

  const deploymentQuery = useQuery(
    orpc.deployment.getById.queryOptions({
      input: { deploymentId },
    }),
  );

  const cancelMutation = useMutation(orpc.deployment.cancel.mutationOptions());
  const rollbackMutation = useMutation(orpc.deployment.rollback.mutationOptions());

  const deployment = deploymentQuery.data;

  async function handleCancel() {
    try {
      await cancelMutation.mutateAsync({ deploymentId });
      await queryClient.invalidateQueries({ queryKey: orpc.deployment.getById.key({ input: { deploymentId } }) });
      toast.success("Deployment canceled");
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to cancel deployment"));
    }
  }

  async function handleRollback() {
    try {
      await rollbackMutation.mutateAsync({ deploymentId });
      await queryClient.invalidateQueries({ queryKey: orpc.deployment.list.key() });
      toast.success("Rollback initiated");
    } catch (error) {
      toast.error(toUserMessage(error, "Failed to rollback"));
    }
  }

  if (deploymentQuery.isLoading) {
    return (
      <div className="flex-1 space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!deployment) {
    return (
      <div className="flex-1 p-6">
        <p className="text-muted-foreground">Deployment not found.</p>
      </div>
    );
  }

  const canCancel = deployment.status === "queued" || deployment.status === "building";
  const canRollback = deployment.status === "live";

  return (
    <div className="flex-1 space-y-6 overflow-auto p-6">
      <div>
        <Link
          to={`/projects/${projectId}/deployments`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
          Back to deployments
        </Link>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">Deployment</h2>
            <DeploymentStatusBadge status={deployment.status} />
          </div>
          <div className="flex gap-2">
            {canCancel && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={cancelMutation.isPending}
              >
                Cancel
              </Button>
            )}
            {canRollback && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRollback}
                disabled={rollbackMutation.isPending}
              >
                Rollback
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoItem label="Source" value={deployment.source.replace("_", " ")} />
        <InfoItem label="Build Method" value={deployment.buildMethod ?? "N/A"} />
        <InfoItem label="Git Ref" value={deployment.gitRef ?? "N/A"} />
        <InfoItem
          label="Commit"
          value={deployment.gitCommitSha ? deployment.gitCommitSha.slice(0, 7) : "N/A"}
        />
        <InfoItem
          label="Started"
          value={deployment.startedAt ? new Date(deployment.startedAt).toLocaleString() : "Pending"}
        />
        <InfoItem
          label="Completed"
          value={deployment.completedAt ? new Date(deployment.completedAt).toLocaleString() : "N/A"}
        />
        <InfoItem
          label="Duration"
          value={deployment.duration != null ? `${Math.round(deployment.duration)}s` : "N/A"}
        />
        <InfoItem
          label="Created"
          value={new Date(deployment.createdAt).toLocaleString()}
        />
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-3">Logs</h3>
        <DeploymentLogViewer deploymentId={deploymentId} />
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium capitalize mt-1">{value}</p>
    </div>
  );
}

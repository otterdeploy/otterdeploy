import { useQuery } from "@tanstack/react-query";
import { Button } from "@otterstack/ui/components/ui/button";
import { Skeleton } from "@otterstack/ui/components/ui/skeleton";

import { orpc } from "@/utils/orpc";

import { DeploymentCard } from "./deployment-card";

type DeploymentListProps = {
  projectId: string;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
};

export function DeploymentList({ projectId, page, pageSize, onPageChange }: DeploymentListProps) {
  const deploymentsQuery = useQuery(
    orpc.deployment.list.queryOptions({
      input: { projectId, page, pageSize },
    }),
  );

  if (deploymentsQuery.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!deploymentsQuery.data || deploymentsQuery.data.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h3 className="text-lg font-semibold">No deployments yet</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Deployments will appear here when you deploy your project.
        </p>
      </div>
    );
  }

  const { items, meta } = deploymentsQuery.data;
  const { pagination } = meta;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {items.map((deployment) => (
          <DeploymentCard
            key={deployment.id}
            id={deployment.id}
            projectId={projectId}
            status={deployment.status}
            source={deployment.source}
            gitRef={deployment.gitRef}
            gitCommitSha={deployment.gitCommitSha}
            gitCommitMessage={deployment.gitCommitMessage}
            startedAt={deployment.startedAt}
            completedAt={deployment.completedAt}
            duration={deployment.duration}
            createdAt={deployment.createdAt}
          />
        ))}
      </div>

      {pagination.pageCount > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.pageCount} ({pagination.total} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => onPageChange(pagination.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.pageCount}
              onClick={() => onPageChange(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

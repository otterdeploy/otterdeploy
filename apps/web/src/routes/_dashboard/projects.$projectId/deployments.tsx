import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { DeploymentList } from "@/components/deployments/deployment-list";

export const Route = createFileRoute(
  "/_dashboard/projects/$projectId/deployments",
)({
  component: DeploymentsPage,
});

function DeploymentsPage() {
  const { projectId } = Route.useParams();
  const [page, setPage] = useState(1);

  return (
    <div className="flex-1 space-y-6 overflow-auto p-6">
      <div>
        <h2 className="text-xl font-semibold">Deployments</h2>
        <p className="text-muted-foreground text-sm mt-1">
          View and manage deployments for this project.
        </p>
      </div>
      <DeploymentList
        projectId={projectId}
        page={page}
        pageSize={10}
        onPageChange={setPage}
      />
    </div>
  );
}

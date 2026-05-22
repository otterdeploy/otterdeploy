import { DeploymentsTable } from "@/features/project-deployments";

export function DeploymentsTab() {
  return (
    <div className="p-4">
      <DeploymentsTable scope="resource" />
    </div>
  );
}

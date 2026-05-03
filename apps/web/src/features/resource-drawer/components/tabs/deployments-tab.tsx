import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export function DeploymentsTab() {
  return (
    <div className="grid place-items-center p-8">
      <Empty>
        <EmptyTitle>Deployments</EmptyTitle>
        <EmptyDescription>Deployment history per resource lands in Plan 4.</EmptyDescription>
      </Empty>
    </div>
  );
}

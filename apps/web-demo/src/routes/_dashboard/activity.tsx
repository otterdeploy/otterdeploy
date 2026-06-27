import { createFileRoute } from "@tanstack/react-router";

import { ActivityFeed } from "@/features/workspace-activity";

export const Route = createFileRoute("/_dashboard/activity")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="p-6">
      <ActivityFeed />
    </div>
  );
}

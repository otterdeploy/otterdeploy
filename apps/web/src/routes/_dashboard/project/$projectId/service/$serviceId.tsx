import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/project/$projectId/service/$serviceId")({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Hello "/_dashboard/project/$projectId/service"!</div>;
}

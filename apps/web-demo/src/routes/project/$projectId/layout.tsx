import { createFileRoute } from "@tanstack/react-router";

import { OtterdeployApp } from "@/features/otterdeploy/app";

export const Route = createFileRoute("/project/$projectId/layout")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      <OtterdeployApp />
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";

import { OtterstackApp } from "@/features/otterstack/app";

export const Route = createFileRoute("/project/$projectId/layout")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      <OtterstackApp />
    </div>
  );
}

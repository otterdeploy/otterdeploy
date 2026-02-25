import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/projects/$projectId/architecture/")({
  component: () => null,
});

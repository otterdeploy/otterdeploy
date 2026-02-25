import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dash/projects/$projectId/architecture/")({
  component: () => null,
});

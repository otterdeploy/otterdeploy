import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_dashboard/projects/$projectId/",
)({
  beforeLoad: ({ params }) => {
    redirect({
      to: `/projects/${params.projectId}/architecture`,
      throw: true,
    });
  },
});

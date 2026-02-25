import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/projects/$projectId/")({
  // beforeLoad: ({ params }) => {
  //   throw redirect({
  //     to: "/projects/$projectId/architecture",
  //     params: { projectId: params.projectId },
  //   });
  // },
});

import { createFileRoute, redirect } from "@tanstack/react-router";
import * as z from "zod";

const searchSchema = z.object({
  env: z.string().default("production"),
});

export const Route = createFileRoute("/dash/projects/$projectId/")({
  component: RouteComponent,
  validateSearch: searchSchema,
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/dash/projects/$projectId/architecture",
      params: { projectId: params.projectId },
      search: { env: search.env },
    });
  },
});

function RouteComponent() {
  return <div>Hello "/dash/projects/$projectId/"!</div>;
}

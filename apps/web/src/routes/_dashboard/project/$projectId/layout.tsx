import { createFileRoute, Outlet } from "@tanstack/react-router";
import * as z from "zod";
import { ProjectShell } from "@/components/shell/project-shell";

const search = z.object({
  env: z.enum(["development", "staging", "production"]).default("development"),
});

export const Route = createFileRoute("/_dashboard/project/$projectId")({
  validateSearch: search,
  component: RouteComponent,
});

function RouteComponent() {
  const { projectId } = Route.useParams();
  return (
    <ProjectShell projectId={projectId} projectName={projectId}>
      <Outlet />
    </ProjectShell>
  );
}

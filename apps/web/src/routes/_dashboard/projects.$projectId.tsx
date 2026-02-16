import { createFileRoute, Outlet } from "@tanstack/react-router";

import { ProjectTabs } from "@/components/project/project-tabs";

export const Route = createFileRoute("/_dashboard/projects/$projectId")({
  component: ProjectLayout,
});

function ProjectLayout() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ProjectTabs />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}

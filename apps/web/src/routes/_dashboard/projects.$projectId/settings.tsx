import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_dashboard/projects/$projectId/settings",
)({
  component: ProjectSettingsPage,
});

function ProjectSettingsPage() {
  return (
    <div className="flex-1 p-6">
      <h2 className="text-xl font-semibold">Project Settings</h2>
      <p className="text-muted-foreground text-sm mt-1">
        Configure project settings.
      </p>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "@/features/workspace-settings";

export const Route = createFileRoute("/_dashboard/settings")({
  component: RouteComponent,
});

function RouteComponent() {
  return <SettingsPage />;
}

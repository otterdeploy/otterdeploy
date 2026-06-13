import { createFileRoute } from "@tanstack/react-router";

import { NotificationsPage } from "@/features/notifications/notifications-page";

export const Route = createFileRoute("/_app/$orgSlug/notifications")({
  staticData: { crumb: "Notifications" },
  component: NotificationsPage,
});

/**
 * Redirect shim. Notifications moved out of the settings zone into the
 * operational shell (`/$orgSlug/notifications`) — routing events to a channel
 * is a surface you return to (add a channel, mute a noisy event, check a failed
 * delivery), not one-time configuration.
 *
 * Kept as a redirect rather than deleted because this path is linked from
 * notification emails, saved bookmarks, and older docs.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/notifications")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/notifications",
      params: { orgSlug: params.orgSlug },
      replace: true,
    });
  },
});

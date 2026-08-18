/**
 * Redirect shim. Secret providers moved out of the settings zone into the
 * operational shell (`/$orgSlug/secrets`): connecting a provider, rotating
 * its credential and re-testing it are surfaces you return to, not one-time
 * configuration.
 *
 * Kept as a redirect rather than deleted because this path may live in saved
 * bookmarks and older docs.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/secret-providers")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$orgSlug/secrets",
      params: { orgSlug: params.orgSlug },
      replace: true,
    });
  },
});

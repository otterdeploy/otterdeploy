import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({
  beforeLoad: ({ context, location }) => {
    // The GitHub install/manifest callback redirects to the web root with
    // `?git_install=ok|error&reason=…`. Read them off the raw location (no
    // route-level validateSearch — that would force every `navigate({to:"/"})`
    // to pass search) and forward to the Git providers page, which surfaces
    // the toast and strips the query. Otherwise land on the org home.
    const search = location.search as { git_install?: "ok" | "error"; reason?: string };
    if (search.git_install) {
      throw redirect({
        to: "/$orgSlug/settings/workspace/git-providers",
        params: { orgSlug: context.activeOrgSlug },
        search: { git_install: search.git_install, reason: search.reason },
      });
    }
    throw redirect({
      to: "/$orgSlug",
      params: { orgSlug: context.activeOrgSlug },
    });
  },
});

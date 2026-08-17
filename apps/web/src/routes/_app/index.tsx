import { createFileRoute, redirect } from "@tanstack/react-router";
import * as z from "zod";

// The GitHub install/manifest callback redirects to the web root with
// `?git_install=ok|error&reason=…`. Parsed off the raw location (no
// route-level validateSearch: that would force every `navigate({to:"/"})`
// to pass search). Mirrors the git-providers route's own schema: an invalid
// value degrades to undefined there too.
const callbackSearch = z.object({
  git_install: z.enum(["ok", "error"]).optional().catch(undefined),
  reason: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_app/")({
  staticData: { crumb: "Projects" },
  beforeLoad: ({ context, location }) => {
    // Forward the callback params to the Git providers page, which surfaces
    // the toast and strips the query. Otherwise land on the org home.
    const parsed = callbackSearch.safeParse(location.search);
    const search: z.infer<typeof callbackSearch> = parsed.success ? parsed.data : {};
    if (search.git_install) {
      throw redirect({
        to: "/$orgSlug/git-providers",
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

import { createFileRoute, redirect } from "@tanstack/react-router";
import * as z from "zod";

// Moved out of the settings zone into the operational sidebar (Workspace
// group): a source connection is what deploy-on-push runs on, not one-time
// configuration. Shim only: the typed search params MUST be forwarded, since
// a GitHub install round-trip started before this move lands back here with
// `?git_install=ok|error` and the page needs `returnTo` to finish the flow.
const searchSchema = z.object({
  git_install: z.enum(["ok", "error"]).optional().catch(undefined),
  reason: z.string().optional(),
  returnTo: z.string().startsWith("/").optional().catch(undefined),
});

export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/git-providers")({
  staticData: { crumb: "Git providers" },
  validateSearch: searchSchema,
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/$orgSlug/git-providers",
      params: { orgSlug: params.orgSlug },
      search,
    });
  },
});

import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

// Moved to Settings → Workspace → Git providers. Shim only — the GitHub
// install/manifest callback still lands here (`?git_install=ok|error`), so
// the typed search params MUST be forwarded for the toast + `returnTo` flow.
const searchSchema = z.object({
  git_install: z.enum(["ok", "error"]).optional().catch(undefined),
  reason: z.string().optional(),
  returnTo: z.string().startsWith("/").optional().catch(undefined),
});

export const Route = createFileRoute("/_app/$orgSlug/git-providers")({
  validateSearch: searchSchema,
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/$orgSlug/settings/workspace/git-providers",
      params: { orgSlug: params.orgSlug },
      search,
    });
  },
});

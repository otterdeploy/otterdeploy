import { createFileRoute, redirect } from "@tanstack/react-router";
import * as z from "zod";

// Demoted to the "Raw Docker" tab under Servers (od-u63.3) — an escape hatch,
// not a peer of Servers. Shim only — the old sub-tab (`?tab=volumes` etc.)
// forwards into the new `dockerTab` search param so deep links still land on
// the right table.
const dockerSearch = z.object({
  tab: z.enum(["containers", "images", "volumes", "networks", "tasks"]).optional(),
});

export const Route = createFileRoute("/_app/$orgSlug/_shell/docker")({
  validateSearch: dockerSearch,
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/$orgSlug/servers",
      params: { orgSlug: params.orgSlug },
      search: { tab: "docker", dockerTab: search.tab },
    });
  },
});

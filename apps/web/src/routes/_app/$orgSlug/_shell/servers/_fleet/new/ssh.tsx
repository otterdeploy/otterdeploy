import { createFileRoute } from "@tanstack/react-router";

import {
  ADD_SERVER_VIEW,
  addServerSearchSchema,
} from "@/features/servers/add-server/add-server-route";

// The SSH tab. `?from=<server>` re-adds a failed server with its non-secret
// fields filled in. The dialog in ./layout.tsx renders it.
export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/_fleet/new/ssh")({
  staticData: { view: ADD_SERVER_VIEW.ssh },
  validateSearch: addServerSearchSchema,
});

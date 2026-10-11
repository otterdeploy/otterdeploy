import { createFileRoute, useSearch } from "@tanstack/react-router";

import { AddServerDialog } from "@/features/servers/add-server/add-server-dialog";

/**
 * `/servers/new/{command,ssh}`: the Add a server dialog over the Servers page.
 * The method is a child route (a tab is a route, see shared/router.d.ts), so a
 * tab can be linked, reloaded and left with Back. The dialog stays mounted
 * across a tab switch; only the route under it changes.
 */
export const Route = createFileRoute("/_app/$orgSlug/_shell/servers/_fleet/new")({
  staticData: { crumb: "Add a server" },
  component: AddServerRoute,
});

function AddServerRoute() {
  const { orgSlug } = Route.useParams();
  // `from` is declared on the SSH route only; on the Command tab there is none.
  const ssh = useSearch({
    from: "/_app/$orgSlug/_shell/servers/_fleet/new/ssh",
    shouldThrow: false,
  });
  return <AddServerDialog orgSlug={orgSlug} from={ssh?.from} />;
}

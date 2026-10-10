/**
 * Org-scoped SSH keys page: the keys otterdeploy signs in to servers with.
 * Generated (we hold the encrypted private half) and imported (public-only);
 * owners/admins can generate, import, rotate and delete them. Private key
 * material is never sent to the browser. The page body lives in
 * features/ssh-keys/ssh-keys-page.tsx.
 */

import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { SshKeysPage } from "@/features/ssh-keys/ssh-keys-page";
import { useMembers } from "@/features/team/data/use-team";
import { orpc, queryClient } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/_shell/ssh-keys")({
  staticData: { crumb: "SSH keys" },
  component: RouteComponent,
  loader: () => {
    void queryClient
      .prefetchQuery(orpc.sshKeys.list.queryOptions())
      .catch(() => undefined);
  },
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { user } = Route.useRouteContext();
  const members = useMembers(organization.id);
  const myRole = members.data?.find((m) => m.userId === user.id)?.role;
  return <SshKeysPage canManage={myRole === "owner" || myRole === "admin"} />;
}

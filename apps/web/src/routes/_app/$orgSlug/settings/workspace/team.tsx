import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { InviteMemberForm } from "@/features/team/components/invite-member-form";
import { MembersList } from "@/features/team/components/members-list";
import { PendingInvitations } from "@/features/team/components/pending-invitations";
import { useMembers } from "@/features/team/data/use-team";
import { Page, PageHeader } from "@/shared/components/page";

export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/team")({
  staticData: { crumb: "Team" },
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { user } = Route.useRouteContext();
  const orgId = organization.id;

  // Reuse the members query (cached) to resolve the viewer's own role — only
  // owners/admins get the invite + remove controls.
  const members = useMembers(orgId);
  const myRole = members.data?.find((m) => m.userId === user.id)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  return (
    <Page width="narrow">
      <PageHeader
        title="Team"
        description={
          <>
            Everyone in{" "}
            <span className="font-medium text-foreground/80">
              {organization.name}
            </span>{" "}
            can access every project in this workspace, gated by role.
          </>
        }
      />

      {canManage ? <InviteMemberForm organizationId={orgId} /> : null}
      <MembersList organizationId={orgId} currentUserId={user.id} canManage={canManage} />
      <PendingInvitations organizationId={orgId} canManage={canManage} />
    </Page>
  );
}

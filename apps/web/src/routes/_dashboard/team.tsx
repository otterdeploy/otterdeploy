import { createFileRoute } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { Button } from "@otterstack/ui/components/ui/button";
import { Skeleton } from "@otterstack/ui/components/ui/skeleton";

import { authClient } from "@/lib/auth-client";
import { MemberList } from "@/components/team/member-list";
import { InviteMemberDialog } from "@/components/team/invite-member-dialog";

export const Route = createFileRoute("/_dashboard/team")({
  component: TeamPage,
});

function TeamPage() {
  const { data: activeOrg, isPending } = authClient.useActiveOrganization();
  const members = (activeOrg as unknown as { members?: Array<{ id: string; userId: string; role: string; user: { name: string; email: string } }> })?.members ?? [];

  return (
    <div className="flex-1 space-y-6 overflow-auto p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Team</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your organization members and invitations.
          </p>
        </div>
        <InviteMemberDialog>
          <Button>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="mr-2 size-4" />
            Invite Member
          </Button>
        </InviteMemberDialog>
      </div>

      {isPending && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      )}

      {!isPending && <MemberList members={members} />}
    </div>
  );
}

/**
 * Current organization members. Owners/admins can remove others; the row
 * for the signed-in user is marked "You" and never removable. Last-owner
 * protection is enforced server-side by better-auth — we surface any error.
 */

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  teamKeys,
  useMembers,
  type TeamMember,
} from "@/features/team/data/use-team";

export function MembersList({
  organizationId,
  currentUserId,
  canManage,
}: {
  organizationId: string;
  currentUserId: string;
  canManage: boolean;
}) {
  const members = useMembers(organizationId);
  const rows = members.data ?? [];

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">
        Members{rows.length > 0 ? ` (${rows.length})` : ""}
      </h3>
      <div className="flex flex-col divide-y rounded-xl border">
        {members.isLoading && rows.length === 0 ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-1/3" />
          </div>
        ) : (
          rows.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              organizationId={organizationId}
              isSelf={m.userId === currentUserId}
              canManage={canManage}
            />
          ))
        )}
      </div>
    </section>
  );
}

function MemberRow({
  member,
  organizationId,
  isSelf,
  canManage,
}: {
  member: TeamMember;
  organizationId: string;
  isSelf: boolean;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: async () => {
      const res = await authClient.organization.removeMember({
        memberIdOrEmail: member.id,
        organizationId,
      });
      if (res.error) {
        throw new Error(res.error.message ?? "Failed to remove member");
      }
      return res.data;
    },
    onSuccess: () => {
      toast.success(`Removed ${member.email}`);
      void queryClient.invalidateQueries({
        queryKey: teamKeys.members(organizationId),
      });
    },
    onError: (err) => toast.error(err.message ?? "Failed to remove member"),
  });

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-medium uppercase">
        {(member.name || member.email).slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">
          {member.name}
          {isSelf ? <span className="text-muted-foreground"> (You)</span> : null}
        </div>
        <div className="truncate text-[12px] text-muted-foreground">{member.email}</div>
      </div>
      <Badge variant="secondary" className="text-[10px] font-normal capitalize">
        {member.role}
      </Badge>
      {canManage && !isSelf ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
          aria-label={`Remove ${member.email}`}
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

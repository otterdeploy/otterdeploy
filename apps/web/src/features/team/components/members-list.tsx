/**
 * Current organization members. Owners/admins can remove others; the row
 * for the signed-in user is marked "You" and never removable. Last-owner
 * protection is enforced server-side by better-auth — we surface any error.
 *
 * Reads/mutates `membersCollection` directly: removal is an optimistic
 * `collection.delete`, with rollback/toast off the transaction's
 * `isPersisted` promise.
 */

import { useState } from "react";

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { membersCollection, useMembers, type TeamMember } from "@/features/team/data/use-team";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Skeleton } from "@/shared/components/ui/skeleton";

/** Roles an admin/owner can assign to a member from the list. Owners are not
 *  offered here — transferring ownership is a separate, deliberate action. */
const ROLE_OPTIONS = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
] as const;

export function MembersList({
  organizationId,
  currentUserId,
  canManage,
}: {
  organizationId: string;
  currentUserId: string;
  canManage: boolean;
}) {
  const { data: rows, isLoading } = useMembers(organizationId);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Members{rows.length > 0 ? ` (${rows.length})` : ""}</h3>
      <div className="flex flex-col divide-y rounded-xl border">
        {isLoading && rows.length === 0 ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-1/3" />
          </div>
        ) : (
          rows.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
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
  isSelf,
  canManage,
}: {
  member: TeamMember;
  isSelf: boolean;
  canManage: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const remove = () => {
    setBusy(true);
    const tx = membersCollection.delete(member.id);
    tx.isPersisted.promise
      .then(() => toast.success(`Removed ${member.email}`))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Failed to remove member"),
      )
      .finally(() => setBusy(false));
  };

  const changeRole = (next: string) => {
    if (!next || next === member.role) return;
    // Optimistic: the Select's value is already `member.role`, so the collection
    // update reflects instantly and rolls back itself on failure.
    membersCollection
      .update(member.id, (draft) => {
        // The Select only surfaces valid role values, so narrow the string back to
        // the role union the collection field expects.
        draft.role = next as typeof member.role;
      })
      .isPersisted.promise.catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Failed to update role"),
      );
  };

  // Owners aren't editable via this control; managers can reassign everyone else.
  const canEditRole = canManage && !isSelf && member.role !== "owner";

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
      {canEditRole ? (
        <Select
          items={ROLE_OPTIONS.map((r) => ({ label: r.label, value: r.value }))}
          value={member.role}
          onValueChange={(v) => changeRole(v ?? "")}
        >
          <SelectTrigger className="h-7 w-[110px] text-[12px] capitalize">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Badge variant="secondary" className="text-[10px] font-normal capitalize">
          {member.role}
        </Badge>
      )}
      {canManage && !isSelf ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          disabled={busy}
          onClick={remove}
          aria-label={`Remove ${member.email}`}
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Pending (unaccepted) organization invitations. Owners/admins can cancel
 * one before it's accepted. Hidden entirely when there are none.
 *
 * Reads/mutates `invitationsCollection` directly: cancel is an optimistic
 * `collection.delete`, with rollback/toast off the transaction's
 * `isPersisted` promise.
 */

import { useState } from "react";

import { Cancel01Icon, MailAtSign01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { CopyLinkButton } from "@/features/team/components/copy-link-button";
import {
  acceptInviteUrl,
  invitationsCollection,
  useInvitations,
  type PendingInvite,
} from "@/features/team/data/use-team";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";

export function PendingInvitations({
  organizationId,
  canManage,
}: {
  organizationId: string;
  canManage: boolean;
}) {
  const { data: rows } = useInvitations(organizationId);

  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Pending invitations ({rows.length})</h3>
      <div className="flex flex-col divide-y rounded-xl border">
        {rows.map((invite) => (
          <InviteRow key={invite.id} invite={invite} canManage={canManage} />
        ))}
      </div>
    </section>
  );
}

function InviteRow({ invite, canManage }: { invite: PendingInvite; canManage: boolean }) {
  const [busy, setBusy] = useState(false);

  const cancel = () => {
    setBusy(true);
    const tx = invitationsCollection.delete(invite.id);
    tx.isPersisted.promise
      .then(() => toast.success(`Invitation to ${invite.email} cancelled`))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Failed to cancel invitation"),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <HugeiconsIcon
        icon={MailAtSign01Icon}
        strokeWidth={1.8}
        className="size-4 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">{invite.email}</div>
        <div className="truncate text-[12px] text-muted-foreground">
          Expires {invite.expiresAt.toLocaleDateString()}
        </div>
      </div>
      <Badge variant="secondary" className="text-[10px] font-normal capitalize">
        {invite.role}
      </Badge>
      <CopyLinkButton link={acceptInviteUrl(invite.id)} />
      {canManage ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          disabled={busy}
          onClick={cancel}
          aria-label={`Cancel invitation to ${invite.email}`}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.8} className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

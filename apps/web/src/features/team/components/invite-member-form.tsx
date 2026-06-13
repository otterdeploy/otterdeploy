/**
 * Invite a new member to the organization by email + role. Owners/admins
 * only (the Team page gates rendering). On success better-auth sends the
 * invitation email (sendInvitationEmail) and we refresh the pending list.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { CopyLinkButton } from "@/features/team/components/copy-link-button";
import { acceptInviteUrl, teamKeys } from "@/features/team/data/use-team";

const INVITE_ROLES = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
] as const;

export function InviteMemberForm({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("member");
  const [sent, setSent] = useState<{ email: string; url: string } | null>(null);

  const invite = useMutation({
    mutationFn: async (vars: { email: string; role: string }) => {
      const res = await authClient.organization.inviteMember({
        email: vars.email,
        role: vars.role as "member" | "admin",
        organizationId,
      });
      if (res.error) {
        throw new Error(res.error.message ?? "Failed to send invitation");
      }
      return res.data;
    },
    onSuccess: (data, vars) => {
      toast.success(`Invitation sent to ${vars.email}`);
      if (data?.id) {
        setSent({ email: vars.email, url: acceptInviteUrl(data.id) });
      }
      setEmail("");
      void queryClient.invalidateQueries({
        queryKey: teamKeys.invitations(organizationId),
      });
    },
    onError: (err) => toast.error(err.message ?? "Failed to send invitation"),
  });

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h3 className="text-sm font-semibold">Invite a teammate</h3>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          They&apos;ll get an email link to join. Admins can manage members and
          settings; members can build and deploy but not administer the
          workspace.
        </p>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!email.trim() || invite.isPending) return;
          invite.mutate({ email: email.trim(), role });
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="invite-email" className="text-[12px]">
            Email
          </Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="h-9"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-[12px]">Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v ?? "member")}>
            <SelectTrigger className="h-9 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INVITE_ROLES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={!email.trim() || invite.isPending} className="h-9">
          Send invite
        </Button>
      </form>

      {sent ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
          <p className="min-w-0 text-[12px] text-muted-foreground">
            Invited{" "}
            <span className="font-medium text-foreground/80">{sent.email}</span>. If
            the email doesn&apos;t arrive, share this link directly.
          </p>
          <CopyLinkButton link={sent.url} label="Copy invite link" className="shrink-0" />
        </div>
      ) : null}
    </div>
  );
}

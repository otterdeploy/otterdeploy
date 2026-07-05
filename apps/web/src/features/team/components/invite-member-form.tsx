/**
 * Invite a new member to the organization by email + role. Owners/admins
 * only (the Team page gates rendering).
 *
 * Calls `authClient.organization.inviteMember` directly so we get the real
 * invitation id back and can always offer a copyable accept link — email
 * delivery is best-effort (a self-hosted install may have no transport
 * configured), so the link is the reliable path. The email field validates
 * against the loaded members + pending invites so an existing member or a
 * duplicate invite is caught inline before we hit the server (which also
 * rejects it as a fallback).
 */

import { useState } from "react";

import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";

import { CopyLinkButton } from "@/features/team/components/copy-link-button";
import {
  acceptInviteUrl,
  invitationsSubsetKey,
  useInvitations,
  useMembers,
} from "@/features/team/data/use-team";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/shared/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { queryClient } from "@/shared/server/orpc";

const INVITE_ROLES = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
] as const;

export function InviteMemberForm({ organizationId }: { organizationId: string }) {
  const [sent, setSent] = useState<{ email: string; url: string } | null>(null);
  // Loaded so the email field can flag an existing member / pending invite
  // inline (and so the collections are warm for the rest of the Team page).
  const { data: members } = useMembers(organizationId);
  const { data: pending } = useInvitations(organizationId);

  const form = useForm({
    defaultValues: {
      email: "",
      role: "member" as "member" | "admin",
    },
    onSubmit: async ({ value }) => {
      const email = value.email.trim();
      if (!email) return;

      const res = await authClient.organization.inviteMember({
        email,
        role: value.role,
        organizationId,
      });
      if (res.error) {
        // Server is authoritative (e.g. already-a-member if the client list was
        // stale). Surface its message rather than a generic failure.
        toast.error(res.error.message ?? "Couldn't create the invitation");
        return;
      }

      form.reset();
      // Refresh the pending-invites list to show the new row.
      void queryClient.invalidateQueries({ queryKey: [...invitationsSubsetKey(organizationId)] });

      // Use the real invitation id from the response so the accept link always
      // works — even when no email was delivered.
      const inviteId = res.data?.id;
      if (inviteId) {
        setSent({ email, url: acceptInviteUrl(inviteId) });
      }
      toast.success(`Invitation created for ${email}`);
    },
  });

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h3 className="text-sm font-semibold">Invite a teammate</h3>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          They&apos;ll get an email link to join (if email is configured). Admins can manage members
          and settings; members can build and deploy but not administer the workspace.
        </p>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        noValidate
      >
        <form.Field
          name="email"
          validators={{
            onChange: ({ value }) => {
              const email = value.trim().toLowerCase();
              if (!email) return "Email is required";
              if ((members ?? []).some((m) => m.email.toLowerCase() === email)) {
                return "This person is already a member of the organization";
              }
              if ((pending ?? []).some((i) => i.email.toLowerCase() === email)) {
                return "An invite is already pending for this email";
              }
              return undefined;
            },
          }}
        >
          {(field) => (
            <Field className="flex-1">
              <FieldLabel htmlFor="invite-email" className="text-[12px]">
                Email
              </FieldLabel>
              <Input
                id="invite-email"
                type="email"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="teammate@company.com"
              />
              <FieldError
                errors={field.state.meta.errors.map((e) =>
                  typeof e === "string" ? { message: e } : (e as { message?: string } | undefined),
                )}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="role">
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <Label className="text-[12px]">Role</Label>
              <Select
                items={INVITE_ROLES.map((r) => ({ label: r.label, value: r.value }))}
                value={field.state.value}
                onValueChange={(v) => field.handleChange((v ?? "member") as "member" | "admin")}
              >
                {/* No height override: the trigger's data-[size=default]:h-8
                    beats a plain h-* class anyway (data variants sort later),
                    which is exactly how this row ended up uneven. All three
                    controls sit on the system default h-8. */}
                <SelectTrigger className="w-[130px]">
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
          )}
        </form.Field>
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting} className="mt-[22px]">
              Send invite
            </Button>
          )}
        </form.Subscribe>
      </form>

      {sent ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
          <p className="min-w-0 text-[12px] text-muted-foreground">
            Invited <span className="font-medium text-foreground/80">{sent.email}</span>. If email
            delivery isn&apos;t set up, share this link so they can join.
          </p>
          <CopyLinkButton link={sent.url} label="Copy invite link" className="shrink-0" />
        </div>
      ) : null}
    </div>
  );
}

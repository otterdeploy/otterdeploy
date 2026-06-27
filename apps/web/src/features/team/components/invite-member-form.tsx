/**
 * Invite a new member to the organization by email + role. Owners/admins
 * only (the Team page gates rendering). Inserts optimistically into
 * `invitationsCollection`; `onInsert` calls `authClient.organization
 * .inviteMember` (which sends the email) and refetches so the real row
 * (server id, resolved expiry) replaces the optimistic one. After the
 * transaction persists we look the real invite up by email to offer a
 * copyable accept link (for when email delivery isn't configured).
 */

import { useState } from "react";

import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";

import { CopyLinkButton } from "@/features/team/components/copy-link-button";
import { acceptInviteUrl, invitationsCollection } from "@/features/team/data/use-team";
import { Button } from "@/shared/components/ui/button";
import { Field, FieldLabel } from "@/shared/components/ui/field";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

const INVITE_ROLES = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
] as const;

export function InviteMemberForm({ organizationId }: { organizationId: string }) {
  const [sent, setSent] = useState<{ email: string; url: string } | null>(null);

  const form = useForm({
    defaultValues: {
      email: "",
      role: "member" as "member" | "admin",
    },
    onSubmit: async ({ value }) => {
      const email = value.email.trim();
      if (!email) return;

      // Optimistic insert: `onInsert` mints the invite server-side (and sends
      // the email), then refetches so the real row replaces this temp one.
      // Expiry is resolved server-side; the temp row uses a placeholder until
      // the refetch lands.
      const tx = invitationsCollection.insert({
        id: crypto.randomUUID(),
        organizationId,
        email,
        role: value.role,
        expiresAt: new Date(),
      });

      form.reset();
      tx.isPersisted.promise
        .then(() => {
          toast.success(`Invitation sent to ${email}`);
          // Recover the real invitation (server id) for the share link.
          const real = invitationsCollection.toArray.find((i) => i.email === email);
          if (real) setSent({ email, url: acceptInviteUrl(real.id) });
        })
        .catch((err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Failed to send invitation"),
        );
    },
  });

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h3 className="text-sm font-semibold">Invite a teammate</h3>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          They&apos;ll get an email link to join. Admins can manage members and settings; members
          can build and deploy but not administer the workspace.
        </p>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        noValidate
      >
        <form.Field
          name="email"
          validators={{
            onChange: ({ value }) => (value.trim().length === 0 ? "Email is required" : undefined),
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
                className="h-9"
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
          )}
        </form.Field>
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting} className="h-9">
              Send invite
            </Button>
          )}
        </form.Subscribe>
      </form>

      {sent ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
          <p className="min-w-0 text-[12px] text-muted-foreground">
            Invited <span className="font-medium text-foreground/80">{sent.email}</span>. If the
            email doesn&apos;t arrive, share this link directly.
          </p>
          <CopyLinkButton link={sent.url} label="Copy invite link" className="shrink-0" />
        </div>
      ) : null}
    </div>
  );
}

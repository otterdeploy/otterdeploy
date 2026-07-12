/**
 * Change password — better-auth's `changePassword` (email/password is enabled
 * in packages/auth). Shown only when the user actually has a credential
 * account; a social-only sign-in gets an honest hint instead of a form that
 * would 400. Optionally revokes every other session on change.
 */

import type { AnyFieldApi } from "@tanstack/react-form";

import { SquareLockPasswordIcon } from "@hugeicons/core-free-icons";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { SettingsFooter, SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Skeleton } from "@/shared/components/ui/skeleton";

import { authKeys, useLinkedAccounts } from "./data/use-account";

// better-auth server default (minPasswordLength) — mirrored for instant
// client-side feedback; the server still enforces it.
const MIN_PASSWORD_LENGTH = 8;

interface PasswordValues {
  current: string;
  next: string;
  confirm: string;
  revokeOthers: boolean;
}

function isComplete(values: PasswordValues): boolean {
  return (
    values.current.length > 0 &&
    values.next.length >= MIN_PASSWORD_LENGTH &&
    values.next === values.confirm
  );
}

export function PasswordCard() {
  const accountsQ = useLinkedAccounts();
  const hasCredential = (accountsQ.data ?? []).some((a) => a.providerId === "credential");

  return (
    <SettingsSection
      icon={SquareLockPasswordIcon}
      title="Password"
      description="The credential used for email + password sign-in."
    >
      {accountsQ.isPending ? (
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : accountsQ.isError ? (
        <div className="flex items-center justify-between gap-3 p-4">
          <span className="text-[12.5px] text-muted-foreground">
            Couldn't load your sign-in methods.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void accountsQ.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : !hasCredential ? (
        <div className="p-4 text-[12.5px] leading-relaxed text-muted-foreground">
          Your account signs in through a linked provider — no password is set, so there's nothing
          to change here.
        </div>
      ) : (
        <ChangePasswordForm />
      )}
    </SettingsSection>
  );
}

function ChangePasswordForm() {
  const queryClient = useQueryClient();

  const change = useMutation({
    mutationFn: async (values: PasswordValues) => {
      const res = await authClient.changePassword({
        currentPassword: values.current,
        newPassword: values.next,
        revokeOtherSessions: values.revokeOthers,
      });
      if (res.error) throw new Error(res.error.message ?? "Failed to change password");
    },
    onSuccess: async (_data, values) => {
      form.setFieldValue("current", "");
      form.setFieldValue("next", "");
      form.setFieldValue("confirm", "");
      if (values.revokeOthers) await queryClient.invalidateQueries({ queryKey: authKeys.sessions });
      toast.success("Password changed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to change password"),
  });

  const form = useForm({
    defaultValues: { current: "", next: "", confirm: "", revokeOthers: false },
    onSubmit: ({ value }) => {
      if (isComplete(value) && !change.isPending) change.mutate(value);
    },
  });

  return (
    <>
      <form
        className="flex flex-col gap-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="current">
          {(field) => (
            <PasswordField
              id="pw-current"
              label="Current password"
              autoComplete="current-password"
              disabled={change.isPending}
              field={field}
            />
          )}
        </form.Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field
            name="next"
            validators={{
              // Only complain once the field has content.
              onChange: ({ value }) =>
                value.length > 0 && value.length < MIN_PASSWORD_LENGTH
                  ? `At least ${MIN_PASSWORD_LENGTH} characters.`
                  : undefined,
            }}
          >
            {(field) => (
              <PasswordField
                id="pw-new"
                label="New password"
                autoComplete="new-password"
                disabled={change.isPending}
                field={field}
              />
            )}
          </form.Field>
          <form.Field
            name="confirm"
            validators={{
              onChangeListenTo: ["next"],
              onChange: ({ value, fieldApi }) =>
                value.length > 0 && value !== fieldApi.form.getFieldValue("next")
                  ? "Passwords don't match."
                  : undefined,
            }}
          >
            {(field) => (
              <PasswordField
                id="pw-confirm"
                label="Confirm new password"
                autoComplete="new-password"
                disabled={change.isPending}
                field={field}
              />
            )}
          </form.Field>
        </div>
        <form.Field name="revokeOthers">
          {(field) => (
            <label className="flex w-fit cursor-pointer items-center gap-2 text-[12.5px] text-muted-foreground">
              <Checkbox
                checked={field.state.value}
                disabled={change.isPending}
                onCheckedChange={(v) => field.handleChange(v === true)}
              />
              Sign out all other devices after the change
            </label>
          )}
        </form.Field>
        {/* Hidden submit so Enter in any field submits the form. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
      <SettingsFooter>
        <form.Subscribe selector={(s) => isComplete(s.values)}>
          {(canSubmit) => (
            <Button
              type="button"
              size="sm"
              disabled={!canSubmit || change.isPending}
              onClick={() => void form.handleSubmit()}
            >
              {change.isPending ? "Changing…" : "Change password"}
            </Button>
          )}
        </form.Subscribe>
      </SettingsFooter>
    </>
  );
}

/** One password input — label, value binding, and inline field errors. */
function PasswordField({
  id,
  label,
  autoComplete,
  disabled,
  field,
}: {
  id: string;
  label: string;
  autoComplete: string;
  disabled: boolean;
  field: AnyFieldApi;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[12px] text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        value={field.state.value}
        disabled={disabled}
        aria-invalid={field.state.meta.errors.length > 0 || undefined}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
      />
      {field.state.meta.errors.map((err) => (
        <p key={String(err)} className="text-[11px] text-destructive">
          {String(err)}
        </p>
      ))}
    </div>
  );
}

/**
 * Change password — better-auth's `changePassword` (email/password is enabled
 * in packages/auth). Shown only when the user actually has a credential
 * account; a social-only sign-in gets an honest hint instead of a form that
 * would 400. Optionally revokes every other session on change.
 */

import { useState } from "react";

import { SquareLockPasswordIcon } from "@hugeicons/core-free-icons";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { SettingsFooter, SettingsSection } from "@/shared/components/settings-section";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Skeleton } from "@/shared/components/ui/skeleton";

import { useAuthInvalidate, useLinkedAccounts } from "./data/use-account";

// better-auth server default (minPasswordLength) — mirrored for instant
// client-side feedback; the server still enforces it.
const MIN_PASSWORD_LENGTH = 8;

export function PasswordCard() {
  const accountsQ = useLinkedAccounts();
  const invalidate = useAuthInvalidate();
  const hasCredential = (accountsQ.data ?? []).some((a) => a.providerId === "credential");

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [revokeOthers, setRevokeOthers] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && next.length >= MIN_PASSWORD_LENGTH && next === confirm;

  const change = useMutation({
    mutationFn: async () => {
      const res = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: revokeOthers,
      });
      if (res.error) throw new Error(res.error.message ?? "Failed to change password");
    },
    onSuccess: async () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      if (revokeOthers) await invalidate.sessions();
      toast.success("Password changed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to change password"),
  });

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
        <>
          <form
            className="flex flex-col gap-4 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit && !change.isPending) change.mutate();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw-current" className="text-[12px] text-muted-foreground">
                Current password
              </Label>
              <Input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                value={current}
                disabled={change.isPending}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pw-new" className="text-[12px] text-muted-foreground">
                  New password
                </Label>
                <Input
                  id="pw-new"
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  disabled={change.isPending}
                  aria-invalid={tooShort || undefined}
                  onChange={(e) => setNext(e.target.value)}
                />
                {tooShort && (
                  <p className="text-[11px] text-destructive">
                    At least {MIN_PASSWORD_LENGTH} characters.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pw-confirm" className="text-[12px] text-muted-foreground">
                  Confirm new password
                </Label>
                <Input
                  id="pw-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  disabled={change.isPending}
                  aria-invalid={mismatch || undefined}
                  onChange={(e) => setConfirm(e.target.value)}
                />
                {mismatch && <p className="text-[11px] text-destructive">Passwords don't match.</p>}
              </div>
            </div>
            <label className="flex w-fit cursor-pointer items-center gap-2 text-[12.5px] text-muted-foreground">
              <Checkbox
                checked={revokeOthers}
                disabled={change.isPending}
                onCheckedChange={(v) => setRevokeOthers(v === true)}
              />
              Sign out all other devices after the change
            </label>
            {/* Hidden submit so Enter in any field submits the form. */}
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
          <SettingsFooter>
            <Button
              type="button"
              size="sm"
              disabled={!canSubmit || change.isPending}
              onClick={() => change.mutate()}
            >
              {change.isPending ? "Changing…" : "Change password"}
            </Button>
          </SettingsFooter>
        </>
      )}
    </SettingsSection>
  );
}

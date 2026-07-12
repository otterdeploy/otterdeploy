/**
 * Two-factor card — shows the live TOTP state from the session and hands the
 * actual enable/verify/backup-codes/disable flow to the existing shell dialog
 * (imported, not duplicated: the multi-step flow is dialog-shaped by design —
 * the secret + backup codes should be a focused modal moment, not inline).
 * 2FA only applies to credential accounts (better-auth twoFactor plugin), so
 * social-only users get an honest hint instead of a dead button.
 */

import { useState } from "react";

import { ShieldKeyIcon } from "@hugeicons/core-free-icons";

import { TwoFactorDialog } from "@/features/shell/components/nav/two-factor-dialog";
import { SettingsSection } from "@/shared/components/settings-section";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";

import { useCurrentSession, useLinkedAccounts } from "./data/use-account";

export function TwoFactorCard() {
  const sessionQ = useCurrentSession();
  const accountsQ = useLinkedAccounts();
  const [dialogOpen, setDialogOpen] = useState(false);

  const enabled = Boolean(
    (sessionQ.data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  );
  const hasCredential = (accountsQ.data ?? []).some((a) => a.providerId === "credential");
  const loading = sessionQ.isPending || accountsQ.isPending;

  return (
    <SettingsSection
      icon={ShieldKeyIcon}
      title="Two-factor authentication"
      description="A time-based code from an authenticator app, required at sign-in."
    >
      {loading ? (
        <div className="flex items-center justify-between gap-3 p-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-8 w-20" />
        </div>
      ) : !hasCredential ? (
        <div className="p-4 text-[12.5px] leading-relaxed text-muted-foreground">
          Two-factor applies to password sign-in. Your account uses a linked provider — manage
          second factors with that provider instead.
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="inline-flex items-center gap-2 text-[13px] font-medium text-foreground">
              Authenticator app
              <Badge variant={enabled ? "secondary" : "outline"}>{enabled ? "On" : "Off"}</Badge>
            </span>
            <span className="max-w-md text-[12px] leading-relaxed text-muted-foreground">
              {enabled
                ? "Your account asks for a 6-digit code at sign-in. Backup codes were issued when you enabled it."
                : "Add an authenticator app to require a 6-digit code alongside your password."}
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            variant={enabled ? "outline" : "default"}
            className="shrink-0"
            onClick={() => setDialogOpen(true)}
          >
            {enabled ? "Manage" : "Enable"}
          </Button>
        </div>
      )}
      <TwoFactorDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </SettingsSection>
  );
}

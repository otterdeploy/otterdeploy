/**
 * Two-factor authentication (TOTP) — enable/disable from the account menu.
 * Backed entirely by better-auth's `twoFactor` plugin client
 * (`twoFactor.enable` / `verifyTotp` / `generateBackupCodes` / `disable`); the
 * secret + backup codes are encrypted at rest server-side. No QR lib is bundled,
 * so setup shows the manual key + otpauth URI (every authenticator accepts the
 * key; many also accept pasting the URI).
 */
import { useState } from "react";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Badge } from "@/shared/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

import {
  resolveStep,
  TwoFactorFooter,
  TwoFactorPanel,
  type TwoFactorStep,
} from "./two-factor-panels";

const STEP_DESCRIPTION: Record<TwoFactorStep, string> = {
  loading: "Protect your account with a time-based code from an authenticator app.",
  idle: "Protect your account with a time-based code from an authenticator app.",
  setup: "Add the key to your authenticator app, then enter the 6-digit code to confirm.",
  backup: "Save these backup codes somewhere safe — each works once if you lose your device.",
  enabled: "Your account is protected by an authenticator app.",
};

export function TwoFactorDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();

  const sessionQ = useQuery({
    queryKey: ["auth", "current-session"],
    queryFn: async () => (await authClient.getSession()).data,
    enabled: open,
  });
  const enabled = Boolean(
    (sessionQ.data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  );

  // Multi-step enable flow — the password/code entries live in the form; the
  // server-issued secret + backup codes are flow state.
  const form = useForm({ defaultValues: { password: "", code: "" } });
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const reset = () => {
    form.reset();
    setTotpURI(null);
    setBackupCodes(null);
  };
  const close = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };
  const refreshSession = () => qc.invalidateQueries({ queryKey: ["auth", "current-session"] });

  const enable = useMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.enable({ password: form.getFieldValue("password") });
      if (res.error) throw new Error(res.error.message ?? "Couldn't start 2FA");
      return res.data;
    },
    onSuccess: (data) => {
      setTotpURI(data?.totpURI ?? "");
      setBackupCodes((data?.backupCodes as string[] | undefined) ?? null);
      // The server just attached a 2FA secret to the user record — refetch the
      // session in the background so its user object can't go stale mid-flow.
      void refreshSession();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Confirms the secret + flips twoFactorEnabled true.
  const verify = useMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.verifyTotp({
        code: form.getFieldValue("code").trim(),
      });
      if (res.error) throw new Error(res.error.message ?? "Invalid code");
    },
    onSuccess: async () => {
      await refreshSession();
      toast.success("Two-factor authentication enabled");
      // Keep the dialog open on the backup-codes panel until the user closes it.
      setTotpURI(null);
      form.setFieldValue("code", "");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Invalid code"),
  });

  const disable = useMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.disable({ password: form.getFieldValue("password") });
      if (res.error) throw new Error(res.error.message ?? "Couldn't disable");
    },
    onSuccess: async () => {
      await refreshSession();
      toast.success("Two-factor authentication disabled");
      close(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Panel selection: backup-codes (post-verify or fresh enable) → setup (have a
  // URI to confirm) → enabled (disable) → idle (password to enable).
  const showBackup = backupCodes !== null && totpURI === null;
  const showSetup = totpURI !== null;
  const step = resolveStep({ loading: sessionQ.isPending, showBackup, showSetup, enabled });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Two-factor authentication
            {step === "enabled" && <Badge variant="secondary">On</Badge>}
          </DialogTitle>
          <DialogDescription>{STEP_DESCRIPTION[step]}</DialogDescription>
        </DialogHeader>

        <form.Field name="password">
          {(passwordField) => (
            <form.Field name="code">
              {(codeField) => (
                <TwoFactorPanel
                  step={step}
                  backupCodes={backupCodes}
                  totpURI={totpURI}
                  code={codeField.state.value}
                  onCodeChange={codeField.handleChange}
                  password={passwordField.state.value}
                  onPasswordChange={passwordField.handleChange}
                  onVerify={() => verify.mutate()}
                  onDisable={() => disable.mutate()}
                  onEnable={() => enable.mutate()}
                />
              )}
            </form.Field>
          )}
        </form.Field>

        <DialogFooter>
          <form.Subscribe selector={(s) => s.values}>
            {({ password, code }) => (
              <TwoFactorFooter
                step={step}
                code={code}
                password={password}
                verifyPending={verify.isPending}
                disablePending={disable.isPending}
                enablePending={enable.isPending}
                onClose={() => close(false)}
                onVerify={() => verify.mutate()}
                onDisable={() => disable.mutate()}
                onEnable={() => enable.mutate()}
              />
            )}
          </form.Subscribe>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

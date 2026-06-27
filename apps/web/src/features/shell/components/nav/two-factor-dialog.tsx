import { useState } from "react";

/**
 * Two-factor authentication (TOTP) — enable/disable from the account menu.
 * Backed entirely by better-auth's `twoFactor` plugin client
 * (`twoFactor.enable` / `verifyTotp` / `generateBackupCodes` / `disable`); the
 * secret + backup codes are encrypted at rest server-side. No QR lib is bundled,
 * so setup shows the manual key + otpauth URI (every authenticator accepts the
 * key; many also accept pasting the URI).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";

/** Pull the base32 secret out of an `otpauth://totp/...?secret=...` URI. */
function secretFromUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

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

  // Multi-step enable flow.
  const [password, setPassword] = useState("");
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");

  const reset = () => {
    setPassword("");
    setTotpURI(null);
    setBackupCodes(null);
    setCode("");
  };
  const close = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };
  const refreshSession = () => qc.invalidateQueries({ queryKey: ["auth", "current-session"] });

  const enable = useMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.enable({ password });
      if (res.error) throw new Error(res.error.message ?? "Couldn't start 2FA");
      return res.data;
    },
    onSuccess: (data) => {
      setTotpURI(data?.totpURI ?? "");
      setBackupCodes((data?.backupCodes as string[] | undefined) ?? null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Confirms the secret + flips twoFactorEnabled true.
  const verify = useMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.verifyTotp({ code: code.trim() });
      if (res.error) throw new Error(res.error.message ?? "Invalid code");
    },
    onSuccess: async () => {
      await refreshSession();
      toast.success("Two-factor authentication enabled");
      // Keep the dialog open on the backup-codes panel until the user closes it.
      setTotpURI(null);
      setCode("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Invalid code"),
  });

  const disable = useMutation({
    mutationFn: async () => {
      const res = await authClient.twoFactor.disable({ password });
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

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Two-factor authentication
            {enabled && !showSetup && !showBackup && <Badge variant="secondary">On</Badge>}
          </DialogTitle>
          <DialogDescription>
            {showSetup
              ? "Add the key to your authenticator app, then enter the 6-digit code to confirm."
              : showBackup
                ? "Save these backup codes somewhere safe — each works once if you lose your device."
                : enabled
                  ? "Your account is protected by an authenticator app."
                  : "Protect your account with a time-based code from an authenticator app."}
          </DialogDescription>
        </DialogHeader>

        {sessionQ.isPending ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner /> Loading…
          </div>
        ) : showBackup ? (
          <ul className="grid grid-cols-2 gap-1.5 rounded-lg bg-muted p-3 font-mono text-[12.5px]">
            {backupCodes?.map((c) => (
              <li key={c} className="tracking-[0.1em]">
                {c}
              </li>
            ))}
          </ul>
        ) : showSetup ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase">
                Setup key
              </Label>
              <code className="block rounded-md bg-muted px-3 py-2 font-mono text-[12.5px] tracking-[0.15em] break-all">
                {secretFromUri(totpURI ?? "")}
              </code>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim()) verify.mutate();
              }}
              className="space-y-2"
            >
              <Label
                htmlFor="tf-verify"
                className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase"
              >
                Confirmation code
              </Label>
              <Input
                id="tf-verify"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className="h-10 font-mono tracking-[0.2em]"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </form>
          </div>
        ) : enabled ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (password) disable.mutate();
            }}
            className="space-y-2"
          >
            <Label
              htmlFor="tf-pw-disable"
              className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase"
            >
              Confirm your password to disable
            </Label>
            <Input
              id="tf-pw-disable"
              type="password"
              autoComplete="current-password"
              className="h-10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (password) enable.mutate();
            }}
            className="space-y-2"
          >
            <Label
              htmlFor="tf-pw-enable"
              className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase"
            >
              Confirm your password to begin
            </Label>
            <Input
              id="tf-pw-enable"
              type="password"
              autoComplete="current-password"
              className="h-10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </form>
        )}

        <DialogFooter>
          {showBackup ? (
            <Button type="button" onClick={() => close(false)}>
              I've saved my codes
            </Button>
          ) : showSetup ? (
            <Button
              type="button"
              disabled={!code.trim() || verify.isPending}
              onClick={() => verify.mutate()}
            >
              {verify.isPending ? "Verifying…" : "Confirm"}
            </Button>
          ) : enabled ? (
            <Button
              type="button"
              variant="destructive"
              disabled={!password || disable.isPending}
              onClick={() => disable.mutate()}
            >
              {disable.isPending ? "Disabling…" : "Disable 2FA"}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!password || enable.isPending}
              onClick={() => enable.mutate()}
            >
              {enable.isPending ? "Starting…" : "Enable 2FA"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

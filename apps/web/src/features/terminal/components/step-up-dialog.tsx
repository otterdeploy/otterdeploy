/**
 * od-5j8.9 — step-up prompt before opening a shell. Shown only when a fresh
 * `terminal.mintTicket` call comes back `STEP_UP_REQUIRED` (no live re-auth
 * grant, or it expired). Asks for whichever credential the account actually
 * uses — a TOTP code if 2FA is enabled, the account password otherwise —
 * mirroring the account's own two-factor/password forms
 * (features/account/two-factor-card.tsx, password-card.tsx) rather than
 * inventing new copy/validation for the same check.
 */
import { useState } from "react";

import { ShieldKeyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { useCurrentSession } from "@/features/account/data/use-account";
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

import { stepUpErrorMessage, submitStepUp } from "../data/tickets";

interface Props {
  open: boolean;
  /** Target label shown for context ("this container", "the host shell"). */
  targetLabel: string;
  onVerified: () => void;
  onCancel: () => void;
}

export function StepUpDialog({ open, targetLabel, onVerified, onCancel }: Props) {
  const { t } = useTranslation();
  const sessionQ = useCurrentSession();
  const twoFactorEnabled = Boolean(
    (sessionQ.data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  );

  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!value || pending) return;
    setPending(true);
    setError(null);
    try {
      await submitStepUp(twoFactorEnabled ? { totpCode: value.trim() } : { password: value });
      setValue("");
      onVerified();
    } catch (err) {
      setError(stepUpErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setValue("");
          setError(null);
          onCancel();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={ShieldKeyIcon}
              strokeWidth={2}
              className="size-4 text-muted-foreground"
            />
            <DialogTitle>{t("terminal.confirmIdentity")}</DialogTitle>
          </div>
          <DialogDescription>
            Opening {targetLabel} needs a recent sign-in.{" "}
            {twoFactorEnabled
              ? "Enter the current code from your authenticator app."
              : "Enter your account password."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="terminal-step-up-value" className="sr-only">
              {twoFactorEnabled ? "Authenticator code" : "Password"}
            </Label>
            <Input
              id="terminal-step-up-value"
              type={twoFactorEnabled ? "text" : "password"}
              inputMode={twoFactorEnabled ? "numeric" : undefined}
              autoComplete={twoFactorEnabled ? "one-time-code" : "current-password"}
              placeholder={twoFactorEnabled ? "123456" : "Password"}
              autoFocus
              disabled={pending}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={error != null || undefined}
            />
            {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
          </div>
          {/* Hidden submit so Enter submits the form. */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={!value || pending}
          >
            {pending ? "Verifying…" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

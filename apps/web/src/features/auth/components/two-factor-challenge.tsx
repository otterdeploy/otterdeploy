import { useState } from "react";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

/**
 * Second factor prompt shown after a correct password on a 2FA-enabled account.
 * Verifies a 6-digit authenticator code (or a one-time backup code) — only then
 * is the session granted. `trustDevice` skips the prompt on this device for 30d.
 */
export function TwoFactorChallenge({ onVerified }: { onVerified: () => void }) {
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [useBackup, setUseBackup] = useState(false);

  const verify = useMutation({
    mutationFn: async () => {
      const value = code.trim();
      const result = useBackup
        ? await authClient.twoFactor.verifyBackupCode({ code: value })
        : await authClient.twoFactor.verifyTotp({ code: value, trustDevice });
      if (result.error)
        throw new Error(result.error.message ?? result.error.statusText ?? "Invalid code");
      return result.data;
    },
    onSuccess: onVerified,
    onError: (error) => toast.error(error.message),
  });

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
          Two-factor authentication
        </h2>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          {useBackup
            ? "Enter one of your saved backup codes."
            : "Enter the 6-digit code from your authenticator app."}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) verify.mutate();
        }}
        className="space-y-5"
      >
        <div className="space-y-2">
          <Label
            htmlFor="two-factor-code"
            className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase"
          >
            {useBackup ? "Backup code" : "Authenticator code"}
          </Label>
          <Input
            id="two-factor-code"
            name="two-factor-code"
            inputMode={useBackup ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoFocus
            placeholder={useBackup ? "xxxxxxxxxx" : "123456"}
            className="h-11 rounded-lg bg-muted px-3.5 font-mono tracking-[0.2em]"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>

        {!useBackup && (
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              className="size-3.5"
            />
            Trust this device for 30 days
          </label>
        )}

        <Button
          type="submit"
          className="h-11 w-full rounded-lg bg-foreground font-semibold text-background hover:bg-foreground/90"
          disabled={!code.trim() || verify.isPending}
        >
          {verify.isPending ? (
            <>
              <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="size-4 animate-spin" />
              Verifying…
            </>
          ) : (
            <>Verify</>
          )}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => {
          setUseBackup((v) => !v);
          setCode("");
        }}
        className="mt-6 text-[13px] font-medium text-foreground underline-offset-4 hover:underline"
      >
        {useBackup ? "Use your authenticator app instead" : "Use a backup code instead"}
      </button>
    </div>
  );
}

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";

export type TwoFactorStep = "loading" | "backup" | "setup" | "enabled" | "idle";

/** Resolve the visible panel from the dialog's reactive state. */
export function resolveStep(opts: {
  loading: boolean;
  showBackup: boolean;
  showSetup: boolean;
  enabled: boolean;
}): TwoFactorStep {
  if (opts.loading) return "loading";
  if (opts.showBackup) return "backup";
  if (opts.showSetup) return "setup";
  if (opts.enabled) return "enabled";
  return "idle";
}

/** Pull the base32 secret out of an `otpauth://totp/...?secret=...` URI. */
function secretFromUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

export function TwoFactorPanel({
  step,
  backupCodes,
  totpURI,
  code,
  onCodeChange,
  password,
  onPasswordChange,
  onVerify,
  onDisable,
  onEnable,
}: {
  step: TwoFactorStep;
  backupCodes: string[] | null;
  totpURI: string | null;
  code: string;
  onCodeChange: (v: string) => void;
  password: string;
  onPasswordChange: (v: string) => void;
  onVerify: () => void;
  onDisable: () => void;
  onEnable: () => void;
}) {
  if (step === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Spinner /> Loading…
      </div>
    );
  }

  if (step === "backup") {
    return (
      <ul className="grid grid-cols-2 gap-1.5 rounded-lg bg-muted p-3 font-mono text-[12.5px]">
        {backupCodes?.map((c) => (
          <li key={c} className="tracking-[0.1em]">
            {c}
          </li>
        ))}
      </ul>
    );
  }

  if (step === "setup") {
    return (
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
            if (code.trim()) onVerify();
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
            onChange={(e) => onCodeChange(e.target.value)}
          />
        </form>
      </div>
    );
  }

  const isEnabled = step === "enabled";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (password) (isEnabled ? onDisable : onEnable)();
      }}
      className="space-y-2"
    >
      <Label
        htmlFor={isEnabled ? "tf-pw-disable" : "tf-pw-enable"}
        className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase"
      >
        {isEnabled ? "Confirm your password to disable" : "Confirm your password to begin"}
      </Label>
      <Input
        id={isEnabled ? "tf-pw-disable" : "tf-pw-enable"}
        type="password"
        autoComplete="current-password"
        className="h-10"
        value={password}
        onChange={(e) => onPasswordChange(e.target.value)}
      />
    </form>
  );
}

export function TwoFactorFooter({
  step,
  code,
  password,
  verifyPending,
  disablePending,
  enablePending,
  onClose,
  onVerify,
  onDisable,
  onEnable,
}: {
  step: TwoFactorStep;
  code: string;
  password: string;
  verifyPending: boolean;
  disablePending: boolean;
  enablePending: boolean;
  onClose: () => void;
  onVerify: () => void;
  onDisable: () => void;
  onEnable: () => void;
}) {
  if (step === "backup") {
    return (
      <Button type="button" onClick={onClose}>
        I've saved my codes
      </Button>
    );
  }
  if (step === "setup") {
    return (
      <Button type="button" disabled={!code.trim() || verifyPending} onClick={onVerify}>
        {verifyPending ? "Verifying…" : "Confirm"}
      </Button>
    );
  }
  if (step === "enabled") {
    return (
      <Button
        type="button"
        variant="destructive"
        disabled={!password || disablePending}
        onClick={onDisable}
      >
        {disablePending ? "Disabling…" : "Disable 2FA"}
      </Button>
    );
  }
  return (
    <Button type="button" disabled={!password || enablePending} onClick={onEnable}>
      {enablePending ? "Starting…" : "Enable 2FA"}
    </Button>
  );
}

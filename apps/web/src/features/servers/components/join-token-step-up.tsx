/**
 * The re-authentication step in front of node enrollment.
 *
 * Asks for whichever credential the account actually has: an authenticator
 * code when 2FA is enrolled, the account password otherwise — the same choice
 * the server makes in `verifyStepUpCredential`, and the same one terminal
 * step-up presents. It previously asked everyone for a TOTP code, so an
 * operator who had never set up an authenticator saw a field they could not
 * fill and an enrollment they could not complete.
 *
 * Split from ./join-token-panel to keep that file under the line cap; this
 * owns the credential inputs and the manager confirmation, nothing else.
 */

import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

import type { JoinRole } from "./join-token-panel";

/**
 * The exact string an operator must type to confirm a manager enrollment.
 * Exported so the panel's submit gate and this form's hint can never drift
 * apart — previously the requirement lived only in a placeholder, which
 * disappears on the first keystroke and left a dead button unexplained.
 */
export const MANAGER_CONFIRMATION = "ENROLL MANAGER";

/**
 * What still blocks submission, or null when the form is ready to send.
 *
 * Returns the reason rather than a bare boolean: the same value both disables
 * the buttons and is displayed beside them, so a dead control can never fail to
 * say what it is waiting for.
 */
export function submitBlocker(input: {
  sessionPending: boolean;
  twoFactorEnabled: boolean;
  credentialReady: boolean;
  role: JoinRole;
  managerConfirmation: string;
}): string | null {
  if (input.sessionPending) return "Checking which credential this account uses…";
  if (!input.credentialReady) {
    return input.twoFactorEnabled
      ? "Enter the 6-digit code from your authenticator app."
      : "Enter your account password.";
  }
  if (input.role === "manager" && input.managerConfirmation !== MANAGER_CONFIRMATION) {
    return `Type ${MANAGER_CONFIRMATION} exactly to confirm manager authority.`;
  }
  return null;
}

export interface StepUpFormProps {
  role: JoinRole;
  /** Whether the signed-in account has an authenticator app enrolled. Decides
   *  which credential this form asks for — the server accepts whichever one
   *  the account actually has (verifyStepUpCredential). */
  twoFactorEnabled: boolean;
  totpCode: string;
  managerConfirmation: string;
  /** Why the submit buttons are unusable, or null when they are usable. Rendered
   *  beside them so a disabled control always states what it is waiting for. */
  blockedReason: string | null;
  creating: boolean;
  rotating: boolean;
  password: string;
  onTotpCodeChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onManagerConfirmationChange: (value: string) => void;
  onCreate: () => void;
  onRotate: () => void;
}

export function StepUpForm(props: StepUpFormProps) {
  const { t } = useTranslation();
  const canSubmit = props.blockedReason === null;
  const reasonId = "node-enrollment-blocked-reason";
  return (
    <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
      {props.twoFactorEnabled ? (
        <label htmlFor="node-enrollment-totp" className="grid gap-1.5">
          <span className="text-xs font-medium">{t("servers.stepUp.authenticatorCode")}</span>
          <Input
            id="node-enrollment-totp"
            value={props.totpCode}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            placeholder="000000"
            className="max-w-40 font-mono"
            onChange={(event) => props.onTotpCodeChange(event.target.value.replace(/\D/g, ""))}
          />
        </label>
      ) : (
        <label htmlFor="node-enrollment-password" className="grid gap-1.5">
          <span className="text-xs font-medium">{t("common.password")}</span>
          <Input
            id="node-enrollment-password"
            type="password"
            value={props.password}
            autoComplete="current-password"
            placeholder={t("servers.stepUp.passwordPlaceholder")}
            className="max-w-72"
            onChange={(event) => props.onPasswordChange(event.target.value)}
          />
        </label>
      )}
      {props.role === "manager" ? (
        <label htmlFor="node-enrollment-manager-confirmation" className="grid gap-1.5">
          <span className="text-xs font-medium">{t("servers.stepUp.confirmTitle")}</span>
          <Input
            id="node-enrollment-manager-confirmation"
            value={props.managerConfirmation}
            placeholder={t("servers.stepUp.confirmPhrase")}
            className="font-mono"
            onChange={(event) => props.onManagerConfirmationChange(event.target.value)}
          />
          <span className="text-[11px] text-muted-foreground">
            Type <code className="font-mono text-foreground">{MANAGER_CONFIRMATION}</code> exactly.
            Managers participate in cluster quorum and can control every workload.
          </span>
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!canSubmit || props.creating}
          aria-describedby={canSubmit ? undefined : reasonId}
          onClick={props.onCreate}
        >
          {props.creating ? "Creating…" : "Create 10-minute enrollment"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canSubmit || props.rotating}
          aria-describedby={canSubmit ? undefined : reasonId}
          onClick={props.onRotate}
        >
          {props.rotating ? "Rotating…" : `Rotate ${props.role} credential`}
        </Button>
      </div>
      {props.blockedReason ? (
        <p id={reasonId} role="status" className="text-[11px] text-muted-foreground">
          {props.blockedReason}
        </p>
      ) : null}
    </div>
  );
}

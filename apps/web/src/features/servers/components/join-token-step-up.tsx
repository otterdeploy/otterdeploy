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

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

import type { JoinRole } from "./join-token-panel";

export interface StepUpFormProps {
  role: JoinRole;
  /** Whether the signed-in account has an authenticator app enrolled. Decides
   *  which credential this form asks for — the server accepts whichever one
   *  the account actually has (verifyStepUpCredential). */
  twoFactorEnabled: boolean;
  totpCode: string;
  managerConfirmation: string;
  canSubmit: boolean;
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
  return (
    <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
      {props.twoFactorEnabled ? (
        <label htmlFor="node-enrollment-totp" className="grid gap-1.5">
          <span className="text-xs font-medium">Authenticator code</span>
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
          <span className="text-xs font-medium">Password</span>
          <Input
            id="node-enrollment-password"
            type="password"
            value={props.password}
            autoComplete="current-password"
            placeholder="Your account password"
            className="max-w-72"
            onChange={(event) => props.onPasswordChange(event.target.value)}
          />
        </label>
      )}
      {props.role === "manager" ? (
        <label htmlFor="node-enrollment-manager-confirmation" className="grid gap-1.5">
          <span className="text-xs font-medium">Confirm manager authority</span>
          <Input
            id="node-enrollment-manager-confirmation"
            value={props.managerConfirmation}
            placeholder="ENROLL MANAGER"
            className="font-mono"
            onChange={(event) => props.onManagerConfirmationChange(event.target.value)}
          />
          <span className="text-[11px] text-muted-foreground">
            Managers participate in cluster quorum and can control every workload.
          </span>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!props.canSubmit || props.creating} onClick={props.onCreate}>
          {props.creating ? "Creating…" : "Create 10-minute enrollment"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!props.canSubmit || props.rotating}
          onClick={props.onRotate}
        >
          {props.rotating ? "Rotating…" : `Rotate ${props.role} credential`}
        </Button>
      </div>
    </div>
  );
}

/**
 * Submit row for the Add-server dialog, plus the reason it is unusable.
 *
 * Split from ./server-provision-form to keep that file under the line cap; this
 * owns the blocked-reason notice and the Cancel/Provision buttons, nothing else.
 */

import type { SshKey } from "@/features/ssh-keys/data/ssh-keys";

import { Button } from "@/shared/components/ui/button";
import { DialogFooter } from "@/shared/components/ui/dialog";

import type { ProvisionFormApi } from "./server-provision-form";

/** Ties the disabled submit button to the notice explaining why. */
const PROVISION_BLOCKED_ID = "provision-blocked-reason";

export function ProvisionFooter({
  form,
  usableKeys,
  onCancel,
}: {
  form: ProvisionFormApi;
  usableKeys: SshKey[];
  onCancel: () => void;
}) {
  return (
    <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting, s.values.authMode] as const}>
      {([canSubmit, isSubmitting, authMode]) => {
        // With no usable key the sshKeyId validator can never be satisfied, yet
        // canSubmit starts true (it only validates onChange, and the field is
        // never changed). Submit then failed validation with nothing rendered to
        // explain it (that branch shows a hint, not a FieldError) so the click
        // did nothing at all. Block it out loud instead.
        const blockedReason =
          authMode === "key" && usableKeys.length === 0
            ? // Says why the button is dead and nothing else: the panel above
              // already explains how to add a key, and the button beside it
              // already offers the password path. Repeating both here is what
              // made this dialog read as four notices about one missing key.
              "Provisioning needs a credential. Choose one above."
            : null;
        return (
          <>
            {blockedReason ? (
              <p
                id={PROVISION_BLOCKED_ID}
                role="status"
                className="mt-4 rounded-md bg-muted/40 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground ring-1 ring-foreground/10"
              >
                {blockedReason}
              </p>
            ) : null}
            <DialogFooter className="mt-5 flex-row items-center sm:justify-end">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  type="button"
                  onClick={onCancel}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-8"
                  type="submit"
                  disabled={!canSubmit || isSubmitting || blockedReason !== null}
                  aria-describedby={blockedReason ? PROVISION_BLOCKED_ID : undefined}
                >
                  {isSubmitting ? "Starting…" : "Provision server"}
                </Button>
              </div>
            </DialogFooter>
          </>
        );
      }}
    </form.Subscribe>
  );
}

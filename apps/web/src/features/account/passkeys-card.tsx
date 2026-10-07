/**
 * Passkeys: inline list of the account's registered WebAuthn credentials
 * (better-auth `@better-auth/passkey` plugin), with per-row delete and an
 * add-passkey footer. The WebAuthn ceremony runs entirely in the browser; the
 * server stores only the credential's public key.
 *
 * The card renders a short explainer instead of the add button when the
 * browser has no `PublicKeyCredential` (plain-HTTP installs. WebAuthn needs a
 * secure context), so existing passkeys are still listed and deletable from an
 * insecure origin even though new ones can't be added there.
 */

import { useState } from "react";

import { FingerPrintIcon } from "@hugeicons/core-free-icons";
import { formatRelative } from "@otterdeploy/shared/format";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { SettingsFooter, SettingsSection } from "@/shared/components/settings-section";
import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Skeleton } from "@/shared/components/ui/skeleton";

import { authKeys, usePasskeys } from "./data/use-account";

const webAuthnAvailable = typeof window !== "undefined" && "PublicKeyCredential" in window;

/** What to tell the operator when adding a passkey did not work. `null` means
 *  say nothing: they closed the prompt on purpose. */
export function passkeyAddFailure(
  error: { code?: string; message?: string } | null | undefined,
  host: string,
): string | null {
  const code = error?.code;
  if (code === "ERROR_CEREMONY_ABORTED" || code === "REGISTRATION_CANCELLED") return null;
  if (code === "ERROR_INVALID_RP_ID" || code === "ERROR_INVALID_DOMAIN") {
    return `This browser refused to create a passkey for ${host}. Passkeys work on the address you sign in at over HTTPS (or localhost); open the dashboard there and try again.`;
  }
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return "This device already holds a passkey for this account.";
  }
  if (code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY") {
    // NotAllowedError: the prompt was dismissed, timed out, or the browser
    // declined. Not a silent no-op either way.
    return "No passkey was added: the browser prompt was closed or timed out.";
  }
  return error?.message ? `Couldn't add a passkey: ${error.message}` : "Couldn't add a passkey.";
}

/** Human label for a row: the user-chosen name, else a generic fallback.
 *  (The AAGUID→authenticator-name map lives in the server-side plugin module;
 *  importing it here would drag @simplewebauthn/server into the bundle.) */
function passkeyLabel(name: string | null | undefined): string {
  return name?.trim() ? name : "Passkey";
}

export function PasskeysCard() {
  const queryClient = useQueryClient();
  const passkeysQ = usePasskeys();
  const passkeys = passkeysQ.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: authKeys.passkeys });

  // The last attempt's failure, shown under the button until the next try.
  // A security action that does nothing visible is the bug this replaces
  //: the browser's refusal used to vanish.
  const [addFailure, setAddFailure] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: async () => {
      const res = await authClient.passkey.addPasskey();
      if (!res?.error) return { failure: null, added: true };
      const code = "code" in res.error ? res.error.code : undefined;
      return {
        failure: passkeyAddFailure({ code, message: res.error.message }, window.location.hostname),
        added: false,
      };
    },
    onMutate: () => setAddFailure(null),
    onSuccess: async (r) => {
      if (r.added) {
        await invalidate();
        toast.success("Passkey added");
        return;
      }
      setAddFailure(r.failure);
      if (r.failure) toast.error(r.failure);
    },
    onError: (e) => {
      const failure = passkeyAddFailure({ message: e.message }, window.location.hostname);
      setAddFailure(failure);
      if (failure) toast.error(failure);
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await authClient.passkey.deletePasskey({ id });
      if (res.error) throw new Error(res.error.message ?? "Failed to remove passkey");
    },
    onSuccess: async () => {
      await invalidate();
      toast.success("Passkey removed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to remove passkey"),
  });

  return (
    <SettingsSection
      icon={FingerPrintIcon}
      title="Passkeys"
      description="Sign in with your device's biometrics, a security key, or a password manager instead of a password."
    >
      {passkeysQ.isPending ? (
        <div className="flex flex-col divide-y divide-border/60">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-44" />
              </div>
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      ) : passkeysQ.isError ? (
        <div className="p-4">
          <ErrorState
            message={passkeysQ.error instanceof Error ? passkeysQ.error.message : undefined}
            onRetry={() => void passkeysQ.refetch()}
          />
        </div>
      ) : (
        <>
          {passkeys.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-muted-foreground">
              No passkeys yet. Add one to sign in without a password.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border/60">
              {passkeys.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">
                        {passkeyLabel(p.name)}
                      </span>
                      {p.backedUp && <Badge variant="secondary">Synced</Badge>}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {p.deviceType === "multiDevice" ? "multi-device" : "single-device"}
                      {p.createdAt ? <> · added {formatRelative(p.createdAt)}</> : null}
                    </div>
                  </div>
                  {/* Access loss: that device can no longer sign in. A styled
                      confirm, as for every other credential. */}
                  <TypedConfirmDialog
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        disabled={remove.isPending}
                      >
                        Remove
                      </Button>
                    }
                    title={`Remove ${passkeyLabel(p.name)}?`}
                    description="That device or password manager can no longer sign in to this account. Add it again from this page."
                    confirmLabel="Remove passkey"
                    pendingLabel="Removing…"
                    pending={remove.isPending}
                    onConfirm={() => remove.mutate(p.id)}
                  />
                </li>
              ))}
            </ul>
          )}
          <SettingsFooter>
            {webAuthnAvailable ? (
              <div className="flex flex-col items-start gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={add.isPending}
                  onClick={() => add.mutate()}
                >
                  {add.isPending ? "Waiting for your device…" : "Add passkey"}
                </Button>
                {addFailure ? (
                  <p role="alert" className="text-[12px] text-destructive">
                    {addFailure}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Passkeys need a secure (HTTPS) origin: this browser can't register one here.
              </p>
            )}
          </SettingsFooter>
        </>
      )}
    </SettingsSection>
  );
}

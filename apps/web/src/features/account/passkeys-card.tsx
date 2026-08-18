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

import { FingerPrintIcon } from "@hugeicons/core-free-icons";
import { formatRelative } from "@otterdeploy/shared/format";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { SettingsFooter, SettingsSection } from "@/shared/components/settings-section";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Skeleton } from "@/shared/components/ui/skeleton";

import { authKeys, usePasskeys } from "./data/use-account";

const webAuthnAvailable = typeof window !== "undefined" && "PublicKeyCredential" in window;

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

  const add = useMutation({
    mutationFn: async () => {
      const res = await authClient.passkey.addPasskey();
      // A closed browser prompt resolves with a cancellation error: stay
      // silent for that one; the user changed their mind, nothing failed.
      if (res?.error) {
        const code = "code" in res.error ? res.error.code : undefined;
        if (code === "REGISTRATION_CANCELLED") return { cancelled: true };
        throw new Error(res.error.message ?? "Failed to add passkey");
      }
      return { cancelled: false };
    },
    onSuccess: async (r) => {
      if (r.cancelled) return;
      await invalidate();
      toast.success("Passkey added");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to add passkey"),
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(p.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <SettingsFooter>
            {webAuthnAvailable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={add.isPending}
                onClick={() => add.mutate()}
              >
                {add.isPending ? "Waiting for your device…" : "Add passkey"}
              </Button>
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

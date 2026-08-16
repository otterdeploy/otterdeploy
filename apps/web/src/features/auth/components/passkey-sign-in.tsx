import { useState } from "react";

import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/shared/components/ui/button";

/**
 * "Sign in with a passkey" button under the email form. Runs the WebAuthn
 * ceremony via better-auth's passkey client plugin; on success a full session
 * exists (passkeys are a first factor and satisfy user verification, so no 2FA
 * challenge follows) and the caller's `onSignedIn` finishes the login exactly
 * like a password sign-in would.
 *
 * Rendered only when the browser exposes `PublicKeyCredential` — WebAuthn
 * requires a secure context, and a plain-HTTP self-hosted dashboard (which this
 * app explicitly supports, see packages/auth cookie handling) doesn't have one.
 * Hiding the button beats showing one that always errors.
 *
 * A cancelled ceremony (user closed the browser prompt) is silent by design:
 * the browser already communicated the cancellation, and a toast on top of it
 * would scold the user for changing their mind.
 */
export function PasskeySignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [pending, setPending] = useState(false);

  if (typeof window === "undefined" || !("PublicKeyCredential" in window)) return null;

  const start = async () => {
    setPending(true);
    try {
      const result = await authClient.signIn.passkey();
      if (result?.error) {
        const code = "code" in result.error ? result.error.code : undefined;
        if (code !== "AUTH_CANCELLED") {
          toast.error(result.error.message ?? "Passkey sign-in failed");
        }
        return;
      }
      onSignedIn();
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className="mt-3 h-11 w-full rounded-lg"
      disabled={pending}
      onClick={() => void start()}
    >
      {pending ? "Waiting for your passkey…" : "Sign in with a passkey"}
    </Button>
  );
}

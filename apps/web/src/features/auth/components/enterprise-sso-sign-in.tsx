/**
 * "Continue with <IdP>": the enterprise-identity-provider entry point on the
 * sign-in page.
 *
 * One button per identity provider the installation has registered, discovered
 * at runtime from /api/auth/public-config. Clicking one redirects straight to
 * that IdP and the user comes back signed in.
 *
 * This used to ask for a work email first, so the server could match its domain
 * to a provider. That was the wrong shape. Every other federated method here is
 * a single click, and a second email field under the password form made SSO
 * look like another password prompt rather than a way past one. The domain
 * lookup still exists on the server; the sign-in page just doesn't need to
 * interview the visitor to reach it, because the provider handle is public
 * (it is already in the IdP's redirect URI).
 *
 * Distinct from `SocialSignIn` next to it: that renders the INSTALL-wide social
 * providers (GitHub, Google, GitLab) configured in Instance settings. These are
 * per-workspace OIDC providers registered in Workspace → SSO.
 *
 * Renders nothing when the operator has switched enterprise SSO off, or when no
 * provider is registered.
 */

import { useState } from "react";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/shared/components/ui/button";

import type { PublicSsoProvider } from "../data/registration-mode";

export function EnterpriseSsoSignIn({ providers }: { providers: PublicSsoProvider[] }) {
  const { t } = useTranslation();
  // The id of the provider currently redirecting, so only the clicked button
  // shows a pending state. A boolean would grey out all of them.
  const [starting, setStarting] = useState<string | null>(null);

  if (providers.length === 0) return null;

  const start = async (providerId: string) => {
    setStarting(providerId);
    const result = await authClient.signIn.sso({
      providerId,
      callbackURL: `${window.location.origin}/`,
      // Where the IdP sends someone whose provider resolves but whose sign-in
      // it then rejects. Without it they land on a blank page with no way back
      // to the form.
      errorCallbackURL: `${window.location.origin}/sign-in`,
    });
    // Only reached when the redirect did NOT happen; on success the browser has
    // already left the page.
    if (result.error) {
      setStarting(null);
      toast.error(result.error.message ?? result.error.statusText ?? t("auth.sso.startFailed"));
    }
  };

  return (
    <div className="mt-3 space-y-3">
      {providers.map((provider) => (
        <Button
          key={provider.providerId}
          type="button"
          variant="outline"
          className="h-11 w-full rounded-lg"
          disabled={starting !== null}
          onClick={() => void start(provider.providerId)}
        >
          {starting === provider.providerId
            ? t("auth.sso.redirectingTo", { provider: provider.label })
            : t("auth.sso.continueWith", { provider: provider.label })}
        </Button>
      ))}
    </div>
  );
}

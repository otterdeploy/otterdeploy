import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/shared/components/ui/button";

/**
 * Social (SSO) sign-in buttons, one per provider the server reports as live on
 * the current auth instance (`/api/auth/public-config`, fetched by the sign-in
 * route). Renders nothing when none are enabled, so the email form stands alone
 * on a vanilla install. All flows go through better-auth's `signIn.social`, no
 * hand-rolled OAuth.
 *
 * The list arrives as a prop rather than being read from env: it used to come
 * from the build-time VITE_AUTH_SOCIAL_PROVIDERS, which made SSO impossible to
 * enable on a prebuilt self-hosted image without rebuilding the SPA.
 */
const PROVIDER_LABELS = {
  github: "GitHub",
  google: "Google",
  gitlab: "GitLab",
} as const;

type ProviderId = keyof typeof PROVIDER_LABELS;

/** Ignore anything the server names that this build has no label for, so a
 *  newer server can add a provider without breaking an older SPA. */
function knownProviders(ids: string[]): ProviderId[] {
  return ids.filter((id): id is ProviderId => id in PROVIDER_LABELS);
}

const start = (provider: ProviderId) => {
  void authClient.signIn
    .social({ provider, callbackURL: `${window.location.origin}/` })
    .catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Couldn't start sign-in"),
    );
};

/**
 * The hairline "or continue with" rule between the password form and the
 * federated methods below it.
 *
 * Exported because the sign-in page has THREE federated blocks (social,
 * passkey, enterprise SSO) and they need one shared rule, not one each. It
 * lives here rather than in a shared/ui module because it is this page's
 * typography, not a general-purpose separator.
 */
export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="mt-6 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function SocialSignIn({
  dividerLabel,
  providers: providerIds,
}: {
  /** Null when the caller has already drawn a rule above this block, which the
   *  sign-in page does: it shares one across all its federated methods. */
  dividerLabel: string | null;
  providers: string[];
}) {
  const providers = knownProviders(providerIds);
  if (providers.length === 0) return null;

  return (
    <div className="mt-3 space-y-3">
      {dividerLabel === null ? null : <AuthDivider label={dividerLabel} />}
      {providers.map((provider) => (
        <Button
          key={provider}
          type="button"
          variant="outline"
          className="h-11 w-full rounded-lg"
          onClick={() => start(provider)}
        >
          Continue with {PROVIDER_LABELS[provider]}
        </Button>
      ))}
    </div>
  );
}

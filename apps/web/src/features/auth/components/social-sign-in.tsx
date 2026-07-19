import { env } from "@otterdeploy/env/web";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/shared/components/ui/button";

/**
 * Social (SSO) sign-in buttons, one per provider the operator enabled via
 * VITE_AUTH_SOCIAL_PROVIDERS (which mirrors the server's configured
 * socialProviders). Renders nothing when none are enabled, so the email form
 * stands alone on a vanilla install. All flows go through better-auth's
 * `signIn.social` — no hand-rolled OAuth.
 */
const PROVIDER_LABELS = {
  github: "GitHub",
  google: "Google",
  gitlab: "GitLab",
} as const;

type ProviderId = keyof typeof PROVIDER_LABELS;

function enabledProviders(): ProviderId[] {
  return (env.VITE_AUTH_SOCIAL_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is ProviderId => s in PROVIDER_LABELS);
}

const start = (provider: ProviderId) => {
  void authClient.signIn
    .social({ provider, callbackURL: `${window.location.origin}/` })
    .catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Couldn't start sign-in"),
    );
};

export function SocialSignIn({ dividerLabel }: { dividerLabel: string }) {
  const providers = enabledProviders();
  if (providers.length === 0) return null;

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
          {dividerLabel}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
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

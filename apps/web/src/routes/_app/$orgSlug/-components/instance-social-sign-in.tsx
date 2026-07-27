/**
 * Social sign-in card — GitHub / Google / GitLab OAuth credentials for the
 * sign-in page. Saving hot-reloads the auth instance, so a provider goes live
 * on the next request with no restart and no SPA rebuild.
 *
 * The `Live` pill reports what the server has actually registered, not what's
 * stored: a provider whose secret won't decrypt, or one saved while the reload
 * failed, reads as not live rather than silently claiming to work.
 *
 * Distinct from Settings → Git providers, which configures a GitHub *App* for
 * cloning repositories. These credentials only authenticate people.
 */

import { useState } from "react";

import type { OrganizationId } from "@otterdeploy/shared/id";
import { Login03Icon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsRow, SettingsSection } from "@/shared/components/settings-section";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

import { ProviderFields, type SocialProviderId as ProviderId } from "./instance-social-provider-fields";

const PROVIDERS: { id: ProviderId; label: string; callbackPath: string }[] = [
  { id: "github", label: "GitHub", callbackPath: "/api/auth/callback/github" },
  { id: "google", label: "Google", callbackPath: "/api/auth/callback/google" },
  { id: "gitlab", label: "GitLab", callbackPath: "/api/auth/callback/gitlab" },
];

export function SocialSignInCard({ organizationId }: { organizationId: OrganizationId }) {
  const query = useQuery(
    orpc.organization.listSocialProviders.queryOptions({ input: { organizationId } }),
  );

  return (
    <SettingsSection
      icon={Login03Icon}
      title="Social sign-in"
      description="OAuth providers offered on the sign-in page. Changes apply immediately — no restart. Register the callback URL shown under each provider with the OAuth app."
    >
      {PROVIDERS.map((provider) => (
        <ProviderRow
          key={provider.id}
          organizationId={organizationId}
          id={provider.id}
          label={provider.label}
          callbackPath={provider.callbackPath}
          state={query.data?.find((p) => p.id === provider.id)}
          loading={query.isLoading}
        />
      ))}
    </SettingsSection>
  );
}

interface ProviderState {
  id: ProviderId;
  /** Null = never toggled in the UI ⇒ treated as enabled when credentials exist. */
  enabled: boolean | null;
  clientId: string | null;
  secretConfigured: boolean;
  issuer: string | null;
  envConfigured: boolean;
  live: boolean;
}

/** The four states a provider can be in, said plainly. Kept out of the JSX so
 *  the row stays readable and the wording lives in one place. */
function providerStatus(input: {
  live: boolean;
  configured: boolean;
  enabled: boolean;
}): string {
  if (input.live) return "Offered on the sign-in page.";
  if (!input.configured) return "Not configured. Add a client ID and secret to offer it.";
  if (!input.enabled) return "Configured but switched off.";
  return "Configured but not currently registered — check the server logs for a credential that failed to load.";
}

/** What a provider looks like before the server has said anything about it —
 *  same shape as a stored one so the view below has a single code path. */
const UNCONFIGURED: Omit<ProviderState, "id"> = {
  enabled: null,
  clientId: null,
  secretConfigured: false,
  issuer: null,
  envConfigured: false,
  live: false,
};

/** Normalize once so the markup reads plain fields rather than chaining
 *  through `state?.` on every line. */
function providerView(state: ProviderState | undefined) {
  const s = state ?? UNCONFIGURED;
  return {
    enabled: s.enabled ?? true,
    clientId: s.clientId ?? "",
    secretConfigured: s.secretConfigured,
    issuer: s.issuer ?? "",
    envConfigured: s.envConfigured,
    live: s.live,
    hasStoredCredentials: Boolean(s.clientId) && Boolean(s.secretConfigured),
  };
}

/** The pills that sit left of the row's actions: what the server actually
 *  registered, and whether the credentials came from env rather than this
 *  form. Their own component so the branching leaves the row body. */
function ProviderBadges({ live, fromEnv }: { live: boolean; fromEnv: boolean }) {
  return (
    <>
      {live && (
        <Badge variant="outline" className="font-mono text-[10px]">
          Live
        </Badge>
      )}
      {fromEnv && (
        <Badge variant="outline" className="font-mono text-[10px]">
          From env
        </Badge>
      )}
    </>
  );
}

function ProviderRow({
  organizationId,
  id,
  label,
  callbackPath,
  state,
  loading,
}: {
  organizationId: OrganizationId;
  id: ProviderId;
  label: string;
  callbackPath: string;
  state: ProviderState | undefined;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState("");
  const [issuer, setIssuer] = useState<string | null>(null);

  const save = useMutation({
    ...orpc.organization.setSocialProvider.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.organization.listSocialProviders.queryKey({ input: { organizationId } }),
      });
      // Clear the secret field on success — it's write-only, so keeping the
      // typed value around would imply it can be read back.
      setClientSecret("");
      setClientId(null);
      setIssuer(null);
      setExpanded(false);
      toast.success(`${label} sign-in saved`);
    },
    onError: (err) => toast.error(err.message ?? `Failed to save ${label} sign-in`),
  });

  const view = providerView(state);
  const effectiveClientId = clientId ?? view.clientId;
  const effectiveIssuer = issuer ?? view.issuer;
  const enabled = view.enabled;
  // Usable once both halves resolve from SOME source. env-supplied credentials
  // count, which is what keeps a pre-existing env-only install working without
  // anyone opening this page.
  const configured = view.hasStoredCredentials || view.envConfigured;

  const submit = (nextEnabled: boolean) =>
    save.mutate({
      organizationId,
      id,
      enabled: nextEnabled,
      clientId: effectiveClientId.trim() || null,
      // Omit when untouched so an existing stored secret survives an edit that
      // only changes the client id or the toggle.
      ...(clientSecret ? { clientSecret } : {}),
      ...(id === "gitlab" ? { issuer: effectiveIssuer.trim() || null } : {}),
    });

  return (
    <>
      <SettingsRow
        title={label}
        description={providerStatus({ live: view.live, configured, enabled })}
        control={
          <div className="flex items-center gap-2.5">
            <ProviderBadges live={view.live} fromEnv={view.envConfigured && !view.clientId} />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded((v) => !v)}
              disabled={loading}
            >
              {expanded ? "Cancel" : "Configure"}
            </Button>
            <Switch
              checked={enabled && configured}
              disabled={save.isPending || loading || !configured}
              onCheckedChange={(checked) => submit(checked)}
            />
          </div>
        }
      />
      {expanded && (
        <ProviderFields
          id={id}
          callbackPath={callbackPath}
          clientId={effectiveClientId}
          onClientId={setClientId}
          clientSecret={clientSecret}
          onClientSecret={setClientSecret}
          secretConfigured={view.secretConfigured}
          envConfigured={view.envConfigured}
          issuer={effectiveIssuer}
          onIssuer={setIssuer}
          saving={save.isPending}
          onSave={() => submit(enabled)}
        />
      )}
    </>
  );
}


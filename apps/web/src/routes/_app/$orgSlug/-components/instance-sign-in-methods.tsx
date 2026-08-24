/**
 * Sign-in methods card: which ways of proving who you are this installation
 * accepts.
 *
 * Social providers are not here. They have their own card, and each one is
 * already off unless it carries a credential, so "enabled" means something
 * different for them than it does for these three.
 *
 * The password switch is the one that can lock everyone out, so it is the one
 * with a floor: it can only be turned off once a federated method is live in
 * its place. The switch reflects that, but the SERVER is what enforces it (see
 * `wouldLockOut` in packages/auth/src/sign-in-methods.ts) — this endpoint is
 * reachable with an API key, and a disabled switch is not a security control.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";
import { ShieldKeyIcon } from "@hugeicons/core-free-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  SettingsRow,
  SettingsSection,
} from "@/shared/components/settings-section";
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

/** Why the password switch is pinned on, or null when it is free to move. */
function passwordLockReason(view: {
  bootstrapComplete: boolean;
  liveSocialProviderCount: number;
  registeredSsoProviderCount: number;
  sso: boolean;
}): string | null {
  if (!view.bootstrapComplete) {
    return "The first account has to be created with a password and the installer's bootstrap token, so this stays on until someone signs up.";
  }
  if (view.liveSocialProviderCount > 0) return null;
  if (view.sso && view.registeredSsoProviderCount > 0) return null;
  return "Nothing else can sign anyone in yet. Configure a social provider below, or register an identity provider in Workspace → SSO, before turning passwords off.";
}

export function SignInMethodsCard({ organizationId }: { organizationId: OrganizationId }) {
  const query = useQuery(
    orpc.organization.getSignInMethods.queryOptions({ input: { organizationId } }),
  );

  const save = useMutation({
    ...orpc.organization.setSignInMethods.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.organization.getSignInMethods.queryKey({ input: { organizationId } }),
      });
      toast.success("Sign-in methods updated");
    },
    onError: (err) => toast.error(err.message ?? "Failed to save sign-in methods"),
  });

  const view = query.data;
  const busy = save.isPending || query.isLoading;
  const lock = view ? passwordLockReason(view) : "Loading…";

  /** Send the whole set every time: the server's lock-out check has to see the
   *  resulting state, not a single field, so a partial patch would make it
   *  guess at the other two. */
  const set = (patch: {
    password?: boolean;
    passkey?: boolean;
    sso?: boolean;
  }) => {
    if (!view) return;
    save.mutate({
      organizationId,
      password: patch.password ?? view.password,
      passkey: patch.passkey ?? view.passkey,
      sso: patch.sso ?? view.sso,
    });
  };

  return (
    <SettingsSection
      icon={ShieldKeyIcon}
      title="Sign-in methods"
      description="How people prove who they are on this installation. The sign-in page shows exactly what is enabled here."
    >
      <SettingsRow
        title="Email and password"
        description={
          lock ??
          "On. People sign in with an email address and a password, and can reset it by email."
        }
        control={
          <Switch
            checked={view?.password ?? true}
            disabled={busy || lock !== null}
            onCheckedChange={(checked) => set({ password: checked })}
          />
        }
      />

      <SettingsRow
        title="Passkeys"
        description="Passwordless sign-in with a device biometric or a security key. Off also stops anyone registering a new passkey; existing ones are kept, not deleted, and start working again if you turn this back on."
        control={
          <Switch
            checked={view?.passkey ?? true}
            disabled={busy}
            onCheckedChange={(checked) => set({ passkey: checked })}
          />
        }
      />

      <SettingsRow
        title="Enterprise SSO"
        description={
          view && view.registeredSsoProviderCount === 0
            ? "No identity provider is registered yet. Add one in Workspace → SSO; this switch controls whether its button appears on the sign-in page."
            : "Per-workspace OIDC identity providers (Okta, Entra ID, Google Workspace, Authentik). Each registered provider gets its own button on the sign-in page. Turning this off leaves the providers configured but stops them signing anyone in."
        }
        control={
          <Switch
            checked={view?.sso ?? true}
            disabled={busy}
            onCheckedChange={(checked) => set({ sso: checked })}
          />
        }
      />
    </SettingsSection>
  );
}

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
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  SettingsRow,
  SettingsSection,
} from "@/shared/components/settings-section";
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

/** Translation key for why the password switch is pinned on, or null when it
 *  is free to move. Returns a KEY rather than a sentence so the decision stays
 *  a pure function the caller can translate. */
function passwordLockKey(view: {
  bootstrapComplete: boolean;
  liveSocialProviderCount: number;
  registeredSsoProviderCount: number;
  sso: boolean;
}): "sso.passwordLockedBootstrap" | "sso.passwordLockedNoFederated" | null {
  if (!view.bootstrapComplete) return "sso.passwordLockedBootstrap";
  if (view.liveSocialProviderCount > 0) return null;
  if (view.sso && view.registeredSsoProviderCount > 0) return null;
  return "sso.passwordLockedNoFederated";
}

export function SignInMethodsCard({ organizationId }: { organizationId: OrganizationId }) {
  const { t } = useTranslation();
  const query = useQuery(
    orpc.organization.getSignInMethods.queryOptions({ input: { organizationId } }),
  );

  const save = useMutation({
    ...orpc.organization.setSignInMethods.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.organization.getSignInMethods.queryKey({ input: { organizationId } }),
      });
      toast.success(t("sso.methodsSaved"));
    },
    onError: (err) => toast.error(err.message ?? t("sso.methodsSaveFailed")),
  });

  const view = query.data;
  const busy = save.isPending || query.isLoading;
  const lockKey = view ? passwordLockKey(view) : null;
  // Locked while the first read is still in flight too: flipping a switch
  // before its floor is known could send a save the server would refuse.
  const locked = lockKey !== null || !view;

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
      title={t("sso.methodsTitle")}
      description={t("sso.methodsDescription")}
    >
      <SettingsRow
        title={t("sso.passwordTitle")}
        description={lockKey === null ? t("sso.passwordOn") : t(lockKey)}
        control={
          <Switch
            checked={view?.password ?? true}
            disabled={busy || locked}
            onCheckedChange={(checked) => set({ password: checked })}
          />
        }
      />

      <SettingsRow
        title={t("sso.passkeyTitle")}
        description={t("sso.passkeyDescription")}
        control={
          <Switch
            checked={view?.passkey ?? true}
            disabled={busy}
            onCheckedChange={(checked) => set({ passkey: checked })}
          />
        }
      />

      <SettingsRow
        title={t("sso.enterpriseTitle")}
        description={
          view && view.registeredSsoProviderCount === 0
            ? t("sso.enterpriseNoProviders")
            : t("sso.enterpriseDescription")
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

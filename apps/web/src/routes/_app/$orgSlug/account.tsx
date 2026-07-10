/**
 * Account — the signed-in user's own settings: profile, password, two-factor,
 * device sessions, CLI access, and sign-out-everywhere. Everything here is
 * self-scoped (better-auth client APIs), so there's no RBAC gating — unlike
 * the workspace Settings page next door.
 */

import { createFileRoute, useParams } from "@tanstack/react-router";

import { CliCard } from "@/features/account/cli-card";
import { DangerCard } from "@/features/account/danger-card";
import { PasswordCard } from "@/features/account/password-card";
import { ProfileCard } from "@/features/account/profile-card";
import { SessionsCard } from "@/features/account/sessions-card";
import { TwoFactorCard } from "@/features/account/two-factor-card";
import { Page, PageHeader } from "@/shared/components/page";

export const Route = createFileRoute("/_app/$orgSlug/account")({
  staticData: { crumb: "Account" },
  component: AccountRoute,
});

function AccountRoute() {
  const { orgSlug } = useParams({ from: "/_app/$orgSlug/account" });
  const { user } = Route.useRouteContext();

  return (
    <Page width="narrow">
      <PageHeader
        title="Account"
        description={
          <>
            Your own sign-in and security settings —{" "}
            <span className="font-medium text-foreground">{user.email}</span>. Workspace-wide
            configuration lives in Settings.
          </>
        }
      />

      <ProfileCard />
      <PasswordCard />
      <TwoFactorCard />
      <SessionsCard />
      <CliCard orgSlug={orgSlug} />
      <DangerCard />
    </Page>
  );
}

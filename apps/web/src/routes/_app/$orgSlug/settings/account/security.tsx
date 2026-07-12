/**
 * Account → Security — password + two-factor. Self-scoped (better-auth
 * client APIs), no RBAC gating.
 */

import { createFileRoute } from "@tanstack/react-router";

import { PasswordCard } from "@/features/account/password-card";
import { TwoFactorCard } from "@/features/account/two-factor-card";
import { Page, PageHeader } from "@/shared/components/page";

export const Route = createFileRoute("/_app/$orgSlug/settings/account/security")({
  staticData: { crumb: "Security" },
  component: SecurityRoute,
});

function SecurityRoute() {
  return (
    <Page width="narrow">
      <PageHeader
        title="Security"
        description="How you sign in: password and two-factor authentication."
      />

      <PasswordCard />
      <TwoFactorCard />
    </Page>
  );
}

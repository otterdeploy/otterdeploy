/**
 * Who can get into this install, and how: account creation, the sign-in
 * methods, and the per-provider credentials the social sign-in switch depends
 * on. Split out of the single Instance page (./index.tsx).
 */

import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { Page, PageHeader } from "@/shared/components/page";

import { AccessCard } from "./-components/instance-access";
import { SignInMethodsCard } from "./-components/instance-sign-in-methods";
import { SocialSignInCard } from "./-components/instance-social-sign-in";

export const Route = createFileRoute("/_app/$orgSlug/_settings/instance/access")({
  staticData: { crumb: "Access" },
  component: AccessRoute,
});

function AccessRoute() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  return (
    <Page width="narrow">
      <PageHeader
        title="Access"
        description="Who can create an account on this install, and how anyone signs in."
      />

      {/* Identity before enforcement: who gets in is the setting an operator
          comes here for most often. Then HOW anyone signs in, then the
          per-provider credentials the switch above depends on. */}
      <AccessCard organizationId={organization.id} />
      <SignInMethodsCard organizationId={organization.id} />
      <SocialSignInCard organizationId={organization.id} />
    </Page>
  );
}

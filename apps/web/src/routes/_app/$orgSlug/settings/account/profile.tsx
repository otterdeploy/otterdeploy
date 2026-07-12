/**
 * Account → Profile — the signed-in user's identity (name, avatar, email).
 * Self-scoped (better-auth client APIs), so there's no RBAC gating. Password,
 * 2FA and device sessions live on the sibling Security / Sessions pages.
 */

import { createFileRoute } from "@tanstack/react-router";

import { ProfileCard } from "@/features/account/profile-card";
import { Page, PageHeader } from "@/shared/components/page";

export const Route = createFileRoute("/_app/$orgSlug/settings/account/profile")({
  staticData: { crumb: "Profile" },
  component: ProfileRoute,
});

function ProfileRoute() {
  const { user } = Route.useRouteContext();

  return (
    <Page width="narrow">
      <PageHeader
        title="Profile"
        description={
          <>
            Your own identity on this install —{" "}
            <span className="font-medium text-foreground">{user.email}</span>.
          </>
        }
      />

      <ProfileCard />
    </Page>
  );
}

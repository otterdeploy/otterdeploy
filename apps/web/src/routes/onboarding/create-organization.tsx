import { createFileRoute, redirect } from "@tanstack/react-router";

import type { CreatedOrg } from "@/features/onboarding/shared";

import { SetupWizard } from "@/features/onboarding/setup-wizard";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/onboarding/create-organization")({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({ to: "/sign-in" });
    }
  },
  // Resume past the organization step if one already exists — e.g. a refresh
  // after the org was created mid-wizard. Fresh signups get `null` and start
  // at step 1.
  loader: async (): Promise<{ initialOrg: CreatedOrg | null }> => {
    const orgs = await authClient.organization.list();
    const first = orgs.data?.[0];
    return {
      initialOrg: first ? { id: first.id, slug: first.slug, name: first.name } : null,
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { initialOrg } = Route.useLoaderData();
  return <SetupWizard initialOrg={initialOrg} />;
}

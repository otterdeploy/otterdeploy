import { createFileRoute, redirect } from "@tanstack/react-router";

import { CreateOrganizationForm } from "@/features/auth/components/create-organization-form";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/onboarding/create-organization")({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({ to: "/sign-in" });
    }
  },
  component: CreateOrganizationForm,
});

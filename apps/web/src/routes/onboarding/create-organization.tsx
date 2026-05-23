import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { CreateOrganizationForm } from "@/features/auth/components/create-organization-form";

export const Route = createFileRoute("/onboarding/create-organization")({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({ to: "/sign-in" });
    }
  },
  component: CreateOrganizationForm,
});

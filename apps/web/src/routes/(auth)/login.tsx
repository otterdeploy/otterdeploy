import { createFileRoute } from "@tanstack/react-router";

import AuthPageShell from "@/features/auth/components/auth-page-shell";
import SignInForm from "@/features/auth/components/sign-in-form";

export const Route = createFileRoute("/(auth)/login")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <AuthPageShell>
      <SignInForm />
    </AuthPageShell>
  );
}

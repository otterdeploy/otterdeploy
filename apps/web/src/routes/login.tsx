import { createFileRoute } from "@tanstack/react-router";

import AuthPageShell from "@/feature/auth/components/auth-page-shell";
import SignInForm from "@/feature/auth/components/sign-in-form";

export const Route = createFileRoute("/login")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <AuthPageShell>
      <SignInForm />
    </AuthPageShell>
  );
}

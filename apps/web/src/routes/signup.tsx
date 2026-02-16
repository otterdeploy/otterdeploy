import { createFileRoute } from "@tanstack/react-router";

import AuthPageShell from "@/feature/auth/components/auth-page-shell";
import SignUpForm from "@/feature/auth/components/sign-up-form";

export const Route = createFileRoute("/signup")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <AuthPageShell>
      <SignUpForm />
    </AuthPageShell>
  );
}

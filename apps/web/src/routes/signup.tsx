import { createFileRoute } from "@tanstack/react-router";

import AuthPageShell from "@/features/auth/components/auth-page-shell";
import SignUpForm from "@/features/auth/components/sign-up-form";

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

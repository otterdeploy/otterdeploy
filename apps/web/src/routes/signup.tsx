import { createFileRoute } from "@tanstack/react-router";

import AuthPageShell from "@/components/auth-page-shell";
import SignUpForm from "@/components/sign-up-form";

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

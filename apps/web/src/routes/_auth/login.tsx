import { createFileRoute } from "@tanstack/react-router";

import { SignInForm } from "@/features/auth/components/sign-in-form";

export const Route = createFileRoute("/_auth/login")({
  component: RouteComponent,
});

function RouteComponent() {
  return <SignInForm />;
}

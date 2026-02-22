import { createFileRoute } from "@tanstack/react-router";

import { Button } from "@otterdeploy/ui/components/ui/button";
import { SignUpForm } from "@/features/auth/components/sign-up-form";

export const Route = createFileRoute("/_auth/signup")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <>
      <SignUpForm />
      <Button>Sign up</Button>
    </>
  );
}

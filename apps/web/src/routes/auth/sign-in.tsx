import { createFileRoute, useNavigate } from "@tanstack/react-router";

import SignInForm from "@/features/auth/form/sign-in";

export const Route = createFileRoute("/auth/sign-in")({
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate({
    from: "/auth/sign-in",
  });

  return (
    <SignInForm
      onSwitchToSignUp={() => {
        navigate({
          to: "/auth/sign-up",
        });
      }}
    />
  );
}

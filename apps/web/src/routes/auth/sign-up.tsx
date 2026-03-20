import { createFileRoute, useNavigate } from "@tanstack/react-router";

import SignUpForm from "@/features/auth/components/sign-up-form";

export const Route = createFileRoute("/auth/sign-up")({
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate({
    from: "/auth/sign-up",
  });

  return (
    <SignUpForm
      onSwitchToSignIn={() => {
        navigate({
          to: "/auth/sign-in",
        });
      }}
    />
  );
}

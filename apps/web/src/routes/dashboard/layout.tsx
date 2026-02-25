import { authClient } from "@/lib/auth-client";
import { ZeroProviderWrapper } from "@/components/zero-provider";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent,
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();

    // if (!session?.user) {
    //   throw redirect({ to: "/login" });
    // }
    return { auth: session };
  },
  staleTime: 1000 * 60 * 5,
});

function RouteComponent() {
  const { auth } = Route.useRouteContext();

  return (
    <ZeroProviderWrapper userID={auth.user.id}>
      <Outlet />
    </ZeroProviderWrapper>
  );
}

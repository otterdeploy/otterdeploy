import { ZeroProviderWrapper } from "@/components/zero-provider";
import { authClient } from "@/lib/auth-client";
import { queryOptions } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

const sessionQueryOptions = queryOptions({
  queryKey: ["session"],
  queryFn: async () => {
    const { data } = await authClient.getSession();
    return data;
  },
  refetchOnWindowFocus: true,
  gcTime: 50_000,
});

export const Route = createFileRoute("/dash")({
  component: RouteComponent,
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (!session?.user) {
      throw redirect({ to: "/login" });
    }
    return { auth: session };
  },
});

function RouteComponent() {
  const { auth } = Route.useRouteContext();
  return (
    <ZeroProviderWrapper userID={auth.user.id}>
      <Outlet />
    </ZeroProviderWrapper>
  );
}

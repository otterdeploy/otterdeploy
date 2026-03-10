import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { queryOptions } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { AppSidebar } from "@/components/sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

const sessionQueryOptions = queryOptions({
  queryKey: ["session"],
  queryFn: async () => {
    const { data } = await authClient.getSession();
    return data;
  },
  refetchOnWindowFocus: true,
  gcTime: 50_000,
});

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (!session?.user) {
      throw redirect({ to: "/login" });
    }
    return { auth: session };
  },
});

function DashboardLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

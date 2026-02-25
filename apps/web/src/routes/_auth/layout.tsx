import { authClient } from "@/lib/auth-client";
import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth")({
  component: RouteComponent,
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (session?.user) {
      // throw redirect({ to: "/" });
    }
  },
  staleTime: 1000 * 60 * 5,
});

function RouteComponent() {
  return (
    <AuthPageShell>
      <Outlet />
    </AuthPageShell>
  );
}

function AuthPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link to="/" className="flex items-center gap-2 font-medium">
            <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
              {/* <GalleryVerticalEnd className="size-4" /> */}
            </div>
            Otterstack
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">{children}</div>
        </div>
      </div>

      <div className="bg-muted relative hidden overflow-hidden lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.28),transparent_45%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,hsl(var(--foreground)/0.12),transparent_45%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(155deg,hsl(var(--background)),hsl(var(--muted))_45%,hsl(var(--background)))]" />
        <div className="absolute inset-0 p-12">
          <div className="border-border/60 bg-background/70 text-foreground max-w-sm rounded-2xl border p-6 shadow-lg backdrop-blur">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Secure Access
            </p>
            <h2 className="mt-3 text-2xl font-semibold leading-tight">
              Build and ship features with confidence.
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Authentication is handled with Better Auth and typed end-to-end through your monorepo.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { ModeToggle } from "@/components/mode-toggle";
import UserMenu from "@/components/user-menu";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const healthCheck = useQuery(orpc.system.health.queryOptions({}));

  return (
    <div className="grid h-svh grid-rows-[auto_1fr]">
      <div>
        <div className="flex flex-row items-center justify-between px-2 py-1">
          <nav className="flex gap-4 text-lg">
            <Link to="/">Home</Link>
            <Link to="/dashboard">Dashboard</Link>
          </nav>
          <div className="flex items-center gap-2">
            <ModeToggle />
            <UserMenu />
          </div>
        </div>
        <hr />
      </div>
      <div className="container mx-auto max-w-3xl px-4 py-2">
        <div className="grid gap-6">
          <section className="rounded-lg border p-4">
            <h2 className="mb-2 font-medium">API Status</h2>
            <div className="flex items-center gap-2">
              <div
                className={`h-2 w-2 rounded-full ${healthCheck.data ? "bg-green-500" : "bg-red-500"}`}
              />
              <span className="text-sm text-muted-foreground">
                {healthCheck.isLoading
                  ? "Checking..."
                  : healthCheck.data
                    ? "Connected"
                    : "Disconnected"}
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

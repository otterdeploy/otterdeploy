import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_dashboard/")({
  component: DashboardHome,
});

function DashboardHome() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Welcome to OtterStack. Manage your infrastructure from here.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Servers</CardTitle>
            <CardDescription>Manage your connected servers</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Coming in Phase 2</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Projects</CardTitle>
            <CardDescription>Your deployed projects</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Coming in Phase 3</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Deployments</CardTitle>
            <CardDescription>Recent deployment activity</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">Coming in Phase 4</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

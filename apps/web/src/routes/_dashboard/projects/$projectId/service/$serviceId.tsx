import { createDetailPanel } from "@/components/resource/detail-panel";
import { MetricsPanel } from "@/components/resource/metrics-panel";
import { VariableEditor } from "@/components/resource/variable-editor";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@otterstack/ui/components/ui/card";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as z from "zod";

const { Panel, Content, tabValues } = createDetailPanel([
  { label: "Deployments", value: "deployments" },
  { label: "Database", value: "database" },
  { label: "Backups", value: "backups" },
  { label: "Variables", value: "variables" },
  { label: "Metrics", value: "metrics" },
  { label: "Settings", value: "settings" },
]);

const searchSchema = z.object({
  tab: z.enum(tabValues).default(tabValues[0]),
});

export const Route = createFileRoute("/_dashboard/projects/$projectId/service/$serviceId")({
  component: RouteComponent,
  validateSearch: searchSchema,
});

function RouteComponent() {
  const { tab } = Route.useSearch();
  const { projectId } = Route.useRouteContext();
  const navigate = useNavigate();

  return (
    <Panel
      title="Service"
      defaultTab={tab}
      onClose={() => navigate({ to: "/projects/$projectId", params: { projectId } })}
    >
      <Content value="deployments">
        <Card>
          <CardHeader>
            <CardTitle>Deployments</CardTitle>
            <CardDescription>
              View deployment history, status, and rollback options for this service.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Latest deployment is live and healthy.
          </CardContent>
        </Card>
      </Content>

      <Content value="database">
        <Card>
          <CardHeader>
            <CardTitle>Database</CardTitle>
            <CardDescription>
              Manage your database instance, view connection details, and monitor health.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Database is running and accepting connections.
          </CardContent>
        </Card>
      </Content>

      <Content value="backups">
        <Card>
          <CardHeader>
            <CardTitle>Backups</CardTitle>
            <CardDescription>
              View backup history, schedule automatic backups, and restore from snapshots.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Last backup completed 2 hours ago.
          </CardContent>
        </Card>
      </Content>

      <Content value="variables">
        <VariableEditor />
      </Content>

      <Content value="metrics">
        <MetricsPanel />
      </Content>

      <Content value="settings">
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>
              Configure service options, scaling, networking, and access controls.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Configure instance size, replicas, and domain settings.
          </CardContent>
        </Card>
      </Content>
    </Panel>
  );
}

import { createDetailPanel } from "@/components/resource/detail-panel";
import { DeploymentsPanel } from "@/components/resource/deployments-panel";
import { MetricsPanel } from "@/components/resource/metrics-panel";
import { SettingsPanel } from "@/components/resource/settings-panel";
import { VariableEditor } from "@/components/resource/variable-editor";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@otterdeploy/ui/components/ui/card";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@otterdeploy/zero/queries";
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
  loader: async ({ context, params }) => {
    if (context.zero) {
      context.zero.run(queries.resourceById({ resourceId: params.serviceId }));
    }
  },
  pendingComponent: () => <div>Loading...</div>,
  errorComponent: ({ error }) => <div>Error: {error.message}</div>,
});

function RouteComponent() {
  const { tab } = Route.useSearch();
  const { projectId, serviceId } = Route.useParams();
  const [resource] = useQuery(queries.resourceById({ resourceId: serviceId }));

  const navigate = useNavigate();

  return (
    <Panel
      title={resource?.name ?? "Service"}
      defaultTab={tab}
      onClose={() => navigate({ to: "/projects/$projectId", params: { projectId } })}
    >
      <Content value="deployments">
        <DeploymentsPanel />
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
        <SettingsPanel />
      </Content>
    </Panel>
  );
}

import { createDetailPanel } from "@/components/resource/detail-panel";
import {
  DeploymentLogsPanelPresence,
  type DeploymentInfo,
} from "@/components/resource/deployment-logs-panel";
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
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@otterdeploy/zero/queries";
import { useEffect, useState } from "react";
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
  deploymentId: z.string().optional(),
});

export const Route = createFileRoute(
  "/dashboard/projects/$projectId/architecture/service/$serviceId",
)({
  component: RouteComponent,
  validateSearch: searchSchema,
  loader: async ({ context, params }) => {
    if (context.zero) {
      await context.zero.run(queries.resource.byId({ resourceId: params.serviceId }));
    }
  },
  errorComponent: ({ error }) => <div>Error: {error.message}</div>,
});

function RouteComponent() {
  const { tab, deploymentId } = Route.useSearch();
  const { projectId, serviceId } = Route.useParams();
  const [resource] = useQuery(queries.resource.byId({ resourceId: serviceId }));
  const [deployments, setDeployments] = useState<DeploymentInfo[]>([]);
  const [hasDeploymentSnapshot, setHasDeploymentSnapshot] = useState(false);

  const navigate = Route.useNavigate();
  const viewingDeployment = deploymentId
    ? deployments.find((deployment) => deployment.id === deploymentId) ?? null
    : null;

  useEffect(() => {
    setDeployments([]);
    setHasDeploymentSnapshot(false);
  }, [serviceId]);

  useEffect(() => {
    if (!deploymentId || !hasDeploymentSnapshot) return;
    if (deployments.some((deployment) => deployment.id === deploymentId)) return;
    navigate({
      to: ".",
      search: (prev) => ({ ...prev, deploymentId: undefined }),
      replace: true,
    });
  }, [deploymentId, deployments, hasDeploymentSnapshot, navigate]);

  return (
    <div className="relative size-full">
      <Panel
        title={resource?.name ?? "Service"}
        defaultTab={tab}
        onClose={() => navigate({ to: "/projects/$projectId/architecture", params: { projectId } })}
        hiddenTabs={
          resource?.kind !== "database" && resource?.kind !== "cache" ? ["database", "backups"] : []
        }
      >
        <Content value="deployments">
          <DeploymentsPanel
            resourceId={serviceId}
            resourceKind={resource?.kind ?? "web"}
            resourceStatus={resource?.status ?? "unknown"}
            resourceName={resource?.name}
            onViewLogs={(id) =>
              navigate({
                to: ".",
                search: (prev) => ({ ...prev, deploymentId: id }),
              })}
            onDeploymentsChange={(items) => {
              setDeployments(items);
              setHasDeploymentSnapshot(true);
            }}
          />
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
          <VariableEditor resourceId={serviceId} projectId={projectId} />
        </Content>

        <Content value="metrics">
          <MetricsPanel />
        </Content>

        <Content value="settings">
          <SettingsPanel
            resourceId={serviceId}
            resourceName={resource?.name ?? "Service"}
          />
        </Content>
      </Panel>

      <DeploymentLogsPanelPresence
        deployment={viewingDeployment}
        resourceId={serviceId}
        resourceName={resource?.name ?? "Service"}
        onClose={() =>
          navigate({
            to: ".",
            search: (prev) => ({ ...prev, deploymentId: undefined }),
          })}
      />
    </div>
  );
}

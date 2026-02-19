import { createDetailPanel } from "@/components/resource/detail-panel";
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
  { label: "Overview", value: "overview" },
  { label: "Variables", value: "variables" },
]);

const searchSchema = z.object({
  tab: z.enum(tabValues).default("overview"),
});

export const Route = createFileRoute("/_dashboard/projects/$projectId/volume/$volume")({
  component: RouteComponent,
  validateSearch: searchSchema,
});

function RouteComponent() {
  const { tab } = Route.useSearch();
  const { projectId, volume } = Route.useParams();
  const navigate = useNavigate();

  return (
    <Panel
      title="Volume"
      defaultTab={tab}
      onClose={() => navigate({ to: "/projects/$projectId", params: { projectId } })}
      onTabChange={(value) => {
        navigate({
          to: "/projects/$projectId/volume/$volume",
          params: { projectId, volume },
          search: { tab: value },
        });
      }}
    >
      <Content value="overview">
        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
            <CardDescription>
              View volume details including size, mount path, and current usage.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Volume is healthy and currently mounted.
          </CardContent>
        </Card>
      </Content>

      <Content value="variables">
        <Card>
          <CardHeader>
            <CardTitle>Variables</CardTitle>
            <CardDescription>
              Manage environment variables associated with this volume.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            No variables configured yet.
          </CardContent>
        </Card>
      </Content>
    </Panel>
  );
}

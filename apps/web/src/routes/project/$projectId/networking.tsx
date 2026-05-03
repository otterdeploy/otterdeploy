import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectRoutesTable } from "@/features/project-networking";
import { client } from "@/utils/orpc";

export const Route = createFileRoute("/project/$projectId/networking")({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectId } = Route.useParams();
  const query = useQuery({
    queryKey: ["project-proxy-routes", projectId],
    queryFn: () => client.project.proxyRoute.list({ projectId }),
  });

  return (
    <div className="grid gap-4 p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Networking</h1>
          <p className="text-sm text-muted-foreground">
            Public domains for this project. Caddy fragment editor + add/edit/delete ships in Plan 6.
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger render={<Button size="sm" disabled>+ Add route</Button>} />
          <TooltipPopup>Route editor ships in Plan 6</TooltipPopup>
        </Tooltip>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <Alert variant="error">
          <AlertCircle />
          <AlertTitle>Couldn't load routes</AlertTitle>
          <AlertDescription>
            {query.error instanceof Error ? query.error.message : "Unknown error"}
          </AlertDescription>
        </Alert>
      ) : (
        <ProjectRoutesTable rows={(query.data ?? []).map((route) => ({ route }))} />
      )}
    </div>
  );
}

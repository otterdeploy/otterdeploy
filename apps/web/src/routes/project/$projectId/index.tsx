import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { AddResourceSheet } from "@/features/add-resource-sheet";
import { Canvas, useCanvasNodes, type CanvasNode } from "@/features/project-canvas";
import { ResourceDrawer, useResourceDrawer } from "@/features/resource-drawer";
import { client, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/project/$projectId/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectId } = Route.useParams();
  const drawer = useResourceDrawer();
  const [addOpen, setAddOpen] = useState(false);

  const databasesQuery = useQuery({
    queryKey: ["project-databases", projectId],
    queryFn: () => client.project.database.listPostgres({ projectId }),
  });

  const proxyRoutesQuery = useQuery({
    queryKey: ["project-proxy-routes", projectId],
    queryFn: () => client.project.proxyRoute.list({ projectId }),
  });

  const { nodes } = useCanvasNodes({
    databases: databasesQuery.data ?? [],
    proxyRoutes: proxyRoutesQuery.data ?? [],
  });

  const selectedNodeId =
    drawer.selection?.kind === "database"
      ? `db:${drawer.selection.resourceId}`
      : null;

  const handleSelectNode = (node: CanvasNode | null) => {
    if (!node) {
      drawer.close();
      return;
    }
    if (node.type === "database") {
      drawer.select({ kind: "database", resourceId: node.data.resourceId, projectId });
    }
    // service / volume / routing / group nodes don't open the drawer in v1
  };

  const selectedDatabaseName =
    drawer.selection?.kind === "database"
      ? (databasesQuery.data?.find((d) => d.resourceId === drawer.selection!.resourceId)?.name ?? "")
      : "";

  if (databasesQuery.isLoading || proxyRoutesQuery.isLoading) {
    return (
      <div className="grid h-full place-items-center p-8">
        <Skeleton className="h-64 w-full max-w-3xl" />
      </div>
    );
  }
  if (databasesQuery.isError || proxyRoutesQuery.isError) {
    const error = databasesQuery.error ?? proxyRoutesQuery.error;
    return (
      <div className="grid h-full place-items-center p-8">
        <Empty>
          <EmptyTitle>Couldn't load project</EmptyTitle>
          <EmptyDescription>
            {error instanceof Error ? error.message : "Try refreshing the page."}
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <Canvas nodes={nodes} selectedNodeId={selectedNodeId} onSelectNode={handleSelectNode} />

      <Button
        size="sm"
        className="absolute right-3 top-3 shadow-sm"
        onClick={() => setAddOpen(true)}
      >
        <PlusIcon className="size-4" />
        Add
      </Button>

      <ResourceDrawer
        open={drawer.open}
        selection={drawer.selection}
        onClose={drawer.close}
        onDeleted={() => {
          drawer.close();
          queryClient.invalidateQueries({ queryKey: ["project-databases", projectId] });
        }}
        resourceName={selectedDatabaseName}
      />

      <AddResourceSheet open={addOpen} onOpenChange={setAddOpen} projectId={projectId} />
    </div>
  );
}

import { queries } from "@otterdeploy/zero/queries";
import { useQuery } from "@rocicorp/zero/react";

import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { useCallback, useMemo, useState } from "react";

import { ChangesDialog } from "@/components/project/changes-dialog";
import { ProjectContext, type PendingChange } from "@/components/project/context";
import { DeployBar } from "@/components/project/deploy-bar";
import { ProjectHeader } from "@/components/project/project-header";
import { orpc } from "@/utils/orpc";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import * as z from "zod";

const env = z.object({
  env: z.string().default("production"),
});

export const Route = createFileRoute("/dash/projects/$projectId")({
  component: RouteComponent,
  staleTime: Infinity,
  validateSearch: env,
  beforeLoad: ({ context, params }) => {
    context.zero?.run(queries.project.byId({ projectId: params.projectId }));
  },
});

function RouteComponent() {
  const { projectId } = useParams({ strict: false });
  const { env: envSlug } = Route.useSearch();

  const [project] = useQuery(projectId ? queries.project.byId({ projectId }) : undefined);
  const environments = project?.environments ?? [];
  const activeEnvironment = environments.find((e) => e.name === envSlug) ?? environments[0];

  const envId = activeEnvironment?.id ?? "";
  const [resources] = useQuery(envId ? queries.resource.list({ environmentId: envId }) : undefined);

  const [deploying, setDeploying] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [changesDialogOpen, setChangesDialogOpen] = useState(false);

  const handleResourceCreated = useCallback(
    (resource: { id: string; name: string; kind: string; status: string; databaseEngine?: PendingChange["databaseEngine"] }) => {
      setPendingChanges((prev) => [
        ...prev,
        {
          id: resource.id,
          name: resource.name,
          kind: resource.kind,
          databaseEngine: resource.databaseEngine,
          action: "added",
          settings: [
            { key: "Kind", oldValue: "", newValue: resource.kind },
            { key: "Name", oldValue: "", newValue: resource.name },
            { key: "Status", oldValue: "", newValue: resource.status },
          ],
        },
      ]);
    },
    [],
  );

  const handleMarkForRemoval = useCallback((id: string) => {
    if (pendingChanges.some((c) => c.id === id)) return;
    const resource = resources?.find((r) => r.id === id);
    if (!resource) return;
    setPendingChanges((prev) => [
      ...prev,
      {
        id: resource.id,
        name: resource.name,
        kind: resource.kind,
        action: "removed",
        settings: [
          { key: "Kind", oldValue: resource.kind, newValue: "" },
          { key: "Name", oldValue: resource.name, newValue: "" },
        ],
      },
    ]);
  }, [pendingChanges, resources]);

  const createDeployment = useMutation(orpc.deployment.create.mutationOptions());
  const provisionResource = useMutation(orpc.resource.provision.mutationOptions());
  const deleteResource = useMutation(orpc.resource.delete.mutationOptions());

  const handleDeploy = useCallback(async () => {
    if (!projectId || !envId) return;

    const changes = pendingChanges;
    setDeploying(true);
    const deployable = ["web", "api", "worker"];
    const provisionable = ["database"];

    const deployments = await Promise.allSettled(
      changes.map((change) => {
        if (change.action === "removed") {
          return deleteResource.mutateAsync({ resourceId: change.id });
        } else if (deployable.includes(change.kind)) {
          return createDeployment.mutateAsync({
            projectId,
            environmentId: envId,
            resourceId: change.id,
            source: "manual",
          });
        } else if (provisionable.includes(change.kind)) {
          return provisionResource.mutateAsync({
            resourceId: change.id,
            databaseEngine: change.databaseEngine,
          });
        }
      }),
    );

    const failedDeployments = deployments.filter((deployment) => deployment.status === "rejected");
    if (failedDeployments.length > 0) {
      toast.error(
        `Some deployments failed to start: ${failedDeployments.map((deployment) => deployment.reason).join(", ")}`,
      );
      return;
    }

    setPendingChanges([]);
    setChangesDialogOpen(false);
    setDeploying(false);
  }, [projectId, envId, pendingChanges, deleteResource, createDeployment, provisionResource]);

  const handleRedeploy = useCallback(async (resource: { id: string; kind: string; databaseEngine?: PendingChange["databaseEngine"] }) => {
    if (!projectId || !envId) return;

    const deployable = ["web", "api", "worker"];
    const provisionable = ["database"];

    try {
      if (deployable.includes(resource.kind)) {
        await createDeployment.mutateAsync({
          projectId,
          environmentId: envId,
          resourceId: resource.id,
          source: "manual",
        });
      } else if (provisionable.includes(resource.kind)) {
        await provisionResource.mutateAsync({
          resourceId: resource.id,
          databaseEngine: resource.databaseEngine,
        });
      }
      toast.success("Redeploy triggered");
    } catch (err) {
      toast.error(`Redeploy failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [projectId, envId, createDeployment, provisionResource]);

  const handleDiscard = useCallback((id: string) => {
    const change = pendingChanges.find((c) => c.id === id);

    if (change?.action === "added") {
      deleteResource.mutate({ resourceId: id });
    }
    setPendingChanges((prev) => prev.filter((c) => c.id !== id));
  }, [pendingChanges, deleteResource]);

  // Memoize context value — only changes when pendingChanges state changes
  const contextValue = useMemo<ProjectContext>(
    () => ({
      envSlug: activeEnvironment?.name ?? envSlug,
      environmentId: envId,
      pendingChanges,
      onCreateResource: handleResourceCreated,
      onMarkForRemoval: handleMarkForRemoval,
      onRedeploy: handleRedeploy,
    }),
    [activeEnvironment?.name, envSlug, envId, pendingChanges, handleResourceCreated, handleMarkForRemoval, handleRedeploy],
  );

  return (
    <ProjectContext.Provider value={contextValue}>
      <div className="fixed inset-0 flex flex-col px-5">
        <ProjectHeader onCreateResource={handleResourceCreated} environmentId={envId} />
        <div className="relative flex-1 border rounded-2xl -mt-0.5 overflow-hidden">
          <Outlet />

          <AnimatePresence>
            {pendingChanges.length > 0 && (
              <DeployBar
                changeCount={pendingChanges.length}
                deploying={deploying}
                onDeploy={handleDeploy}
                onDismiss={() => setChangesDialogOpen(true)}
              />
            )}
          </AnimatePresence>

          <ChangesDialog
            changes={pendingChanges}
            open={changesDialogOpen}
            onOpenChange={setChangesDialogOpen}
            onDeploy={handleDeploy}
            onDiscard={handleDiscard}
          />
        </div>
      </div>
    </ProjectContext.Provider>
  );
}

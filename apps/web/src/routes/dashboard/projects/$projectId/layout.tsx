import { mutators } from "@otterdeploy/zero/mutators";
import { queries } from "@otterdeploy/zero/queries";
import { useQuery as useZeroQuery } from "@rocicorp/zero/react";

import { createFileRoute, Outlet, useParams, useRouter } from "@tanstack/react-router";
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
export const Route = createFileRoute("/dashboard/projects/$projectId")({
  component: RouteComponent,
  staleTime: Infinity,
  validateSearch: env,
  loaderDeps(opts) {
    return { envSlug: opts.search.env };
  },
  loader: async ({ context, params, ...rest }) => {
    const { envSlug } = rest.deps;
    const organizationId = context.auth?.session.activeOrganizationId;
    if (!organizationId) throw new Error("No active organization");

    const [project, environments, projects] = await Promise.all([
      context.zero?.run(queries.project.byId({ projectId: params.projectId })),
      context.zero?.run(queries.environment.list({ projectId: params.projectId })),
      context.zero?.run(queries.project.list({ organizationId })),
    ]);

    const activeEnvironment = environments?.find((e) => e.name === envSlug) ?? environments?.[0];

    if (!activeEnvironment) throw new Error("No active environment");
    if (!project) throw new Error("No project");
    if (!environments) throw new Error("No environments");
    if (!projects) throw new Error("No projects");

    return { organizationId, project, environments, projects, activeEnvironment };
  },
});

function RouteComponent() {
  const { projectId } = useParams({ strict: false });
  const { zero } = useRouter().options.context;

  const { activeEnvironment } = Route.useLoaderData();

  const [environments] = useZeroQuery(
    projectId ? queries.environment.list({ projectId }) : undefined,
  );

  const envId = activeEnvironment.id;

  console.log("RouteComponent", { envId, environments });

  const [resources] = useZeroQuery(queries.resource.list({ environmentId: envId }));

  const [deploying, setDeploying] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [changesDialogOpen, setChangesDialogOpen] = useState(false);

  const handleResourceCreated = useCallback(
    (resource: { id: string; name: string; kind: string; status: string }) => {
      setPendingChanges((prev) => [
        ...prev,
        {
          id: resource.id,
          name: resource.name,
          kind: resource.kind,
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
  }, []);
  const createDeployment = useMutation(orpc.deployment.create.mutationOptions());
  const provisionResource = useMutation(orpc.resource.provision.mutationOptions());

  const handleDeploy = useCallback(async () => {
    if (!projectId || !envId) return;

    const changes = pendingChanges;
    setDeploying(true);
    const deployable = ["web", "api", "worker"];
    const provisionable = ["database"];

    const deployments = await Promise.allSettled(
      changes.map((change) => {
        if (change.action === "removed") {
          zero?.mutate(mutators.resource.delete({ id: change.id }));
          return Promise.resolve();
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
  }, [projectId, envId]);

  const handleDiscard = useCallback((id: string) => {
    const change = pendingChanges.find((c) => c.id === id);

    if (change?.action === "added" && zero) {
      zero.mutate(mutators.resource.delete({ id }));
    }
    setPendingChanges((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Memoize context value — only changes when pendingChanges state changes
  const contextValue = useMemo<ProjectContext>(
    () => ({
      pendingChanges,
      onCreateResource: handleResourceCreated,
      onMarkForRemoval: handleMarkForRemoval,
    }),
    [pendingChanges, handleResourceCreated, handleMarkForRemoval],
  );

  if (!environments || environments.length === 0) return null;

  return (
    <ProjectContext.Provider value={contextValue}>
      <div className="fixed inset-0 flex flex-col px-5">
        {/* <ProjectHeader onCreateResource={handleResourceCreated} environmentId={envId} /> */}
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

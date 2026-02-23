import { useState, createContext, useContext, useCallback, useMemo, useRef } from "react";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@otterdeploy/zero/queries";
import { mutators } from "@otterdeploy/zero/mutators";
import { createFileRoute, Outlet, useParams, useRouter } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";

import { ProjectHeader } from "@/components/project/project-header";
import { DeployBar } from "@/components/project/deploy-bar";
import { ChangesDialog, type PendingChange } from "@/components/project/changes-dialog";

interface ProjectContextValue {
  pendingChanges: PendingChange[];
  onCreateResource: (resource: { id: string; name: string; kind: string; status: string }) => void;
  onMarkForRemoval: (id: string) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProjectContext() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProjectContext must be used within ProjectContext");
  return ctx;
}

export const Route = createFileRoute("/_dashboard/projects/$projectId")({
  component: RouteComponent,
  staleTime: Infinity,
  loader: async ({ context, params }) => {
    const organizationId = context.auth.session.activeOrganizationId;
    if (!organizationId) throw new Error("No active organization");

    if (context.zero) {
      await Promise.all([
        context.zero.run(queries.projectById({ projectId: params.projectId })),
        context.zero.run(queries.environmentList({ projectId: params.projectId })),
        context.zero.run(queries.projectList({ organizationId })),
      ]);
    }

    return { organizationId };
  },
});

function RouteComponent() {
  const { projectId } = useParams({ strict: false });
  const { zero } = useRouter().options.context;

  const [environments] = useQuery(projectId ? queries.environmentList({ projectId }) : undefined);
  const firstEnvId = environments?.[0]?.id;
  const [resources] = useQuery(
    firstEnvId ? queries.resourceList({ environmentId: firstEnvId }) : undefined,
  );

  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [changesDialogOpen, setChangesDialogOpen] = useState(false);

  // Refs to keep callbacks stable — avoids context value changing every render
  const resourcesRef = useRef(resources);
  resourcesRef.current = resources;
  const pendingChangesRef = useRef(pendingChanges);
  pendingChangesRef.current = pendingChanges;
  const zeroRef = useRef(zero);
  zeroRef.current = zero;

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
    if (pendingChangesRef.current.some((c) => c.id === id)) return;
    const resource = resourcesRef.current?.find((r) => r.id === id);
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

  const handleDeploy = useCallback(() => {
    const z = zeroRef.current;
    if (z) {
      for (const change of pendingChangesRef.current) {
        if (change.action === "removed") {
          z.mutate(mutators.resource.delete({ id: change.id }));
        }
      }
    }
    setPendingChanges([]);
    setChangesDialogOpen(false);
  }, []);

  const handleDiscard = useCallback((id: string) => {
    const change = pendingChangesRef.current.find((c) => c.id === id);
    const z = zeroRef.current;
    if (change?.action === "added" && z) {
      z.mutate(mutators.resource.delete({ id }));
    }
    setPendingChanges((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Memoize context value — only changes when pendingChanges state changes
  const contextValue = useMemo<ProjectContextValue>(
    () => ({
      pendingChanges,
      onCreateResource: handleResourceCreated,
      onMarkForRemoval: handleMarkForRemoval,
    }),
    [pendingChanges, handleResourceCreated, handleMarkForRemoval],
  );

  return (
    <ProjectContext.Provider value={contextValue}>
      <div className="fixed inset-0 flex flex-col px-5">
        <ProjectHeader onCreateResource={handleResourceCreated} />
        <div className="relative flex-1 border rounded-2xl -mt-0.5 overflow-hidden">
          <Outlet />

          <AnimatePresence>
            {pendingChanges.length > 0 && (
              <DeployBar
                changeCount={pendingChanges.length}
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

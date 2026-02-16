import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { Button } from "@otterstack/ui/components/ui/button";
import { Skeleton } from "@otterstack/ui/components/ui/skeleton";

import { orpc } from "@/utils/orpc";
import { EnvVarTable } from "@/components/env-vars/env-var-table";
import { EnvVarUpsertDialog } from "@/components/env-vars/env-var-upsert-dialog";

export const Route = createFileRoute(
  "/_dashboard/projects/$projectId/env-vars",
)({
  component: EnvVarsPage,
});

type EditingVar = {
  id: string;
  key: string;
  scope: string;
  isSecret: boolean;
  buildTime: boolean;
} | null;

function EnvVarsPage() {
  const { projectId } = Route.useParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EditingVar>(null);

  const varsQuery = useQuery(
    orpc.environmentVariable.list.queryOptions({
      input: { projectId },
    }),
  );

  function handleEdit(variable: EditingVar) {
    setEditing(variable);
    setDialogOpen(true);
  }

  function handleCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  return (
    <div className="flex-1 space-y-6 overflow-auto p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Environment Variables</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Manage environment variables for this project.
          </p>
        </div>
        <Button onClick={handleCreate}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="mr-2 size-4" />
          Add Variable
        </Button>
      </div>

      {varsQuery.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      )}

      {varsQuery.data && (
        <EnvVarTable
          variables={varsQuery.data}
          projectId={projectId}
          onEdit={handleEdit}
        />
      )}

      <EnvVarUpsertDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={projectId}
        editing={editing}
      />
    </div>
  );
}

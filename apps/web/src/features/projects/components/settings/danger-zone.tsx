/**
 * Project danger zone: delete the project, gated by typing the project slug.
 *
 * The typed confirmation explicitly includes every environment's services,
 * stacks, databases and volumes. Each resource uses its regular teardown;
 * any failure keeps the project record available for inspection and retry.
 */

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { idSchema } from "@otterdeploy/shared/id";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { invalidateManifestConsumers } from "@/features/projects/hooks/use-manifest-stage";
import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { Button } from "@/shared/components/ui/button";
import { orpc, queryClient } from "@/shared/server/orpc";

interface ProjectDangerZoneProps {
  project: { id: string; name: string; slug: string };
  orgSlug: string;
}

/** Pull the staged-services count off a `project.delete` CONFLICT error. */
function serviceCountOf(err: unknown): number | null {
  if (err === null || typeof err !== "object" || !("data" in err)) return null;
  const { data } = err;
  if (data === null || typeof data !== "object" || !("serviceCount" in data)) return null;
  return typeof data.serviceCount === "number" ? data.serviceCount : null;
}

export function ProjectDangerZone({ project, orgSlug }: ProjectDangerZoneProps) {
  const navigate = useNavigate();

  const deleteMut = useMutation({
    ...orpc.project.delete.mutationOptions(),
    onSuccess: async () => {
      toast.success(`Project ${project.name} deleted`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.project.list.queryKey() }),
        queryClient.invalidateQueries({ queryKey: orpc.env.list.queryKey() }),
      ]);
      await navigate({ to: "/$orgSlug", params: { orgSlug } });
    },
    onError: async (err) => {
      const n = serviceCountOf(err);
      toast.error(
        n !== null
          ? `This project still has ${n} service${n === 1 ? "" : "s"}. Delete them first. Databases are torn down with the project.`
          : err instanceof Error
            ? err.message
            : "Failed to delete project",
      );
      await invalidateManifestConsumers(idSchema.project.parse(project.id));
    },
  });

  return (
    <section className="rounded-md border border-destructive/30 bg-card p-5">
      <header className="mb-3">
        <h2 className="text-[14px] font-semibold text-destructive">Danger zone</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Irreversible. The project's databases and their volumes, stored variables, domains, and
          deployment history are destroyed. Services and stacks are torn down with the project.
        </p>
      </header>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">Delete this project</span>
          <span className="text-[11.5px] text-muted-foreground">
            <span className="font-mono">{project.slug}</span> and everything in it, permanently.
          </span>
        </div>
        <TypedConfirmDialog
          trigger={
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
              Delete project
            </Button>
          }
          title={`Delete ${project.name}?`}
          description="This deletes every service, stack and database in every environment, including their volumes, stored variables, domains and deployment history. It can't be undone."
          confirmPhrase={project.slug}
          confirmLabel="Delete project"
          pendingLabel="Deleting…"
          pending={deleteMut.isPending}
          onConfirm={() => deleteMut.mutate({ id: project.id, deleteContents: true })}
        />
      </div>
    </section>
  );
}

/**
 * Project danger zone — delete the project, gated by typing the project slug.
 *
 * The server refuses while service/compose resources exist (their runtimes
 * are only reclaimed by the per-resource delete path), so the honest copy
 * here says exactly that: remove services first, databases go down with the
 * project. Transfer-to-another-org is deliberately absent: git providers,
 * registries, and env contexts are org-scoped, so a row-level org swap would
 * silently break every binding — not a safe single update.
 */

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { TypedConfirmDialog } from "@/shared/components/typed-confirm-dialog";
import { Button } from "@/shared/components/ui/button";
import { orpc, queryClient } from "@/shared/server/orpc";

interface ProjectDangerZoneProps {
  project: { id: string; name: string; slug: string };
  orgSlug: string;
}

/** Pull the staged-services count off a `project.delete` CONFLICT error. */
function serviceCountOf(err: unknown): number | null {
  const data = (err as { data?: { serviceCount?: unknown } } | null)?.data;
  return typeof data?.serviceCount === "number" ? data.serviceCount : null;
}

export function ProjectDangerZone({ project, orgSlug }: ProjectDangerZoneProps) {
  const navigate = useNavigate();

  const deleteMut = useMutation({
    ...orpc.project.delete.mutationOptions(),
    onSuccess: () => {
      toast.success(`Project ${project.name} deleted`);
      void queryClient.invalidateQueries({ queryKey: orpc.project.list.queryKey() });
      void navigate({ to: "/$orgSlug", params: { orgSlug } });
    },
    onError: (err) => {
      const n = serviceCountOf(err);
      toast.error(
        n !== null
          ? `This project still has ${n} service${n === 1 ? "" : "s"} — delete them first. Databases are torn down with the project.`
          : err instanceof Error
            ? err.message
            : "Failed to delete project",
      );
    },
  });

  return (
    <section className="rounded-md border border-destructive/30 bg-card p-5">
      <header className="mb-3">
        <h2 className="text-[14px] font-semibold text-destructive">Danger zone</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Irreversible. The project's databases and their volumes, stored variables, domains, and
          deployment history are destroyed. Services must be deleted first.
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
          description="This tears down the project's databases and their volumes, and removes stored variables, domains, and deployment history. It can't be undone."
          confirmPhrase={project.slug}
          confirmLabel="Delete project"
          pendingLabel="Deleting…"
          pending={deleteMut.isPending}
          onConfirm={() => deleteMut.mutate({ id: project.id as never })}
        />
      </div>
    </section>
  );
}

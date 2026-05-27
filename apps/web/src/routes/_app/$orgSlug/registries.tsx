import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Database02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";

import { RegistryCard } from "@/features/registries/registry-card";
import { RegistryDialog } from "@/features/registries/registry-dialog";
import { type RegistryView } from "@/features/registries/shared";
import { Button } from "@/shared/components/ui/button";
import { orpc } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/registries")({
  staticData: { crumb: "Registries" },
  component: RegistriesRoute,
});

function RegistriesRoute() {
  const registriesQuery = useQuery(
    orpc.registry.list.queryOptions({ input: undefined }),
  );
  const registries = (registriesQuery.data ?? []) as RegistryView[];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RegistryView | null>(null);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (r: RegistryView) => {
    setEditing(r);
    setDialogOpen(true);
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">
            Container registries
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Where built images get pushed. Per-host credentials are used by both
            the builder (`docker push`) and the swarm daemon (`docker pull`).
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
          Add registry
        </Button>
      </div>

      {registriesQuery.isPending ? (
        <div className="rounded-md border bg-card p-6 text-center text-[12.5px] text-muted-foreground">
          Loading…
        </div>
      ) : registries.length === 0 ? (
        <div className="rounded-md border bg-card p-8 text-center">
          <div className="mx-auto grid size-10 place-items-center rounded-md bg-muted">
            <HugeiconsIcon
              icon={Database02Icon}
              strokeWidth={2}
              className="size-5 text-muted-foreground"
            />
          </div>
          <div className="mt-3 text-[13.5px] font-medium">
            No registries configured yet
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Add a credential for the registry you want to push built images to.
          </p>
          <Button size="sm" className="mt-3" onClick={openCreate}>
            Add your first registry
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {registries.map((r) => (
            <RegistryCard key={r.id} registry={r} onEdit={openEdit} />
          ))}
        </div>
      )}

      <RegistryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        existing={editing}
      />
    </div>
  );
}

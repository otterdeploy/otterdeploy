import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import { Database02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";

import { registryCollection } from "@/features/registries/data/registries";
import { RegistryCard } from "@/features/registries/registry-card";
import { RegistryDialog } from "@/features/registries/registry-dialog";
import { type RegistryRow } from "@/features/registries/shared";
import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";

export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/registries")({
  staticData: { crumb: "Registries" },
  component: RegistriesRoute,
  // Warm the collection(s) on hover (intent-preload) so the page renders
  // from cache instead of spinning. Non-blocking + best-effort.
  loader: () => {
    void registryCollection.preload();
  },
});

function RegistriesRoute() {
  const { data: registries, isLoading } = useLiveQuery((q) =>
    q.from({ r: registryCollection }),
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RegistryRow | null>(null);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (r: RegistryRow) => {
    setEditing(r);
    setDialogOpen(true);
  };

  return (
    <Page>
      <PageHeader
        title="Container registries"
        description="Where built images get pushed. Per-host credentials are used by both the builder (`docker push`) and the swarm daemon (`docker pull`)."
        actions={
          <Button size="sm" className="h-8 gap-1.5" onClick={openCreate}>
            <HugeiconsIcon
              icon={PlusSignIcon}
              strokeWidth={2}
              className="size-3.5"
            />
            Add registry
          </Button>
        }
      />

      {isLoading ? (
        <Skeleton className="h-44 w-full rounded-md" />
      ) : registries.length === 0 ? (
        <Empty className="flex-1 rounded-md border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <HugeiconsIcon
              icon={Database02Icon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No registries configured yet</EmptyTitle>
            <EmptyDescription>
              Add a credential for the registry you want to push built images
              to.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={openCreate}>
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
              Add your first registry
            </Button>
          </EmptyContent>
        </Empty>
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
    </Page>
  );
}

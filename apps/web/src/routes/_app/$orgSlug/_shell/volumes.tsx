import { useState } from "react";

import { HardDriveIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import type { VolumeRow } from "@/features/volumes/shared";

import { CreateVolumeDialog } from "@/features/volumes/create-volume-dialog";
import { volumesListQuery } from "@/features/volumes/data/volumes";
import { InspectVolumeDialog } from "@/features/volumes/inspect-volume-dialog";
import { RemoveVolumeDialog } from "@/features/volumes/remove-volume-dialog";
import { VolumesStats } from "@/features/volumes/volumes-stats";
import { VolumesTable } from "@/features/volumes/volumes-table";
import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Skeleton } from "@/shared/components/ui/skeleton";

export const Route = createFileRoute("/_app/$orgSlug/_shell/volumes")({
  staticData: { crumb: "Volumes" },
  component: VolumesRoute,
});

function VolumesRoute() {
  const { orgSlug } = Route.useParams();
  const list = useQuery(volumesListQuery());

  const [createOpen, setCreateOpen] = useState(false);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [removing, setRemoving] = useState<VolumeRow | null>(null);

  const volumes = list.data?.volumes ?? [];
  const drivers = list.data?.drivers ?? ["local"];
  const node = list.data?.node ?? null;

  return (
    <Page>
      <PageHeader
        title="Volumes"
        description="Named docker volumes on this node — who owns them, what's on disk, and what's been left behind."
        actions={
          <div className="flex items-center gap-3">
            {node ? (
              <span className="font-mono text-xs text-muted-foreground">
                {node.name} · docker {node.serverVersion}
              </span>
            ) : null}
            <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreateOpen(true)}>
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
              Create volume
            </Button>
          </div>
        }
      />

      {list.isLoading ? (
        <VolumesSkeleton />
      ) : list.isError ? (
        <ErrorState
          title="Couldn't reach the Docker daemon"
          message={list.error instanceof Error ? list.error.message : undefined}
          onRetry={() => void list.refetch()}
        />
      ) : volumes.length === 0 ? (
        <Empty className="flex-1 rounded-md border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <HugeiconsIcon
              icon={HardDriveIcon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No volumes on this daemon</EmptyTitle>
            <EmptyDescription>
              Databases and service mounts create volumes automatically when deployed — or create
              one here to attach to a service.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
              Create your first volume
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col gap-5">
          <VolumesStats volumes={volumes} />
          <VolumesTable
            volumes={volumes}
            orgSlug={orgSlug}
            onInspect={(v) => setInspecting(v.name)}
            onRemove={(v) => setRemoving(v)}
          />
          <p className="text-[11px] text-muted-foreground">
            Attached-to shows the platform resource that owns each volume. Orphans are unreferenced
            by any container and unclaimed by any resource — candidates for cleanup.
          </p>
        </div>
      )}

      <CreateVolumeDialog open={createOpen} onOpenChange={setCreateOpen} drivers={drivers} />
      <InspectVolumeDialog
        name={inspecting}
        onOpenChange={(open) => {
          if (!open) setInspecting(null);
        }}
      />
      <RemoveVolumeDialog
        volume={removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      />
    </Page>
  );
}

function VolumesSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[86px] rounded-md" />
        ))}
      </div>
      <Card className="gap-0 overflow-hidden rounded-md p-0">
        <div className="flex items-center gap-4 border-b bg-muted/50 px-4 py-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-16" />
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, r) => (
          <div
            key={r}
            className="flex items-center gap-4 border-b border-border/60 px-4 py-3 last:border-b-0"
          >
            {Array.from({ length: 7 }).map((_, c) => (
              <Skeleton key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </Card>
    </div>
  );
}

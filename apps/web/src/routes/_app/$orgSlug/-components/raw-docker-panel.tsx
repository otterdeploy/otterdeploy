/**
 * Raw Docker inventory: containers, images, volumes, networks, and swarm
 * tasks outside the project and Stack abstraction. Formerly the standalone
 * `/docker` page; demoted to a "Raw Docker" tab under Servers (od-u63.3)
 * because it's an escape hatch, not a peer of Servers. Content is unchanged from the
 * old page; only the chrome that wraps it moved.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { volumesListQuery } from "@/features/volumes/data/volumes";
import { VolumesSection } from "@/features/volumes/volumes-section";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Tabs, TabsContent } from "@/shared/components/ui/tabs";
import { orpc } from "@/shared/server/orpc";

import { ConfirmRemoveDialog } from "./docker-dialogs";
import { formatBytes } from "./docker-format";
import { DockerPageHeader, ManagerScopeCaption, type DockerTab } from "./docker-page-header";
import { ContainersTable } from "./docker-table-containers";
import { ImagesTable } from "./docker-table-images";
import { NetworksTable } from "./docker-table-networks";
import { TasksTable } from "./docker-tables";

/** Real narrowing for the Tabs callback, which hands the value back as a
 *  plain string. Values come only from the triggers this panel renders, so
 *  the guard is exhaustive over `DockerTab`. */
function isDockerTab(value: string): value is DockerTab {
  return (
    value === "containers" ||
    value === "images" ||
    value === "volumes" ||
    value === "networks" ||
    value === "tasks"
  );
}

/** Narrow swarm tasks to one node. Pulled out of the panel so the "all nodes"
 *  branch doesn't sit in the component body. See the note at the call site
 *  for why only this tab can honestly filter by node. */
function tasksOnNode<T extends { nodeId: string | null }>(
  tasks: T[] | undefined,
  nodeFilter: string,
): T[] | undefined {
  if (nodeFilter === "all") return tasks;
  return tasks?.filter((t) => t.nodeId === nodeFilter);
}

/** The Images tab's prune affordance: the button, its pending label, and the
 *  count of dangling images it would reclaim. Presentational; the mutation
 *  and the confirm dialog stay with the panel, which owns the refetch. */
function PruneDanglingButton({
  pending,
  disabled,
  count,
  onClick,
}: {
  pending: boolean;
  disabled: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 text-xs"
      disabled={disabled}
      onClick={onClick}
    >
      {pending ? "Pruning…" : "Prune dangling"}
      {count > 0 && (
        <Badge variant="secondary" className="h-4 rounded-sm px-1.5 font-mono text-[10px]">
          {count}
        </Badge>
      )}
    </Button>
  );
}

export function RawDockerPanel({
  orgSlug,
  initialTab,
}: {
  orgSlug: string;
  initialTab?: DockerTab;
}) {
  const [tab, setTab] = useState<DockerTab>(initialTab ?? "containers");
  const [nodeFilter, setNodeFilter] = useState<string>("all");
  const [pruneOpen, setPruneOpen] = useState(false);

  // Containers/images/volumes/networks work on any daemon, so they load
  // eagerly to populate the tab counts. Tasks need Swarm mode, so it's lazy:
  // polling it on a non-swarm daemon would error every tick and spam toasts.
  const containers = useQuery({
    ...orpc.docker.containers.list.queryOptions({ input: { all: true } }),
    refetchInterval: 5000,
  });
  const images = useQuery({
    ...orpc.docker.images.list.queryOptions({ input: { all: false } }),
    staleTime: 10_000,
  });
  // The rich volumes inventory (ownership attribution, orphans), the same
  // surface the standalone /volumes page used before it merged into this tab.
  const volumes = useQuery(volumesListQuery());
  const networks = useQuery({
    ...orpc.docker.networks.list.queryOptions({ input: {} }),
    staleTime: 10_000,
  });
  const tasks = useQuery({
    ...orpc.docker.tasks.list.queryOptions({ input: {} }),
    enabled: tab === "tasks",
    staleTime: 10_000,
  });
  // Swarm membership + node names. Cheap and near-static: `swarm:false` comes
  // straight back under the plain-docker runtime.
  const nodes = useQuery({
    ...orpc.docker.nodes.list.queryOptions({ input: {} }),
    staleTime: 60_000,
  });

  const swarm = nodes.data?.swarm ?? false;
  const nodeList = nodes.data?.nodes ?? [];
  const nodeNames = new Map(nodeList.map((n) => [n.id, n.hostname]));

  // Node scoping is only genuinely possible for swarm TASKS (each task carries
  // its NodeID). Containers/images/volumes/networks are per-daemon state and
  // the control plane only reaches the manager's daemon. Those tabs say so
  // instead of pretending to filter.
  // Pick only the QueryLike fields TasksTable reads instead of depending on the
  // whole (referentially unstable) query object, which would recompute every
  // render. Destructure the exact fields so the memo tracks only real changes.
  const { data: tasksData, isLoading, isError, error, refetch } = tasks;
  const filteredTasks = {
    data: tasksOnNode(tasksData, nodeFilter),
    isLoading,
    isError,
    error,
    refetch,
  };

  const prune = useMutation(
    orpc.docker.images.prune.mutationOptions({
      onSuccess: (res) => {
        toast.success(
          res.imagesDeleted > 0
            ? `Pruned ${res.imagesDeleted} dangling image${res.imagesDeleted === 1 ? "" : "s"}, ${formatBytes(res.reclaimedBytes)} reclaimed`
            : "Nothing to prune. No dangling images.",
        );
        setPruneOpen(false);
        void images.refetch();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const danglingCount = (images.data ?? []).filter(
    (img) => img.repoTags.length === 0 || img.repoTags[0] === "<none>:<none>",
  ).length;

  const tabs: Array<[DockerTab, string, number | undefined]> = [
    ["containers", "Containers", containers.data?.length],
    ["images", "Images", images.data?.length],
    ["volumes", "Volumes", volumes.data?.volumes.length],
    ["networks", "Networks", networks.data?.length],
    ["tasks", "Tasks", tasks.data?.length],
  ];

  const nodeItems = [
    { value: "all", label: "All nodes" },
    ...nodeList.map((n) => ({
      value: n.id,
      label: n.leader ? `${n.hostname} (leader)` : n.hostname,
    })),
  ];

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        if (isDockerTab(v)) setTab(v);
      }}
      className="flex min-w-0 flex-1 flex-col gap-0"
    >
      <DockerPageHeader
        tab={tab}
        tabs={tabs}
        refreshing={containers.isFetching}
        swarm={swarm}
        nodeItems={nodeItems}
        nodeFilter={nodeFilter}
        onNodeFilterChange={setNodeFilter}
      />

      <div className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">
        <TabsContent value="containers">
          <ManagerScopeCaption swarm={swarm} tab={tab} />
          <ContainersTable query={containers} />
        </TabsContent>
        <TabsContent value="images">
          <ManagerScopeCaption swarm={swarm} tab={tab} />
          <div className="mb-3 flex items-center justify-end">
            <PruneDanglingButton
              pending={prune.isPending}
              disabled={prune.isPending || images.isLoading}
              count={danglingCount}
              onClick={() => setPruneOpen(true)}
            />
          </div>
          <ImagesTable query={images} />
        </TabsContent>
        <TabsContent value="volumes">
          <ManagerScopeCaption swarm={swarm} tab={tab} />
          <VolumesSection orgSlug={orgSlug} />
        </TabsContent>
        <TabsContent value="networks">
          <ManagerScopeCaption swarm={swarm} tab={tab} />
          <NetworksTable query={networks} />
        </TabsContent>
        <TabsContent value="tasks">
          <p className="mb-3 text-xs text-muted-foreground">
            Swarm tasks are the actual scheduling units the orchestrator created from each Stack
            service.
          </p>
          <TasksTable query={filteredTasks} nodeNames={nodeNames} />
        </TabsContent>
      </div>

      <ConfirmRemoveDialog
        open={pruneOpen}
        onOpenChange={setPruneOpen}
        title="Prune dangling images?"
        description="Deletes untagged leftover layers from previous builds: images with no tag and no container. Tagged images and anything in use are never touched. Frees disk; the next build may lose some layer cache."
        confirmLabel="Prune"
        pending={prune.isPending}
        onConfirm={() => prune.mutate({})}
      />
    </Tabs>
  );
}

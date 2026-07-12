import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import * as z from "zod";

import { volumesListQuery } from "@/features/volumes/data/volumes";
import { VolumesSection } from "@/features/volumes/volumes-section";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Tabs, TabsContent } from "@/shared/components/ui/tabs";
import { orpc } from "@/shared/server/orpc";

import { ConfirmRemoveDialog } from "../-components/docker-dialogs";
import { formatBytes } from "../-components/docker-format";
import {
  DockerPageHeader,
  ManagerScopeCaption,
  type DockerTab,
} from "../-components/docker-page-header";
import { ContainersTable } from "../-components/docker-table-containers";
import { ImagesTable } from "../-components/docker-table-images";
import { NetworksTable } from "../-components/docker-table-networks";
import { TasksTable } from "../-components/docker-tables";

// `tab` in the search so the old /volumes route (and deep links) can land on
// a specific tab; state stays local after that so switches don't spam history.
const dockerSearch = z.object({
  tab: z.enum(["containers", "images", "volumes", "networks", "tasks"]).optional(),
});

export const Route = createFileRoute("/_app/$orgSlug/_shell/docker")({
  staticData: { crumb: "Docker" },
  validateSearch: dockerSearch,
  component: DockerRoute,
});

function DockerRoute() {
  const { orgSlug } = Route.useParams();
  const { tab: initialTab } = Route.useSearch();
  const [tab, setTab] = useState<DockerTab>(initialTab ?? "containers");
  const [nodeFilter, setNodeFilter] = useState<string>("all");
  const [pruneOpen, setPruneOpen] = useState(false);

  // Containers/images/volumes/networks work on any daemon, so they load
  // eagerly to populate the tab counts. Tasks need Swarm mode, so it's lazy —
  // polling it on a non-swarm daemon would error every tick and spam toasts.
  const containers = useQuery({
    ...orpc.docker.containers.list.queryOptions({ input: { all: true } }),
    refetchInterval: 5000,
  });
  const images = useQuery({
    ...orpc.docker.images.list.queryOptions({ input: { all: false } }),
    staleTime: 10_000,
  });
  // The rich volumes inventory (ownership attribution, orphans) — the same
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
  const nodeList = useMemo(() => nodes.data?.nodes ?? [], [nodes.data]);
  const nodeNames = useMemo(
    () => new Map(nodeList.map((n) => [n.id, n.hostname])),
    [nodeList],
  );

  // Node scoping is only genuinely possible for swarm TASKS (each task carries
  // its NodeID). Containers/images/volumes/networks are per-daemon state and
  // the control plane only reaches the manager's daemon — those tabs say so
  // instead of pretending to filter.
  const filteredTasks = useMemo(() => {
    if (nodeFilter === "all") return tasks;
    return { ...tasks, data: tasks.data?.filter((t) => t.nodeId === nodeFilter) };
  }, [tasks, nodeFilter]);

  const prune = useMutation(
    orpc.docker.images.prune.mutationOptions({
      onSuccess: (res) => {
        toast.success(
          res.imagesDeleted > 0
            ? `Pruned ${res.imagesDeleted} dangling image${res.imagesDeleted === 1 ? "" : "s"} — ${formatBytes(res.reclaimedBytes)} reclaimed`
            : "Nothing to prune — no dangling images",
        );
        setPruneOpen(false);
        images.refetch();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const danglingCount = useMemo(
    () =>
      (images.data ?? []).filter(
        (img) => img.repoTags.length === 0 || img.repoTags[0] === "<none>:<none>",
      ).length,
    [images.data],
  );

  const tabs: Array<[DockerTab, string, number | undefined]> = [
    ["containers", "Containers", containers.data?.length],
    ["images", "Images", images.data?.length],
    ["volumes", "Volumes", volumes.data?.volumes.length],
    ["networks", "Networks", networks.data?.length],
    ["tasks", "Tasks", tasks.data?.length],
  ];

  const nodeItems = useMemo(
    () => [
      { value: "all", label: "All nodes" },
      ...nodeList.map((n) => ({
        value: n.id,
        label: n.leader ? `${n.hostname} (leader)` : n.hostname,
      })),
    ],
    [nodeList],
  );

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as DockerTab)}
      className="flex flex-1 flex-col gap-0"
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

      <div className="flex-1 overflow-auto p-6">
        <TabsContent value="containers">
          <ManagerScopeCaption swarm={swarm} tab={tab} />
          <ContainersTable query={containers} />
        </TabsContent>
        <TabsContent value="images">
          <ManagerScopeCaption swarm={swarm} tab={tab} />
          <div className="mb-3 flex items-center justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={prune.isPending || images.isLoading}
              onClick={() => setPruneOpen(true)}
            >
              {prune.isPending ? "Pruning…" : "Prune dangling"}
              {danglingCount > 0 && (
                <Badge variant="secondary" className="h-4 rounded-sm px-1.5 font-mono text-[10px]">
                  {danglingCount}
                </Badge>
              )}
            </Button>
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
        description="Deletes untagged leftover layers from previous builds — images with no tag and no container. Tagged images and anything in use are never touched. Frees disk; the next build may lose some layer cache."
        confirmLabel="Prune"
        pending={prune.isPending}
        onConfirm={() => prune.mutate({})}
      />
    </Tabs>
  );
}

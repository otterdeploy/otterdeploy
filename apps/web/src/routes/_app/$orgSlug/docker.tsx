import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/shared/components/page";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { orpc } from "@/shared/server/orpc";

import { ConfirmRemoveDialog } from "./-components/docker-dialogs";
import { formatBytes } from "./-components/docker-format";
import {
  ContainersTable,
  ImagesTable,
  NetworksTable,
  TasksTable,
  VolumesTable,
} from "./-components/docker-tables";

export const Route = createFileRoute("/_app/$orgSlug/docker")({
  staticData: { crumb: "Docker" },
  component: DockerRoute,
});

type Tab = "containers" | "images" | "volumes" | "networks" | "tasks";

function DockerRoute() {
  const [tab, setTab] = useState<Tab>("containers");
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
  const volumes = useQuery({
    ...orpc.docker.volumes.list.queryOptions({ input: {} }),
    staleTime: 10_000,
  });
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

  const tabs: Array<[Tab, string, number | undefined]> = [
    ["containers", "Containers", containers.data?.length],
    ["images", "Images", images.data?.length],
    ["volumes", "Volumes", volumes.data?.length],
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

  // Caption for the per-daemon tabs when this deployment is a swarm — the
  // inventory below is the manager daemon's local state, not cluster-wide.
  const managerScopeCaption =
    swarm && tab !== "tasks" ? (
      <p className="mb-3 text-xs text-muted-foreground">
        Scope: manager node&apos;s daemon. Per-node{" "}
        {tab === "containers" ? "container" : tab.slice(0, -1)} listing isn&apos;t reachable from
        the control plane — only swarm tasks carry a node.
      </p>
    ) : null;

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as Tab)}
      className="flex flex-1 flex-col gap-0"
    >
      <div className="border-b px-6 pb-0 pt-6">
        <PageHeader
          title="Docker"
          description="Raw daemon-level inventory — containers, images, volumes, networks, and swarm tasks outside the project and Stack abstraction."
          actions={
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {containers.isFetching ? "refreshing…" : null}
              </span>
              {swarm && tab === "tasks" && nodeList.length > 0 && (
                <Select
                  items={nodeItems}
                  value={nodeFilter}
                  onValueChange={(v) => setNodeFilter(v ?? "all")}
                >
                  <SelectTrigger className="h-8 w-48" aria-label="Filter tasks by node">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {nodeItems.map((it) => (
                      <SelectItem key={it.value} value={it.value}>
                        {it.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          }
        />

        <TabsList variant="line" className="mt-3.5 h-9 justify-start gap-1">
          {tabs.map(([id, label, count]) => (
            <TabsTrigger key={id} value={id} className="gap-1.5">
              <span>{label}</span>
              {count !== undefined && (
                <Badge
                  variant="secondary"
                  className="ml-1 h-4 rounded-sm px-1.5 font-mono text-[10px]"
                >
                  {count}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <TabsContent value="containers">
          {managerScopeCaption}
          <ContainersTable query={containers} />
        </TabsContent>
        <TabsContent value="images">
          {managerScopeCaption}
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
          {managerScopeCaption}
          <VolumesTable query={volumes} />
        </TabsContent>
        <TabsContent value="networks">
          {managerScopeCaption}
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

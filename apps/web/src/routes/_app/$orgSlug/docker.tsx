import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PageHeader } from "@/shared/components/page";
import { Badge } from "@/shared/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { orpc } from "@/shared/server/orpc";

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

  const tabs: Array<[Tab, string, number | undefined]> = [
    ["containers", "Containers", containers.data?.length],
    ["images", "Images", images.data?.length],
    ["volumes", "Volumes", volumes.data?.length],
    ["networks", "Networks", networks.data?.length],
    ["tasks", "Tasks", tasks.data?.length],
  ];

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
            <span className="text-xs text-muted-foreground">
              {containers.isFetching ? "refreshing…" : null}
            </span>
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
          <ContainersTable query={containers} />
        </TabsContent>
        <TabsContent value="images">
          <ImagesTable query={images} />
        </TabsContent>
        <TabsContent value="volumes">
          <VolumesTable query={volumes} />
        </TabsContent>
        <TabsContent value="networks">
          <NetworksTable query={networks} />
        </TabsContent>
        <TabsContent value="tasks">
          <TasksTable query={tasks} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

import { useState } from "react";

import { Database02Icon, ServerStack01Icon, FlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLiveQuery } from "@tanstack/react-db";

import { serverCollection } from "@/features/servers/data/server";
import {
  terminalContainersCollection,
  terminalDatabasesCollection,
} from "@/features/terminal/data/targets";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";

import type { SessionSource } from "../types";

import { DatabaseTab, SshTab } from "./open-terminal-node-tabs";
import { ContainerTab, PROJECT_DOT, type PickerService } from "./open-terminal-tabs";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (source: SessionSource) => void;
  /** Optional starting project filter. Defaults to "all". */
  defaultProject?: string;
}

export function OpenTerminalDialog({ open, onOpenChange, onPick, defaultProject = "all" }: Props) {
  const [tab, setTab] = useState<"container" | "ssh" | "database">("container");
  const [projectFilter, setProjectFilter] = useState(defaultProject);

  // Live data: containers + databases come from terminal.targets (one query
  // covers both tabs). SSH nodes come from the server collection.
  // Two sibling collections share one terminal.targets RPC via the same
  // queryKey — opening the picker fires a single network call. Sync reads
  // make re-opening instant.
  const { data: containers = [] } = useLiveQuery(() => terminalContainersCollection);
  const { data: databases = [] } = useLiveQuery(() => terminalDatabasesCollection);

  const { data: servers } = useLiveQuery((q) => q.from({ s: serverCollection }));

  // Group containers into service rows for the Container tab. A "service"
  // here is one entry in the list — its replicas are the individual
  // containers exec is targeting. Postgres containers come through as
  // single-replica services keyed by their service name.
  const services: PickerService[] = (() => {
    const byKey = new Map<string, PickerService>();
    for (const c of containers) {
      if (!c.projectSlug || !c.serviceName) continue;
      const key = `${c.projectSlug}/${c.serviceName}`;
      let svc = byKey.get(key);
      if (!svc) {
        svc = {
          project: c.projectSlug,
          projectName: c.projectName ?? c.projectSlug,
          name: c.serviceName,
          replicas: [],
        };
        byKey.set(key, svc);
      }
      svc.replicas.push({
        label: c.replicaSlot ?? c.containerId.slice(0, 12),
        containerId: c.containerId,
      });
    }
    return [...byKey.values()];
  })();

  // Derive available projects + counts from the live container set.
  const projects = (() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const s of services) {
      counts.set(s.project, (counts.get(s.project) ?? 0) + s.replicas.length);
      total += s.replicas.length;
    }
    const list = Array.from(counts.entries()).map(([id, count]) => ({
      id,
      count,
      dot: PROJECT_DOT[id] ?? "bg-muted-foreground",
    }));
    list.sort((a, b) => b.count - a.count);
    return { total, list };
  })();

  const filteredServices =
    projectFilter === "all" ? services : services.filter((s) => s.project === projectFilter);

  function pick(source: SessionSource) {
    onPick(source);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-160">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base font-semibold">Open a terminal</DialogTitle>
          <DialogDescription className="sr-only">
            Pick a container, swarm node, or database to start an interactive session.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => {
            if (v) setTab(v as typeof tab);
          }}
          className="gap-0 px-5"
        >
          <TabsList variant="line" className="h-auto bg-transparent p-0">
            <TabsTrigger value="container" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon icon={ServerStack01Icon} strokeWidth={2} className="size-3.5" />
              Container
            </TabsTrigger>
            <TabsTrigger value="ssh" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon icon={FlashIcon} strokeWidth={2} className="size-3.5" />
              SSH (node)
            </TabsTrigger>
            <TabsTrigger value="database" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon icon={Database02Icon} strokeWidth={2} className="size-3.5" />
              Database
            </TabsTrigger>
          </TabsList>

          <TabsContents>
            <TabsContent value="container" className="mt-4">
              <ContainerTab
                projectFilter={projectFilter}
                setProjectFilter={setProjectFilter}
                projects={projects}
                services={filteredServices}
                onPick={pick}
              />
            </TabsContent>

            <TabsContent value="ssh" className="mt-4 space-y-2 pb-8">
              <SshTab servers={servers} onPick={pick} />
            </TabsContent>

            <TabsContent value="database" className="mt-4 space-y-2 pb-8">
              <DatabaseTab databases={databases} onPick={pick} />
            </TabsContent>
          </TabsContents>
        </Tabs>

        <div className="h-4" />
      </DialogContent>
    </Dialog>
  );
}

import {
  Database02Icon,
  ServerStack01Icon,
  FlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useLiveQuery } from "@tanstack/react-db";
import { useMemo, useState } from "react";

import { serverCollection } from "@/features/servers/data/server";
import {
  terminalContainersCollection,
  terminalDatabasesCollection,
} from "@/features/terminal/data/targets";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
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
import { cn } from "@/shared/lib/utils";

import type { SessionSource } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (source: SessionSource) => void;
  /** Optional starting project filter. Defaults to "all". */
  defaultProject?: string;
}

const PROJECT_DOT: Record<string, string> = {
  helio: "bg-success",
  billing: "bg-warning",
  "marketing-site": "bg-info",
  "lab-internal": "bg-pink-500",
  analytics: "bg-emerald-500",
};

interface PickerService {
  project: string;
  projectName: string;
  name: string;
  replicas: Array<{ label: string; containerId: string }>;
}

export function OpenTerminalDialog({
  open,
  onOpenChange,
  onPick,
  defaultProject = "all",
}: Props) {
  const [tab, setTab] = useState<"container" | "ssh" | "database">("container");
  const [projectFilter, setProjectFilter] = useState(defaultProject);

  // Live data: containers + databases come from terminal.targets (one query
  // covers both tabs). SSH nodes come from the server collection.
  // Two sibling collections share one terminal.targets RPC via the same
  // queryKey — opening the picker fires a single network call. Sync reads
  // make re-opening instant.
  const { data: containers = [] } = useLiveQuery(
    () => terminalContainersCollection,
  );
  const { data: databases = [] } = useLiveQuery(
    () => terminalDatabasesCollection,
  );

  const { data: servers = [] } = useLiveQuery((q) =>
    q.from({ s: serverCollection }),
  );

  // Group containers into service rows for the Container tab. A "service"
  // here is one entry in the list — its replicas are the individual
  // containers exec is targeting. Postgres containers come through as
  // single-replica services keyed by their service name.
  const services = useMemo<PickerService[]>(() => {
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
  }, [containers]);

  // Derive available projects + counts from the live container set.
  const projects = useMemo(() => {
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
  }, [services]);

  const filteredServices = useMemo(() => {
    if (projectFilter === "all") return services;
    return services.filter((s) => s.project === projectFilter);
  }, [projectFilter, services]);

  function pick(source: SessionSource) {
    onPick(source);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-160 gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base font-semibold">
            Open a terminal
          </DialogTitle>
          <DialogDescription className="sr-only">
            Pick a container, swarm node, or database to start an interactive
            session.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => v && setTab(v as typeof tab)}
          className="gap-0 px-5"
        >
          <TabsList variant="line" className="h-auto bg-transparent p-0">
            <TabsTrigger value="container" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon
                icon={ServerStack01Icon}
                strokeWidth={2}
                className="size-3.5"
              />
              Container
            </TabsTrigger>
            <TabsTrigger value="ssh" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon
                icon={FlashIcon}
                strokeWidth={2}
                className="size-3.5"
              />
              SSH (node)
            </TabsTrigger>
            <TabsTrigger value="database" className="gap-1.5 px-3 py-2">
              <HugeiconsIcon
                icon={Database02Icon}
                strokeWidth={2}
                className="size-3.5"
              />
              Database
            </TabsTrigger>
          </TabsList>

          <TabsContents>
            <TabsContent value="container" className="mt-4">
              {/* Project filter pills */}
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <FilterPill
                  active={projectFilter === "all"}
                  onClick={() => setProjectFilter("all")}
                  label="All projects"
                  count={projects.total}
                />
                {projects.list.map((p) => (
                  <FilterPill
                    key={p.id}
                    active={projectFilter === p.id}
                    onClick={() => setProjectFilter(p.id)}
                    label={p.id}
                    count={p.count}
                    dot={p.dot}
                  />
                ))}
              </div>

              <p className="mb-3 text-[12.5px] text-muted-foreground">
                Pick a service then a specific container (replica) to{" "}
                <span className="font-mono text-foreground/80">
                  docker exec
                </span>{" "}
                into.
              </p>

              <div className="-mx-2.5 max-h-105 space-y-2 overflow-y-auto px-2.5 pb-8">
                {filteredServices.length === 0 ? (
                  <div className="rounded-md border border-dashed bg-muted/20 py-8 text-center text-sm text-muted-foreground">
                    No services in {projectFilter}.
                  </div>
                ) : (
                  filteredServices.map((s) => (
                    <ServiceRow
                      key={`${s.project}/${s.name}`}
                      service={s.name}
                      project={s.project}
                      projectDot={
                        PROJECT_DOT[s.project] ?? "bg-muted-foreground"
                      }
                      replicas={s.replicas.map((r) => r.label)}
                      onPickReplica={(label) => {
                        const replica = s.replicas.find(
                          (r) => r.label === label,
                        );
                        if (!replica) return;
                        pick({
                          kind: "container",
                          project: s.project,
                          service: s.name,
                          replica: replica.label,
                          containerId: replica.containerId,
                        });
                      }}
                    />
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent value="ssh" className="mt-4 space-y-2 pb-8">
              <p className="text-[12.5px] text-muted-foreground">
                Open a shell on the host or SSH into a swarm node.
              </p>
              {servers.length === 0 ? (
                <div className="rounded-md border border-dashed bg-muted/20 py-6 text-center text-sm text-muted-foreground">
                  No servers registered yet.
                </div>
              ) : (
                servers.map((n) => {
                  // The bootstrap localhost row is the host shell — only it has
                  // a wired backend right now (the remote SSH exec path isn't
                  // implemented yet). Other rows show but route to the
                  // "not implemented" inline message.
                  const isLocal = n.labels.includes("bootstrap");
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() =>
                        pick({
                          kind: "ssh",
                          mode: isLocal ? "local" : "remote",
                          node: n.name,
                          host: n.host,
                        })
                      }
                      className="flex w-full items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-left transition-colors hover:border-ring"
                    >
                      <HugeiconsIcon
                        icon={ServerStack01Icon}
                        strokeWidth={1.8}
                        className="size-4 text-muted-foreground"
                      />
                      <span className="font-mono text-[13px]">{n.name}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-mono text-[10px] font-normal",
                          isLocal
                            ? "border-success/40 bg-success/10 text-success"
                            : null,
                        )}
                      >
                        {isLocal ? "host" : "swarm node"}
                      </Badge>
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                        {n.host}
                      </span>
                    </button>
                  );
                })
              )}
            </TabsContent>

            <TabsContent value="database" className="mt-4 space-y-2 pb-8">
              <p className="text-[12.5px] text-muted-foreground">
                Open a database console — psql, redis-cli, mongosh, …
              </p>
              {databases.length === 0 ? (
                <div className="rounded-md border border-dashed bg-muted/20 py-6 text-center text-sm text-muted-foreground">
                  No databases in any project yet.
                </div>
              ) : (
                databases.map((db) => (
                  <button
                    key={db.resourceId}
                    type="button"
                    onClick={() =>
                      pick({
                        kind: "database",
                        engine: db.engine,
                        service: db.name,
                        project: db.projectSlug,
                      })
                    }
                    className="flex w-full items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-left transition-colors hover:border-ring"
                  >
                    <HugeiconsIcon
                      icon={Database02Icon}
                      strokeWidth={1.8}
                      className="size-4 text-muted-foreground"
                    />
                    <span className="font-mono text-[13px]">{db.name}</span>
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px] font-normal"
                    >
                      {db.engine}
                    </Badge>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {db.projectName}
                    </span>
                  </button>
                ))
              )}
            </TabsContent>
          </TabsContents>
        </Tabs>

        <div className="h-4" />
      </DialogContent>
    </Dialog>
  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
  dot,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  dot?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
        active
          ? "border-foreground bg-card text-foreground"
          : "border-transparent text-muted-foreground hover:bg-muted",
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dot)} />}
      <span>{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">
        {count}
      </span>
    </button>
  );
}

function ServiceRow({
  service,
  project,
  projectDot,
  replicas,
  onPickReplica,
}: {
  service: string;
  project: string;
  projectDot: string;
  replicas: string[];
  onPickReplica: (label: string) => void;
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-2">
        <HugeiconsIcon
          icon={ServerStack01Icon}
          strokeWidth={1.8}
          className="size-3.5 text-muted-foreground"
        />
        <span className="font-mono text-[13px] font-medium">{service}</span>
        <span className="text-[11px] text-muted-foreground">
          · {replicas.length}{" "}
          {replicas.length === 1 ? "container" : "containers"}
        </span>
        <Badge
          variant="outline"
          className="gap-1 font-mono text-[10px] font-normal"
        >
          <span className={cn("size-1.5 rounded-full", projectDot)} />
          {project}
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {replicas.map((r) => (
          <Button
            key={r}
            type="button"
            variant="outline"
            size="sm"
            className="gap-1 font-mono text-[12px]"
            onClick={() => onPickReplica(r)}
          >
            <HugeiconsIcon
              icon={FlashIcon}
              strokeWidth={2}
              className="size-3"
            />
            {r}
          </Button>
        ))}
      </div>
    </div>
  );
}

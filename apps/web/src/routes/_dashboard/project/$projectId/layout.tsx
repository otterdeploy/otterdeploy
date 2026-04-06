import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  useEdgesState,
} from "@xyflow/react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Globe,
  Loader2,
  Network,
  Plus,
  Settings,
} from "lucide-react";
import * as z from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  EnvironmentSwitcher,
  useEnvironmentSwitcher,
  type Environment,
} from "@/features/environment-switcher";
import {
  DatabaseResource,
  type TDatabaseResource,
} from "@/features/project-flow/components/database-resource";
import { client, queryClient } from "@/utils/orpc";

const searchParams = z.object({
  env: z.string().default("development"),
});

export const Route = createFileRoute("/_dashboard/project/$projectId")({
  validateSearch: searchParams,
  component: RouteComponent,
});

const nodeTypes: NodeTypes = {
  database: DatabaseResource,
};

const initialEdges: Edge[] = [];

function RouteComponent() {
  const { env } = Route.useSearch();
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => client.project.get({ id: projectId }),
  });
  const databaseQuery = useQuery({
    queryKey: ["project-databases", projectId],
    queryFn: () => client.project.database.listPostgres({ projectId }),
  });

  const environments: Environment[] = [
    { id: "env-dev", name: "development", label: "Development" },
    { id: "env-staging", name: "staging", label: "Staging" },
    { id: "env-prod", name: "production", label: "Production" },
  ];

  const switcher = useEnvironmentSwitcher(environments);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedDatabaseId, setSelectedDatabaseId] = useState<string | null>(null);
  const [databaseName, setDatabaseName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const createDatabaseMutation = useMutation({
    mutationFn: async () =>
      client.project.database.createPostgres({
        projectId,
        name: databaseName.trim(),
      }),
    onSuccess: async (database) => {
      setDatabaseName("");
      setCreateOpen(false);
      setSelectedDatabaseId(database.resourceId);
      await queryClient.invalidateQueries({ queryKey: ["project-databases", projectId] });
    },
  });

  const databases = databaseQuery.data ?? [];
  const nodes = useMemo<TDatabaseResource[]>(() => {
    return databases.map((database, index) => ({
      id: database.resourceId,
      type: "database",
      dragHandle: ".resource-drag-handle",
      position: {
        x: 140 + (index % 3) * 260,
        y: 120 + Math.floor(index / 3) * 220,
      },
      data: {
        category: "Database",
        name: database.name,
        engine: database.engine,
        status: database.runtime.status,
        health: database.runtime.health,
        publicHostname: database.publicHostname,
        internalHostname: database.internalHostname,
        volumes: [
          {
            id: `${database.resourceId}-database`,
            source: database.databaseName,
            target: "/var/lib/postgresql/data",
          },
        ],
      },
      selected: database.resourceId === selectedDatabaseId,
    }));
  }, [databases, selectedDatabaseId]);

  const selectedDatabase = useMemo(
    () => databases.find((database) => database.resourceId === selectedDatabaseId) ?? null,
    [databases, selectedDatabaseId],
  );
  const createDatabaseErrorMessage =
    createDatabaseMutation.error instanceof Error ? createDatabaseMutation.error.message : null;

  useEffect(() => {
    if (selectedDatabaseId && !databases.some((database) => database.resourceId === selectedDatabaseId)) {
      setSelectedDatabaseId(null);
    }
  }, [databases, selectedDatabaseId]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((edgesSnapshot) => addEdge(params, edgesSnapshot)),
    [setEdges],
  );

  const onNodeClick = useCallback<NodeMouseHandler<Node>>((_, node) => {
    setSelectedDatabaseId(node.id);
  }, []);

  useHotkey("E", () => switcher.open(env), {
    enabled: !switcher.isOpen,
  });

  useHotkey("Escape", () => switcher.close(), {
    enabled: switcher.isOpen,
  });

  useHotkey("ArrowLeft", () => switcher.prev(), {
    enabled: switcher.isOpen,
  });

  useHotkey("ArrowRight", () => switcher.next(), {
    enabled: switcher.isOpen,
  });

  useHotkey(
    "Enter",
    () => {
      const selected = switcher.select();
      if (selected) {
        navigate({ search: (prev) => ({ ...prev, env: selected.name }) });
      }
    },
    {
      enabled: switcher.isOpen,
    },
  );

  return (
    <>
      <div className="h-screen w-full p-4">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground/70">
              Project Canvas
            </div>
            <div className="text-2xl font-semibold tracking-tight">
              {projectQuery.data?.name ?? "Loading project..."}
            </div>
            <div className="text-sm text-muted-foreground">
              {projectQuery.data?.slug ?? "Preparing project metadata"} · {env}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline">
              {databaseQuery.isSuccess
                ? `${databaseQuery.data.length} database${databaseQuery.data.length === 1 ? "" : "s"}`
                : "databases"}
            </Badge>
            <Dialog onOpenChange={setCreateOpen} open={createOpen}>
              <DialogTrigger render={<Button />}>
                <Plus className="size-4" />
                New Database
              </DialogTrigger>
              <DialogPopup className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create Database</DialogTitle>
                  <DialogDescription>
                    This creates a dedicated Postgres resource for the current project and wires up
                    its local and public connection details.
                  </DialogDescription>
                </DialogHeader>

                <form
                  className="space-y-4 p-6 pt-0"
                  onSubmit={(event) => {
                    event.preventDefault();

                    if (!databaseName.trim() || createDatabaseMutation.isPending) {
                      return;
                    }

                    createDatabaseMutation.mutate();
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="canvas-database-name">Database name</Label>
                    <Input
                      id="canvas-database-name"
                      onChange={(event) => setDatabaseName(event.target.value)}
                      placeholder="primary"
                      value={databaseName}
                    />
                  </div>

                  {createDatabaseErrorMessage ? (
                    <Alert variant="error">
                      <AlertCircle />
                      <AlertTitle>Couldn’t create database</AlertTitle>
                      <AlertDescription>{createDatabaseErrorMessage}</AlertDescription>
                    </Alert>
                  ) : null}

                  <DialogFooter variant="bare">
                    <Button
                      disabled={!databaseName.trim() || createDatabaseMutation.isPending}
                      type="submit"
                    >
                      {createDatabaseMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                      Create Resource
                    </Button>
                  </DialogFooter>
                </form>
              </DialogPopup>
            </Dialog>
            <Link params={{ projectId }} search={(prev) => prev} to="/project/$projectId/settings">
              <Button variant="outline">
                <Settings className="size-4" />
                Settings
              </Button>
            </Link>
          </div>
        </div>

        <ReactFlow
          className="rounded-2xl border border-border bg-background/70"
          defaultEdgeOptions={{
            style: {
              stroke: "rgba(115, 115, 130, 0.7)",
              strokeWidth: 1.5,
            },
            type: "smoothstep",
          }}
          edges={edges}
          fitView
          nodeTypes={nodeTypes}
          nodes={nodes}
          onConnect={onConnect}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onPaneClick={() => setSelectedDatabaseId(null)}
        >
          <Background
            color="rgba(120, 120, 140, 0.3)"
            gap={8}
            id="dots"
            variant={BackgroundVariant.Dots}
          />
        </ReactFlow>

        {databaseQuery.isLoading ? (
          <div className="pointer-events-none absolute inset-x-0 top-28 mx-auto flex w-fit items-center gap-2 rounded-full border border-border bg-background/92 px-4 py-2 text-sm text-muted-foreground shadow-sm">
            <Loader2 className="size-4 animate-spin" />
            Loading project databases...
          </div>
        ) : null}

        {databaseQuery.isError ? (
          <div className="absolute inset-x-0 top-28 mx-auto w-fit rounded-2xl border border-destructive/30 bg-background/95 px-4 py-3 text-sm shadow-sm">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-4" />
              Failed to load databases
            </div>
          </div>
        ) : null}

        {!databaseQuery.isLoading && databases.length === 0 ? (
          <div className="absolute inset-x-0 top-32 mx-auto flex w-fit items-center gap-3 rounded-[1.5rem] border border-dashed border-border bg-background/92 px-5 py-4 text-sm text-muted-foreground shadow-sm">
            <span>No databases yet. Create one here and it will appear on the canvas.</span>
            <Button
              disabled={createDatabaseMutation.isPending}
              onClick={() => setCreateOpen(true)}
              size="sm"
              type="button"
            >
              <Plus className="size-4" />
              New Database
            </Button>
          </div>
        ) : null}

        <Outlet />
      </div>

      <Sheet onOpenChange={(open) => !open && setSelectedDatabaseId(null)} open={!!selectedDatabase}>
        {selectedDatabase ? (
          <SheetPopup side="right" variant="inset">
            <SheetHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-full border border-border bg-muted/40 p-2">
                  <Database className="size-4" />
                </div>
                <div className="space-y-1">
                  <SheetTitle>{selectedDatabase.name}</SheetTitle>
                  <SheetDescription>
                    PostgreSQL database `{selectedDatabase.databaseName}`
                  </SheetDescription>
                </div>
                <Badge className="ml-auto" variant={getRuntimeVariant(selectedDatabase.runtime.status)}>
                  {selectedDatabase.runtime.status}
                </Badge>
              </div>
            </SheetHeader>

            <SheetPanel className="grid gap-5">
              {selectedDatabase.runtime.status === "running" ? (
                <StatusCard
                  description={
                    selectedDatabase.runtime.health === "healthy"
                      ? "The dedicated Postgres container is running and reporting healthy."
                      : "The dedicated Postgres container is running."
                  }
                  icon={<CheckCircle2 className="size-4 text-success" />}
                  title="Container is running"
                />
              ) : (
                <StatusCard
                  description={`Docker reports this Postgres container as ${selectedDatabase.runtime.status}.`}
                  icon={<AlertCircle className="size-4 text-warning" />}
                  title="Container needs attention"
                />
              )}

              {selectedDatabase.status === "valid" ? (
                <StatusCard
                  description="The generated Caddy layer4 route was applied successfully."
                  icon={<CheckCircle2 className="size-4 text-success" />}
                  title="Public ingress is live"
                />
              ) : (
                <StatusCard
                  description="The database exists, but the generated ingress still needs attention before the public endpoint is live."
                  icon={<AlertCircle className="size-4 text-warning" />}
                  title="Ingress needs attention"
                />
              )}

              <InfoGrid
                items={[
                  {
                    label: "Public host",
                    value: `${selectedDatabase.publicHostname}:${selectedDatabase.publicPort}`,
                    icon: <Globe className="size-4" />,
                  },
                  {
                    label: "Local host",
                    value:
                      selectedDatabase.runtime.hostPort === null
                        ? "Port unavailable"
                        : `127.0.0.1:${selectedDatabase.runtime.hostPort}`,
                    icon: <Network className="size-4" />,
                  },
                  {
                    label: "Username",
                    value: selectedDatabase.username,
                    icon: <Database className="size-4" />,
                  },
                  {
                    label: "Container",
                    value: selectedDatabase.runtime.containerName,
                    icon: <Database className="size-4" />,
                  },
                ]}
              />

              <CodeBlock label="Public connection string" value={selectedDatabase.publicConnectionString} />
              {selectedDatabase.localConnectionString ? (
                <CodeBlock
                  label="Local connection string"
                  value={selectedDatabase.localConnectionString}
                />
              ) : null}
              <CodeBlock
                label="Internal connection string"
                value={selectedDatabase.internalConnectionString}
              />
              <CodeBlock label="Password" value={selectedDatabase.password} />
            </SheetPanel>
          </SheetPopup>
        ) : null}
      </Sheet>

      <EnvironmentSwitcher
        activeIndex={switcher.activeIndex}
        environments={environments}
        isOpen={switcher.isOpen}
        onClose={switcher.close}
        onSelect={(index) => {
          const selected = environments[index];
          if (selected) {
            switcher.close();
            navigate({ search: (prev) => ({ ...prev, env: selected.name }) });
          }
        }}
        onSetIndex={(index) => switcher.setActiveIndex(index)}
      />
    </>
  );
}

function InfoGrid({
  items,
}: {
  items: Array<{ label: string; value: string; icon: React.ReactNode }>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div className="rounded-2xl border border-border/80 bg-muted/20 p-4" key={item.label}>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {item.icon}
            {item.label}
          </div>
          <code className="mt-2 block break-all text-sm">{item.value}</code>
        </div>
      ))}
    </div>
  );
}

function CodeBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2">
      <div className="text-sm font-medium">{label}</div>
      <pre className="overflow-x-auto rounded-2xl border border-border/80 bg-muted/20 px-4 py-3 text-xs leading-6 sm:text-sm">
        <code>{value}</code>
      </pre>
    </div>
  );
}

function StatusCard({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/80 bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function getRuntimeVariant(status: "running" | "starting" | "stopped" | "missing" | "error") {
  switch (status) {
    case "running":
      return "success" as const;
    case "starting":
      return "outline" as const;
    case "stopped":
    case "missing":
    case "error":
      return "warning" as const;
    default:
      return "outline" as const;
  }
}

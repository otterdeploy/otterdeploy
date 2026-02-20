import { useState } from "react";
import { orpc, client, queryClient } from "@/utils/orpc";
import {
  createFileRoute,
  Outlet,
  useMatchRoute,
  useParams,
  useRouter,
} from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useHotkey } from "@tanstack/react-hotkeys";
import { AnimatePresence, motion } from "motion/react";
import * as z from "zod";

import {
  addEdge,
  applyNodeChanges,
  Background,
  Controls,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Node,
  type NodeChange,
  type OnConnect,
} from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";

import "@xyflow/react/dist/style.css";

import { ResourceNodeComponent, GroupNodeComponent } from "@/components/resource/node";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FieldError } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ApiIcon,
  CpuIcon,
  DatabaseIcon,
  DatabaseLightningIcon,
  GlobeIcon,
  HardDriveIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from "@/components/ui/tabs";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/_dashboard/projects/$projectId")({
  component: RouteComponent,
  loader: async ({ context, params }) => {
    const organizationId = context.auth.session.activeOrganizationId;
    if (!organizationId) throw new Error("No active organization");

    const [project, environments, projects] = await Promise.all([
      context.queryClient.ensureQueryData(
        orpc.project.getById.queryOptions({
          input: { projectId: params.projectId },
        }),
      ),
      context.queryClient.ensureQueryData(
        orpc.environment.list.queryOptions({
          input: { projectId: params.projectId },
        }),
      ),
      context.queryClient.ensureQueryData(
        orpc.project.list.queryOptions({
          input: { organizationId },
        }),
      ),
    ]);
    return { project, environments, projects: projects.items };
  },
});

const initialNodes: Node[] = [
  {
    id: "group-services",
    type: "group",
    position: { x: 0, y: 0 },
    style: { width: 760, height: 170 },
    data: { label: "Services" },
  },
  {
    id: "group-data",
    type: "group",
    position: { x: 240, y: 210 },
    style: { width: 520, height: 190 },
    data: { label: "Data Layer" },
  },
  {
    id: "1",
    type: "resource",
    parentId: "group-services",
    position: { x: 16, y: 56 },
    data: { name: "Frontend", kind: "web", status: "online", metadata: {} },
  },
  {
    id: "2",
    type: "resource",
    parentId: "group-services",
    position: { x: 264, y: 56 },
    data: { name: "API Server", kind: "api", status: "online", metadata: {} },
  },
  {
    id: "5",
    type: "resource",
    parentId: "group-services",
    position: { x: 520, y: 56 },
    data: { name: "Job Runner", kind: "worker", status: "deploying", metadata: {} },
  },
  {
    id: "3",
    type: "resource",
    parentId: "group-data",
    position: { x: 16, y: 56 },
    data: {
      name: "PostgreSQL",
      kind: "database",
      status: "online",
      metadata: {},
      attachments: [{ id: "vol-pg", kind: "volume", name: "pg-data" }],
    },
  },
  {
    id: "4",
    type: "resource",
    parentId: "group-data",
    position: { x: 272, y: 56 },
    data: { name: "Redis", kind: "cache", status: "degraded", metadata: {} },
  },
];

const initialEdges = [
  {
    id: "e1",
    source: "1",
    sourceHandle: "right",
    target: "2",
    targetHandle: "left",
    type: "smoothstep",
    animated: true,
  },
  {
    id: "e2",
    source: "2",
    sourceHandle: "right",
    target: "5",
    targetHandle: "left",
    type: "smoothstep",
    animated: true,
  },
  {
    id: "e3",
    source: "2",
    sourceHandle: "bottom",
    target: "3",
    targetHandle: "top",
    type: "smoothstep",
    animated: true,
  },
  {
    id: "e4",
    source: "2",
    sourceHandle: "bottom",
    target: "4",
    targetHandle: "top",
    type: "smoothstep",
    animated: true,
  },
  {
    id: "e5",
    source: "5",
    sourceHandle: "bottom",
    target: "4",
    targetHandle: "top",
    type: "smoothstep",
    animated: true,
  },
];

const nodeTypes = {
  resource: ResourceNodeComponent,
  group: GroupNodeComponent,
};

const kindOptions = [
  { value: "web", label: "Web", icon: GlobeIcon },
  { value: "api", label: "API", icon: ApiIcon },
  { value: "worker", label: "Worker", icon: CpuIcon },
  { value: "database", label: "Database", icon: DatabaseIcon },
  { value: "cache", label: "Cache", icon: DatabaseLightningIcon },
  { value: "volume", label: "Volume", icon: HardDriveIcon },
] as const;

type ResourceKind = (typeof kindOptions)[number]["value"];

// --- Environment switcher with inline create ---

function EnvironmentSwitcher({
  projectId,
  environments,
}: {
  projectId: string;
  environments: { id: string; name: string }[];
}) {
  const [selected, setSelected] = useState(environments[0]?.name ?? "production");
  const [showCreate, setShowCreate] = useState(false);
  const router = useRouter();

  const form = useForm({
    defaultValues: {
      name: "",
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(1, "Environment name is required").max(64, "Name is too long"),
      }),
    },
    onSubmit: async ({ value }) => {
      await client.environment.create({
        projectId,
        name: value.name.trim(),
      });
      await queryClient.invalidateQueries({
        queryKey: orpc.environment.list.queryOptions({
          input: { projectId },
        }).queryKey,
      });
      setShowCreate(false);
      setSelected(value.name.trim());
      form.reset();
      router.invalidate();
    },
  });

  return (
    <Dialog open={showCreate} onOpenChange={setShowCreate}>
      <Select
        value={selected}
        onValueChange={(val) => {
          if (val === "__create__") {
            setShowCreate(true);
            return;
          }
          if (val) setSelected(val);
        }}
      >
        <SelectTrigger
          size="sm"
          className="border-none bg-transparent shadow-none ring-0 focus-visible:ring-0 gap-1 px-1 text-sm font-medium"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {environments.map((env) => (
            <SelectItem key={env.id} value={env.name}>
              {env.name}
            </SelectItem>
          ))}
          <div className="border-t border-border my-1" />
          <SelectItem value="__create__">
            <PlusIcon className="size-3.5" />
            New environment
          </SelectItem>
        </SelectContent>
      </Select>

      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New environment</DialogTitle>
            <DialogDescription>Create a new environment for this project.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <form.Field name="name">
              {(field) => (
                <Field>
                  <Input
                    placeholder="e.g. staging"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    autoFocus
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          </div>
          <DialogFooter showCloseButton>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit}>
                  {isSubmitting ? "Creating..." : "Create environment"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Top header bar ---

function ProjectHeader({
  onCreateResource,
}: {
  onCreateResource: (resource: {
    id: string;
    name: string;
    kind: ResourceKind;
    status: string;
  }) => void;
}) {
  const { project, environments, projects } = Route.useLoaderData();
  const router = useRouter();

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border/40 bg-background">
      {/* Left: project + environment */}
      <div className="flex items-center gap-0 px-4">
        <Select
          value={project.id}
          onValueChange={(val) => {
            if (val) {
              router.navigate({
                to: "/projects/$projectId",
                params: { projectId: val },
              });
            }
          }}
        >
          <SelectTrigger
            size="sm"
            className="border-none bg-transparent shadow-none ring-0 focus-visible:ring-0 gap-1 px-1 text-sm font-medium"
          >
            <span className="flex flex-1 text-left">{project.name}</span>
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="mx-1 text-muted-foreground/40 select-none">/</span>

        <EnvironmentSwitcher projectId={project.id} environments={environments} />
      </div>

      {/* Center: nav tabs */}
      <Tabs defaultValue="architecture" className="ml-auto self-stretch gap-0">
        <TabsList variant="line" className="relative h-full! border-none bg-transparent p-0!">
          {(
            [
              { label: "Architecture", value: "architecture" },
              { label: "Observability", value: "observability" },
              { label: "Logs", value: "logs" },
              { label: "Settings", value: "settings" },
            ] as const
          ).map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="h-full! px-3 py-0! border-transparent! bg-transparent! after:hidden rounded-none"
            >
              {tab.label}
            </TabsTrigger>
          ))}
          <TabsIndicator />
        </TabsList>
      </Tabs>

      {/* Right: new button */}
      <div className="flex items-center gap-2 px-4">
        <CreateResourcePalette onCreated={onCreateResource} />
      </div>
    </header>
  );
}

// --- Create resource command palette ---

function CreateResourcePalette({
  onCreated,
}: {
  onCreated: (resource: { id: string; name: string; kind: ResourceKind; status: string }) => void;
}) {
  const { projectId } = useParams({ strict: false });
  const [open, setOpen] = useState(false);

  useHotkey("C", (e) => {
    e.preventDefault();
    setOpen((prev) => !prev);
  });

  const { data: environments } = useQuery(
    orpc.environment.list.queryOptions({
      input: { projectId: projectId! },
      enabled: !!projectId && open,
    }),
  );

  async function handleSelect(kind: ResourceKind) {
    if (!projectId) return;
    const env = environments?.[0];
    if (!env) return;

    const label = kindOptions.find((o) => o.value === kind)?.label ?? kind;

    const resource = await client.resource.create({
      projectId,
      environmentId: env.id,
      name: label,
      kind,
      posX: 100 + Math.random() * 200,
      posY: 100 + Math.random() * 200,
    });

    await queryClient.invalidateQueries({
      queryKey: orpc.resource.list.queryOptions({
        input: { projectId },
      }).queryKey,
    });

    onCreated({
      id: resource.id,
      name: resource.name,
      kind: resource.kind as ResourceKind,
      status: resource.status,
    });

    setOpen(false);
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        Create
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Create resource"
        description="Pick a resource type to add to your project."
      >
        <Command>
          <CommandInput placeholder="What would you like to create?" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              {kindOptions.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={opt.label}
                  onSelect={() => handleSelect(opt.value)}
                  className="py-2.5 px-3 cursor-pointer"
                >
                  <HugeiconsIcon icon={opt.icon} className="size-5 text-muted-foreground" />
                  <span className="flex-1">{opt.label}</span>
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

// --- Viewport controller ---

function ViewportController() {
  const { setCenter, getNode, getNodes, getInternalNode, getViewport, fitView } = useReactFlow();
  const match = useMatchRoute();

  const serviceMatch = match({ from: "/projects/$projectId/service/$serviceId" });
  const volumeMatch = match({ from: "/projects/$projectId/volume/$volume" });

  const showChild = !!(serviceMatch || volumeMatch);
  const activeId = serviceMatch ? serviceMatch.serviceId : volumeMatch ? volumeMatch.volume : null;

  const prevShowChildRef = useRef(showChild);

  useEffect(() => {
    if (showChild && activeId) {
      let targetNode = getNode(activeId);

      if (!targetNode) {
        const parent = getNodes().find((n) =>
          (n.data as { attachments?: { id: string }[] })?.attachments?.some(
            (a) => a.id === activeId,
          ),
        );
        if (parent) targetNode = parent;
      }

      if (targetNode) {
        const { zoom } = getViewport();
        const panelWidthPx = window.innerWidth * 0.6;
        const nodeWidth = targetNode.measured?.width ?? 180;
        const nodeHeight = targetNode.measured?.height ?? 80;

        // Use absolute position (accounts for parent group offset)
        const internalNode = getInternalNode(targetNode.id);
        const absX = internalNode?.internals.positionAbsolute.x ?? targetNode.position.x;
        const absY = internalNode?.internals.positionAbsolute.y ?? targetNode.position.y;

        const nodeCenterX = absX + nodeWidth / 2;
        const nodeCenterY = absY + nodeHeight / 2;

        // Shift the center so the node appears in the visible area left of the panel.
        // panelWidthPx / zoom converts screen pixels to flow coordinates.
        // Divide by 2 to center the node within the remaining visible space.
        setCenter(nodeCenterX + panelWidthPx / zoom / 2, nodeCenterY, {
          duration: 300,
          zoom,
        });
      }
    }

    if (!showChild && prevShowChildRef.current) {
      fitView({ duration: 300, padding: 0.2 });
    }

    prevShowChildRef.current = showChild;
  }, [showChild, activeId, setCenter, getNode, getNodes, getInternalNode, getViewport, fitView]);

  return null;
}

// --- Group resize logic ---

const GROUP_PADDING = { top: 50, right: 20, bottom: 20, left: 16 };
const DEFAULT_NODE_WIDTH = 220;
const DEFAULT_NODE_HEIGHT = 80;

function resizeGroups(nodes: Node[]): Node[] {
  const groups = nodes.filter((n) => n.type === "group");
  const children = nodes.filter((n) => n.parentId);

  const updated = new Map<string, { width: number; height: number }>();

  for (const group of groups) {
    const kids = children.filter((n) => n.parentId === group.id);
    if (kids.length === 0) continue;

    let maxX = 0;
    let maxY = 0;

    for (const kid of kids) {
      const w = kid.measured?.width ?? DEFAULT_NODE_WIDTH;
      const h = kid.measured?.height ?? DEFAULT_NODE_HEIGHT;
      maxX = Math.max(maxX, kid.position.x + w);
      maxY = Math.max(maxY, kid.position.y + h);
    }

    updated.set(group.id, {
      width: maxX + GROUP_PADDING.right,
      height: maxY + GROUP_PADDING.bottom,
    });
  }

  if (updated.size === 0) return nodes;

  return nodes.map((n) => {
    const newSize = updated.get(n.id);
    if (!newSize) return n;
    return { ...n, style: { ...n.style, ...newSize } };
  });
}

// --- Main layout ---

function RouteComponent() {
  const [nodes, setNodes] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const onConnect: OnConnect = useCallback(
    (params) => setEdges((els) => addEdge(params, els)),
    [setEdges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => {
        const updated = applyNodeChanges(changes, nds);
        const clamped = updated.map((n) => {
          if (!n.parentId) return n;
          const x = Math.max(GROUP_PADDING.left, n.position.x);
          const y = Math.max(GROUP_PADDING.top, n.position.y);
          if (x === n.position.x && y === n.position.y) return n;
          return { ...n, position: { x, y } };
        });
        return resizeGroups(clamped);
      });
    },
    [setNodes],
  );

  const handleResourceCreated = useCallback(
    (resource: { id: string; name: string; kind: string; status: string }) => {
      setNodes((nds) => {
        const newNode: Node = {
          id: resource.id,
          type: "resource",
          position: { x: 100 + Math.random() * 300, y: 100 + Math.random() * 200 },
          data: {
            id: resource.id,
            name: resource.name,
            kind: resource.kind,
            status: resource.status,
            metadata: {},
          },
        };
        return [...nds, newNode];
      });
    },
    [setNodes],
  );

  const match = useMatchRoute();

  const serviceMatch = match({ from: "/projects/$projectId/service/$serviceId" });
  const volumeMatch = match({ from: "/projects/$projectId/volume/$volume" });
  const showChild = serviceMatch || volumeMatch;

  return (
    <div className="fixed inset-0 flex flex-col px-5 ">
      {/* Top header bar */}
      <ProjectHeader onCreateResource={handleResourceCreated} />

      {/* Canvas + sliding panel */}
      <div className="relative flex-1  border rounded-2xl -mt-0.5 overflow-hidden">
        <div className="absolute inset-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            colorMode="dark"
            fitView
            style={{ width: "100%", height: "100%" }}
          >
            <Controls />
            <Background />
            <ViewportController />
          </ReactFlow>
        </div>

        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={showChild ? "child-panel" : "parent-panel"}
            className="border-white/10 border-l-1 bg-background border-t-1 overflow-hidden h-[90vh] w-[60vw] max-md:w-full absolute right-0 bottom-0 rounded-tl-xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            hidden={!showChild}
            transition={{ type: "tween", duration: 0.25 }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@otterdeploy/zero/queries";
import { mutators } from "@otterdeploy/zero/mutators";
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
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  useReactFlow,
  type Node,
  type NodeChange,
  type OnConnect,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import "@xyflow/react/dist/style.css";

import { ResourceNodeComponent, GroupNodeComponent, type Kind } from "@/components/resource/node";
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
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisVerticalIcon,
  PlusIcon,
  RocketIcon,
  Settings2Icon,
  XIcon,
} from "lucide-react";

export const Route = createFileRoute("/_dashboard/projects/$projectId")({
  component: RouteComponent,
  loader: async ({ context, params }) => {
    const organizationId = context.auth.session.activeOrganizationId;
    if (!organizationId) throw new Error("No active organization");

    if (context.zero) {
      context.zero.run(queries.projectById({ projectId: params.projectId }));
      context.zero.run(queries.environmentList({ projectId: params.projectId }));
      context.zero.run(queries.projectList({ organizationId }));
    }

    return { organizationId };
  },
});

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
  const { zero } = useRouter().options.context;

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
      if (!zero) return;
      const id = crypto.randomUUID();
      zero.mutate(
        mutators.environment.create({
          id,
          projectId,
          name: value.name.trim(),
        }),
      );
      setShowCreate(false);
      setSelected(value.name.trim());
      form.reset();
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
  const { projectId } = useParams({ strict: false });
  const { organizationId } = Route.useLoaderData();
  const router = useRouter();

  const [project] = useQuery(queries.projectById({ projectId: projectId! }));
  const [environments] = useQuery(queries.environmentList({ projectId: projectId! }));
  const [projects] = useQuery(queries.projectList({ organizationId }));

  if (!project) return null;

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
            {(projects ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="mx-1 text-muted-foreground/40 select-none">/</span>

        <EnvironmentSwitcher projectId={project.id} environments={environments ?? []} />
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

const databaseEngines = [
  { value: "postgresql", label: "PostgreSQL", description: "Reliable relational database" },
  { value: "mysql", label: "MySQL", description: "Popular open-source RDBMS" },
  { value: "mariadb", label: "MariaDB", description: "Community-driven MySQL fork" },
  { value: "mongodb", label: "MongoDB", description: "Document-oriented NoSQL" },
  { value: "redis", label: "Redis", description: "In-memory data store" },
  { value: "keydb", label: "KeyDB", description: "High-performance Redis fork" },
  { value: "dragonfly", label: "Dragonfly", description: "Modern Redis-compatible store" },
  { value: "clickhouse", label: "ClickHouse", description: "Column-oriented analytics DB" },
] as const;

type DatabaseEngine = (typeof databaseEngines)[number]["value"];
type PaletteStep = "pick-type" | "pick-database";

function CreateResourcePalette({
  onCreated,
}: {
  onCreated: (resource: { id: string; name: string; kind: ResourceKind; status: string }) => void;
}) {
  const { projectId } = useParams({ strict: false });
  const { zero } = useRouter().options.context;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<PaletteStep>("pick-type");

  useHotkey("C", (e) => {
    e.preventDefault();
    setOpen((prev) => !prev);
  });

  const [environments] = useQuery(
    projectId ? queries.environmentList({ projectId }) : undefined,
  );

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setStep("pick-type");
  }

  async function createResource(kind: ResourceKind, name: string) {
    if (!projectId || !zero) return;
    const env = environments?.[0];
    if (!env) return;

    const id = crypto.randomUUID();
    const posX = 100 + Math.random() * 200;
    const posY = 100 + Math.random() * 200;
    zero.mutate(
      mutators.resource.create({
        id,
        environmentId: env.id,
        kind,
        name,
        posX,
        posY,
      }),
    );

    // Auto-create a volume and link it to the database
    if (kind === "database") {
      const volumeId = crypto.randomUUID();
      const volumeName = `${name.toLowerCase()}-volume`;
      zero.mutate(
        mutators.resource.create({
          id: volumeId,
          environmentId: env.id,
          kind: "volume",
          name: volumeName,
          posX,
          posY: posY + 120,
        }),
      );
      zero.mutate(
        mutators.resourceLink.create({
          id: crypto.randomUUID(),
          environmentId: env.id,
          sourceResourceId: id,
          targetResourceId: volumeId,
          linkType: "depends_on",
        }),
      );
    }

    onCreated({ id, name, kind, status: "unknown" });

    handleOpenChange(false);
  }

  function handleSelectKind(kind: ResourceKind) {
    if (kind === "database") {
      setStep("pick-database");
      return;
    }
    const label = kindOptions.find((o) => o.value === kind)?.label ?? kind;
    createResource(kind, label);
  }

  function handleSelectDatabase(engine: DatabaseEngine) {
    const label = databaseEngines.find((e) => e.value === engine)?.label ?? engine;
    createResource("database", label);
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        Create
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={step === "pick-type" ? "Create resource" : "New Database"}
        description={
          step === "pick-type"
            ? "Pick a resource type to add to your project."
            : "Choose a database engine."
        }
      >
        <Command>
          <CommandInput
            placeholder={
              step === "pick-type" ? "What would you like to create?" : "Search databases..."
            }
          />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>

            {step === "pick-type" && (
              <CommandGroup>
                {kindOptions.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.label}
                    onSelect={() => handleSelectKind(opt.value)}
                    className="py-2.5 px-3 cursor-pointer"
                  >
                    <HugeiconsIcon icon={opt.icon} className="size-5 text-muted-foreground" />
                    <span className="flex-1">{opt.label}</span>
                    <ChevronRightIcon className="size-4 text-muted-foreground" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {step === "pick-database" && (
              <CommandGroup>
                {databaseEngines.map((db) => (
                  <CommandItem
                    key={db.value}
                    value={db.label}
                    onSelect={() => handleSelectDatabase(db.value)}
                    className="py-2.5 px-3 cursor-pointer"
                  >
                    <HugeiconsIcon icon={DatabaseIcon} className="size-5 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm">{db.label}</span>
                      <span className="block text-xs text-muted-foreground">{db.description}</span>
                    </div>
                    <ChevronRightIcon className="size-4 text-muted-foreground" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
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
        const targetZoom = Math.min(zoom, 0.85);
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
        // panelWidthPx / targetZoom converts screen pixels to flow coordinates.
        // Divide by 2 to center the node within the remaining visible space.
        setCenter(nodeCenterX + panelWidthPx / targetZoom / 2, nodeCenterY, {
          duration: 300,
          zoom: targetZoom,
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

// --- Main layout ---

// --- Deploy bar ---

function DeployBar({
  changeCount,
  onDeploy,
  onDismiss,
}: {
  changeCount: number;
  onDeploy: () => void;
  onDismiss: () => void;
}) {
  useHotkey("Shift+Enter", (e) => {
    e.preventDefault();
    onDeploy();
  });

  if (changeCount === 0) return null;

  return (
    <motion.div
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -20, opacity: 0 }}
      className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-xl border border-border/60 bg-card/95 backdrop-blur-sm px-1.5 py-1.5 shadow-lg"
    >
      <span className="text-sm text-foreground/80 px-3">
        Apply {changeCount} {changeCount === 1 ? "change" : "changes"}
      </span>
      <Button variant="outline" size="sm" className="rounded-lg" onClick={onDismiss}>
        Details
      </Button>
      <Button size="sm" className="rounded-lg gap-2" onClick={onDeploy}>
        <RocketIcon className="size-3.5" />
        Deploy
        <kbd className="pointer-events-none ml-0.5 inline-flex items-center gap-0.5 rounded border border-primary-foreground/20 bg-primary-foreground/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary-foreground/70">
          ⇧+Enter
        </kbd>
      </Button>
      <Button variant="ghost" size="sm" className="size-7 p-0 rounded-lg text-muted-foreground">
        <EllipsisVerticalIcon className="size-4" />
      </Button>
    </motion.div>
  );
}

// --- Changes dialog ---

interface PendingChange {
  id: string;
  name: string;
  kind: string;
  action: "added" | "modified" | "removed";
  settings: { key: string; oldValue: string; newValue: string }[];
}

function ChangesDialog({
  changes,
  open,
  onOpenChange,
  onDeploy,
  onDiscard,
}: {
  changes: PendingChange[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeploy: () => void;
  onDiscard: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[95vw] !w-[95vw] !h-[92vh] flex flex-col !p-0 !gap-0 !rounded-2xl">
        <DialogHeader className="px-8 pt-8 pb-5 shrink-0">
          <DialogTitle className="text-2xl font-bold">
            {changes.length} {changes.length === 1 ? "change" : "changes"} to apply
          </DialogTitle>
          <DialogDescription className="sr-only">
            Review pending changes before deploying.
          </DialogDescription>
        </DialogHeader>

        {/* Commit message */}
        <div className="px-8 pb-5 shrink-0">
          <Input placeholder="Commit message (optional)" className="h-11 text-base" />
        </div>

        {/* Changes list */}
        <div className="border-t border-border/40 flex-1 overflow-y-auto min-h-0">
          {changes.map((change) => {
            const isExpanded = expanded[change.id] ?? true;
            const kindIcon = kindOptions.find((o) => o.value === change.kind)?.icon ?? GlobeIcon;

            return (
              <div key={change.id} className="border-b border-border/40 last:border-b-0">
                {/* Change header */}
                <button
                  type="button"
                  className="flex w-full items-center gap-4 px-8 py-4 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => setExpanded((prev) => ({ ...prev, [change.id]: !isExpanded }))}
                >
                  <ChevronDownIcon
                    className={`size-5 text-muted-foreground transition-transform ${
                      !isExpanded ? "-rotate-90" : ""
                    }`}
                  />
                  <HugeiconsIcon icon={kindIcon} className="size-6 text-muted-foreground" />
                  <span className="flex-1 text-base">
                    <strong className="text-foreground">{change.name}</strong>{" "}
                    <span className="text-muted-foreground">will be {change.action}</span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {change.settings.length} Settings
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDiscard(change.id);
                    }}
                  >
                    Discard
                  </Button>
                </button>

                {/* Settings table */}
                {isExpanded && change.settings.length > 0 && (
                  <div className="px-8 pb-5">
                    <div className="rounded-xl border border-border/40 overflow-hidden">
                      {/* Table header */}
                      <div className="grid grid-cols-[1.2fr_1fr_1fr_auto] gap-0 bg-muted/30 px-5 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        <span>Change</span>
                        <span>Current Value</span>
                        <span>New Value</span>
                        <span className="w-8" />
                      </div>
                      {/* Rows */}
                      {change.settings.map((setting) => (
                        <div
                          key={setting.key}
                          className="grid grid-cols-[1.2fr_1fr_1fr_auto] gap-0 items-center border-t border-border/30 px-5 py-3.5"
                        >
                          <span className="flex items-center gap-3 text-sm">
                            <PlusIcon className="size-3.5 text-emerald-500 shrink-0" />
                            <Settings2Icon className="size-4 text-muted-foreground shrink-0" />
                            {setting.key}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {setting.oldValue || "—"}
                          </span>
                          <span className="text-sm">
                            {setting.newValue && (
                              <code className="rounded-md bg-emerald-500/15 px-3 py-1.5 text-xs font-mono text-emerald-400">
                                {setting.newValue}
                              </code>
                            )}
                          </span>
                          <button
                            type="button"
                            className="size-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <XIcon className="size-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/40 px-8 py-5 shrink-0">
          <span className="text-sm text-muted-foreground">
            {changes.map((c) => c.name).join(", ")} will redeploy
          </span>
          <Button size="lg" onClick={onDeploy} className="gap-2 text-base px-6">
            <CheckIcon className="size-5" />
            Deploy Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Main layout ---

function RouteComponent() {
  const { projectId } = useParams({ strict: false });

  const [environments] = useQuery(
    projectId ? queries.environmentList({ projectId }) : undefined,
  );
  const firstEnvId = environments?.[0]?.id;

  const [resources] = useQuery(
    firstEnvId ? queries.resourceList({ environmentId: firstEnvId }) : undefined,
  );
  const [links] = useQuery(
    firstEnvId ? queries.resourceLinkList({ environmentId: firstEnvId }) : undefined,
  );

  const { zero } = useRouter().options.context;
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [changesDialogOpen, setChangesDialogOpen] = useState(false);

  const removeResourceRef = useRef<(id: string) => void>(() => {});

  // Find volumes mounted to databases — they render as attachments, not standalone nodes
  const { mountedVolumeIds, volumeAttachments } = useMemo(() => {
    const mounted = new Set<string>();
    const attachments = new Map<string, { id: string; kind: Kind; name: string }[]>();
    if (!resources || !links) return { mountedVolumeIds: mounted, volumeAttachments: attachments };

    for (const link of links) {
      const source = resources.find((r) => r.id === link.sourceResourceId);
      const target = resources.find((r) => r.id === link.targetResourceId);
      let dbId: string | null = null;
      let volume: typeof source | null = null;

      if (source?.kind === "database" && target?.kind === "volume") {
        dbId = source.id;
        volume = target;
      } else if (source?.kind === "volume" && target?.kind === "database") {
        dbId = target.id;
        volume = source;
      }

      if (dbId && volume) {
        mounted.add(volume.id);
        const existing = attachments.get(dbId) ?? [];
        existing.push({ id: volume.id, kind: volume.kind as Kind, name: volume.name });
        attachments.set(dbId, existing);
      }
    }

    return { mountedVolumeIds: mounted, volumeAttachments: attachments };
  }, [resources, links]);

  const graphNodes = useMemo<Node[]>(() => {
    if (!resources) return [];
    return resources
      .filter((r) => !mountedVolumeIds.has(r.id))
      .map((r) => {
        const pending = pendingChanges.find((c) => c.id === r.id);
        const isRemoved = pending?.action === "removed";
        return {
          id: r.id,
          type: "resource" as const,
          position: { x: r.posX ?? 0, y: r.posY ?? 0 },
          draggable: !isRemoved,
          selectable: !isRemoved,
          data: {
            name: r.name,
            kind: r.kind,
            status: r.status ?? "unknown",
            metadata: r.metadata ?? {},
            pendingAction: pending?.action,
            onRemove: (id: string) => removeResourceRef.current(id),
            attachments: volumeAttachments.get(r.id),
          },
        };
      });
  }, [resources, pendingChanges, mountedVolumeIds, volumeAttachments]);

  // Local nodes state for React Flow — synced from Zero, updated locally during drag
  const [nodes, setNodes] = useState<Node[]>([]);
  useEffect(() => {
    setNodes(graphNodes);
  }, [graphNodes]);

  const graphEdges = useMemo(() => {
    if (!links) return [];
    return links
      .filter((l) => !mountedVolumeIds.has(l.sourceResourceId) && !mountedVolumeIds.has(l.targetResourceId))
      .map((l) => ({
        id: l.id,
        source: l.sourceResourceId,
        target: l.targetResourceId,
        type: "smoothstep",
        animated: true,
      }));
  }, [links, mountedVolumeIds]);

  const handleMarkForRemoval = useCallback(
    (id: string) => {
      if (pendingChanges.some((c) => c.id === id)) return;
      const resource = resources?.find((r) => r.id === id);
      if (!resource) return;
      setPendingChanges((prev) => [
        ...prev,
        {
          id: resource.id,
          name: resource.name,
          kind: resource.kind,
          action: "removed",
          settings: [
            { key: "Kind", oldValue: resource.kind, newValue: "" },
            { key: "Name", oldValue: resource.name, newValue: "" },
          ],
        },
      ]);
    },
    [resources, pendingChanges],
  );
  removeResourceRef.current = handleMarkForRemoval;

  const onConnect: OnConnect = useCallback(
    (params) => {
      if (!zero || !firstEnvId) return;
      const id = crypto.randomUUID();
      zero.mutate(
        mutators.resourceLink.create({
          id,
          environmentId: firstEnvId,
          sourceResourceId: params.source,
          targetResourceId: params.target,
          linkType: "depends_on",
        }),
      );
    },
    [zero, firstEnvId],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Apply visual changes (position, selection) locally for smooth drag
      const visualChanges = changes.filter((c) => c.type !== "remove");
      if (visualChanges.length > 0) {
        setNodes((prev) => applyNodeChanges(visualChanges, prev));
      }

      // Persist final position to Zero on drag end
      for (const change of changes) {
        if (change.type === "position" && change.position && !change.dragging && zero) {
          zero.mutate(
            mutators.resource.update({
              id: change.id,
              posX: change.position.x,
              posY: change.position.y,
            }),
          );
        }
        if (change.type === "remove") {
          handleMarkForRemoval(change.id);
        }
      }
    },
    [zero, handleMarkForRemoval],
  );

  const handleResourceCreated = useCallback(
    (resource: { id: string; name: string; kind: string; status: string }) => {
      setPendingChanges((prev) => [
        ...prev,
        {
          id: resource.id,
          name: resource.name,
          kind: resource.kind,
          action: "added",
          settings: [
            { key: "Kind", oldValue: "", newValue: resource.kind },
            { key: "Name", oldValue: "", newValue: resource.name },
            { key: "Status", oldValue: "", newValue: resource.status },
          ],
        },
      ]);
    },
    [],
  );

  const handleDeploy = useCallback(() => {
    if (zero) {
      for (const change of pendingChanges) {
        if (change.action === "removed") {
          zero.mutate(mutators.resource.delete({ id: change.id }));
        }
      }
    }
    // TODO: trigger actual deployment for other changes
    setPendingChanges([]);
    setChangesDialogOpen(false);
  }, [zero, pendingChanges]);

  const handleDiscard = useCallback(
    (id: string) => {
      const change = pendingChanges.find((c) => c.id === id);
      if (change?.action === "added" && zero) {
        zero.mutate(mutators.resource.delete({ id }));
      }
      // For "removed", just undo the mark — resource stays in Zero
      setPendingChanges((prev) => prev.filter((c) => c.id !== id));
    },
    [zero, pendingChanges],
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
            edges={graphEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
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

        {/* Deploy bar — positioned above canvas, outside overflow clip */}
        <AnimatePresence>
          {pendingChanges.length > 0 && (
            <DeployBar
              changeCount={pendingChanges.length}
              onDeploy={handleDeploy}
              onDismiss={() => setChangesDialogOpen(true)}
            />
          )}
        </AnimatePresence>

        {/* Changes dialog */}
        <ChangesDialog
          changes={pendingChanges}
          open={changesDialogOpen}
          onOpenChange={setChangesDialogOpen}
          onDeploy={handleDeploy}
          onDiscard={handleDiscard}
        />

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

# Frontend Rebuild — Plan 2: Project Canvas & Service Drawer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the project canvas — Railway-style React Flow with custom nodes (Group, Service, Database, Volume, Routing), a click-to-open right-side drawer with five tabs, floating canvas controls, a skeleton "+ Add" sheet, and a mini-canvas SVG renderer that Plan 3 will use to make project list cards.

**Architecture:** React Flow's parentNode + custom node types. Drawer is a coss `Sheet` with coss `Tabs` inside; tabs whose backends ship in Plan 4 (Logs, Deployments, Variables) are explicit Empty placeholders tagged with their owning plan. Real data flows via the existing project oRPC surface (`project.get`, `project.database.{listPostgres,getPostgres,createPostgres,deletePostgres}`, `project.proxyRoute.list`). Services and Groups are client-only concepts in v1 (no backend yet) — `ServiceNode` renders fixture data driven by a feature flag for now; `GroupNode` is opt-in, derived from a project-local layout config that defaults to "all databases in one group."

**Tech Stack:** React 19, TanStack Router/Query, oRPC client (`@/utils/orpc`), `@xyflow/react` (already installed), coss UI primitives only, motion/react for micro-animations, lucide-react for icons. **No new deps.**

**Spec:** `docs/superpowers/specs/2026-05-02-frontend-rebuild-design.md` — read §4 (drawers + IA), §6 (Canvas page), §7 (component conventions), §11 (project-flow keep+redesign), §15 (open questions; #1 GroupNode is the live one for this plan).

**Foundation in place:** Plan 1 shipped (`feat/v2-rebuild` branch through commit `5537034`). Tests: 13 green. tsc: clean for `apps/web/src/`. The shell, rails, breadcrumb, env switcher, command palette, and 10 placeholder routes all render under `WorkspaceShell` / `ProjectShell`. The canvas placeholder route at `routes/_dashboard/project/$projectId/index.tsx` is what this plan replaces.

**Out of scope for this plan:**
- Real Logs (Ghostty integration — Plan 4)
- Real Deployments tab content (Plan 4)
- Real Variables tab content (Plan 4)
- Workspace project list redesign (Plan 3 — but the `MiniCanvasPreview` component lands here so Plan 3 can drop it in)
- Service backend / running services for real (the API has no `service.*` router yet — `ServiceNode` is design-only, hidden behind a feature flag that defaults off)
- Group persistence (groups are client-side only in v1; persistence ships when the API gains a `project.layout` resource)
- Metrics tab (v1.1)

---

## File map

```
apps/web/
  src/
    features/
      project-flow/                            ← DELETE (rename to project-canvas; old contents replaced)
      project-canvas/
        types.ts                               ← CREATE (NodeData unions, EdgeData)
        api/
          schema.ts                            ← CREATE (re-exports the relevant project oRPC types)
        hooks/
          use-canvas-nodes.ts                  ← CREATE (derives Node[] from project + databases + proxy routes)
          use-canvas-nodes.test.ts             ← CREATE
        components/
          canvas.tsx                           ← CREATE (the React Flow shell)
          canvas-controls.tsx                  ← CREATE (floating zoom/fit/undo toolbar)
          group-node.tsx                       ← CREATE
          service-node.tsx                     ← CREATE
          database-node.tsx                    ← CREATE (redesign of old DatabaseResource)
          volume-node.tsx                      ← CREATE
          routing-node.tsx                     ← CREATE
          mini-canvas-preview.tsx              ← CREATE (SVG renderer for project-list cards)
          mini-canvas-preview.test.tsx         ← CREATE
        index.ts                               ← CREATE (public exports)
      resource-drawer/
        components/
          resource-drawer.tsx                  ← CREATE (coss Sheet + Tabs container)
          tabs/
            overview-tab.tsx                   ← CREATE (real database content)
            deployments-tab.tsx                ← CREATE (Empty stub for Plan 4)
            variables-tab.tsx                  ← CREATE (Empty stub for Plan 4)
            logs-tab.tsx                       ← CREATE (Empty stub for Plan 4 / Ghostty)
            settings-tab.tsx                   ← CREATE (rename + delete via oRPC)
          tabs/settings-tab.test.tsx           ← CREATE
        hooks/
          use-resource-drawer.ts               ← CREATE (selection state + open/close)
          use-resource-drawer.test.ts          ← CREATE
        types.ts                               ← CREATE
        index.ts                               ← CREATE
      add-resource-sheet/
        components/
          add-resource-sheet.tsx               ← CREATE (skeleton coss Sheet — kinds: github, image, postgres, volume, route)
        types.ts                               ← CREATE
        index.ts                               ← CREATE
    routes/
      _dashboard/
        project/
          $projectId/
            index.tsx                          ← REWRITE (replace canvas placeholder with real <ProjectCanvas/> + drawer + add sheet)
```

---

## Conventions for every task

- **TDD where the unit has logic** (hooks, the resource drawer's selection state, mini-canvas derivation). Pure presentation node components get a smoke test (renders without crashing + has expected text).
- **coss UI strictly.** Compose primitives. Never reimplement Sheet, Tabs, Button, Card, Empty, Toolbar.
- **Feature folder structure** per Plan 1's convention: `features/<feature>/{api,components,hooks,types.ts,index.ts}`.
- **One-line comments only when WHY is non-obvious.**
- **No `Co-Authored-By` trailers** on commits. Plain `git commit -m "..."` (use `-c commit.gpgsign=false` if signing is required).
- **All commits on `feat/v2-rebuild`** (current branch).
- **No new deps.** Don't reach for a new library; the toolset is fixed.
- **`bun run tsc --noEmit` is the type-check signal.** `bun run check-types` has a known pre-existing routeTree-regen quirk; use direct tsc when verifying.

---

## Task 1: Migrate `project-flow` → `project-canvas` & set up types

**Files:**
- Delete: `apps/web/src/features/project-flow/` (entire folder — `database-resource.tsx` and `resource.tsx` are not preserved; this plan rebuilds the nodes)
- Create: `apps/web/src/features/project-canvas/types.ts`
- Create: `apps/web/src/features/project-canvas/api/schema.ts`
- Create: `apps/web/src/features/project-canvas/index.ts`

- [ ] **Step 1: Confirm `project-flow` has no remaining importers**

```bash
cd /Users/jeffersonchukwuka/Developer/playground/otterstack/apps/web && grep -rn "features/project-flow" src/ || echo "clean"
```

If anything matches outside `routeTree.gen.ts`, stop and report NEEDS_CONTEXT — Plan 1's Task 13 should have wiped the only consumer when it rewrote the canvas layout. Anything left is unexpected.

- [ ] **Step 2: Delete the old folder**

```bash
rm -r apps/web/src/features/project-flow
```

- [ ] **Step 3: Create `apps/web/src/features/project-canvas/types.ts`**

```ts
import type { Node, Edge } from "@xyflow/react";

export type CanvasNodeKind = "group" | "service" | "database" | "volume" | "routing";

export type GroupNodeData = {
  kind: "group";
  label: string;
};

export type ServiceNodeData = {
  kind: "service";
  name: string;
  source:
    | { type: "image"; image: string }
    | { type: "github"; repo: string; branch: string };
  status: "running" | "starting" | "stopped" | "missing" | "error";
  publicHostname: string | null;
};

export type DatabaseNodeData = {
  kind: "database";
  resourceId: string;
  name: string;
  engine: "postgres";
  status: "running" | "starting" | "stopped" | "missing" | "error";
  health: "healthy" | "unhealthy" | "starting" | null;
  publicHostname: string;
  internalHostname: string;
  volumeName: string;
};

export type VolumeNodeData = {
  kind: "volume";
  source: string;
  target: string;
};

export type RoutingNodeData = {
  kind: "routing";
  domains: ReadonlyArray<{ domain: string; type: "http" | "layer4" }>;
};

export type CanvasNodeData =
  | GroupNodeData
  | ServiceNodeData
  | DatabaseNodeData
  | VolumeNodeData
  | RoutingNodeData;

export type GroupNode = Node<GroupNodeData, "group">;
export type ServiceNode = Node<ServiceNodeData, "service">;
export type DatabaseNode = Node<DatabaseNodeData, "database">;
export type VolumeNode = Node<VolumeNodeData, "volume">;
export type RoutingNode = Node<RoutingNodeData, "routing">;

export type CanvasNode = GroupNode | ServiceNode | DatabaseNode | VolumeNode | RoutingNode;

export type CanvasEdge = Edge;

/** Selection state managed by the drawer hook. */
export type SelectedResource =
  | { kind: "database"; resourceId: string }
  | { kind: "service"; serviceId: string }
  | null;
```

- [ ] **Step 4: Create `apps/web/src/features/project-canvas/api/schema.ts`**

```ts
import type { client } from "@/utils/orpc";

export type ProjectFromApi = Awaited<ReturnType<typeof client.project.get>>;
export type DatabaseFromApi = Awaited<ReturnType<typeof client.project.database.listPostgres>>[number];
export type ProxyRouteFromApi = Awaited<ReturnType<typeof client.project.proxyRoute.list>>[number];
```

- [ ] **Step 5: Create `apps/web/src/features/project-canvas/index.ts`**

```ts
export type {
  CanvasNode,
  CanvasNodeData,
  CanvasNodeKind,
  CanvasEdge,
  GroupNode,
  ServiceNode,
  DatabaseNode,
  VolumeNode,
  RoutingNode,
  GroupNodeData,
  ServiceNodeData,
  DatabaseNodeData,
  VolumeNodeData,
  RoutingNodeData,
  SelectedResource,
} from "./types";
```

The components and hooks will be added to this barrel by subsequent tasks.

- [ ] **Step 6: Type-check**

```bash
cd apps/web && bun run tsc --noEmit
```

Expected: only the 3 pre-existing `packages/api/src/swarm/postgres.ts` errors. Zero new errors.

- [ ] **Step 7: Regenerate route tree (just to surface anything stale)**

```bash
cd apps/web && bunx tsr generate 2>&1 || echo "tsr quirk — verify via vite dev separately"
```

If the regen fails or produces broken output, ignore — the vite plugin handles it correctly at runtime; the CLI quirk is documented.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features
git -c commit.gpgsign=false commit -m "refactor(web): replace project-flow with project-canvas scaffolding"
```

---

## Task 2: VolumeNode + ServiceNode (small leaf nodes)

**Files:**
- Create: `apps/web/src/features/project-canvas/components/volume-node.tsx`
- Create: `apps/web/src/features/project-canvas/components/service-node.tsx`

These are the simplest two nodes. Both render a small card with an icon + name + status. Volume is even simpler — just a hardware-disk icon and the source path.

- [ ] **Step 1: Create `volume-node.tsx`**

```tsx
import { type NodeProps } from "@xyflow/react";
import { HardDriveIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VolumeNode as VolumeNodeType } from "../types";

export function VolumeNode({ data, selected }: NodeProps<VolumeNodeType>) {
  return (
    <div
      data-canvas-node="volume"
      className={cn(
        "flex w-44 items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 shadow-sm",
        selected ? "border-foreground/30 ring-2 ring-foreground/10" : "border-border",
      )}
    >
      <HardDriveIcon className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate text-[10px] text-muted-foreground">{data.source}</span>
    </div>
  );
}
```

- [ ] **Step 2: Create `service-node.tsx`**

```tsx
import { type NodeProps } from "@xyflow/react";
import { ContainerIcon, GitBranchIcon, GlobeIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ServiceNode as ServiceNodeType } from "../types";

const dotByStatus: Record<ServiceNodeType["data"]["status"], string> = {
  running: "bg-emerald-500",
  starting: "bg-amber-500",
  stopped: "bg-zinc-500",
  missing: "bg-zinc-500",
  error: "bg-rose-500",
};

export function ServiceNode({ data, selected }: NodeProps<ServiceNodeType>) {
  const SourceIcon = data.source.type === "github" ? GitBranchIcon : ContainerIcon;
  const sourceLabel =
    data.source.type === "github" ? `${data.source.repo}@${data.source.branch}` : data.source.image;
  return (
    <div
      data-canvas-node="service"
      className={cn(
        "flex w-52 flex-col gap-1.5 rounded-xl border bg-card px-3 py-3 shadow-sm",
        selected ? "border-foreground/30 ring-2 ring-foreground/10" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <SourceIcon className="size-3.5 text-muted-foreground" />
        <span className="truncate text-xs font-medium">{data.name}</span>
        <span className={cn("ml-auto size-1.5 rounded-full", dotByStatus[data.status])} />
      </div>
      <div className="truncate text-[10px] text-muted-foreground">{sourceLabel}</div>
      {data.publicHostname ? (
        <div className="flex items-center gap-1 truncate text-[10px] text-muted-foreground/80">
          <GlobeIcon className="size-2.5 shrink-0" />
          <span className="truncate">{data.publicHostname}</span>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Export from index.ts**

Add to `apps/web/src/features/project-canvas/index.ts`:

```ts
export { VolumeNode } from "./components/volume-node";
export { ServiceNode } from "./components/service-node";
```

- [ ] **Step 4: Type-check**

```bash
cd apps/web && bun run tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/project-canvas
git -c commit.gpgsign=false commit -m "feat(web): volume and service canvas nodes"
```

---

## Task 3: DatabaseNode + RoutingNode (richer nodes)

**Files:**
- Create: `apps/web/src/features/project-canvas/components/database-node.tsx`
- Create: `apps/web/src/features/project-canvas/components/routing-node.tsx`

- [ ] **Step 1: Create `database-node.tsx`**

```tsx
import { type NodeProps } from "@xyflow/react";
import { DatabaseIcon, GlobeIcon, NetworkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DatabaseNode as DatabaseNodeType } from "../types";

const dotByStatus: Record<DatabaseNodeType["data"]["status"], string> = {
  running: "bg-emerald-500",
  starting: "bg-amber-500",
  stopped: "bg-zinc-500",
  missing: "bg-zinc-500",
  error: "bg-rose-500",
};

function statusLabel(
  status: DatabaseNodeType["data"]["status"],
  health: DatabaseNodeType["data"]["health"],
): string {
  if (status === "running") return health === "healthy" ? "Healthy" : "Running";
  if (status === "starting") return "Starting";
  if (status === "stopped") return "Stopped";
  if (status === "missing") return "Missing";
  return "Error";
}

export function DatabaseNode({ data, selected }: NodeProps<DatabaseNodeType>) {
  return (
    <div
      data-canvas-node="database"
      className={cn(
        "flex w-52 flex-col gap-1.5 rounded-xl border bg-card px-3 py-3 shadow-sm",
        selected ? "border-foreground/30 ring-2 ring-foreground/10" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <DatabaseIcon className="size-3.5 text-muted-foreground" />
        <span className="truncate text-xs font-medium">{data.name}</span>
        <span className={cn("ml-auto size-1.5 rounded-full", dotByStatus[data.status])} />
      </div>
      <div className="text-[10px] text-muted-foreground">{statusLabel(data.status, data.health)}</div>
      <div className="grid gap-0.5 text-[10px] text-muted-foreground/80">
        <div className="flex items-center gap-1">
          <GlobeIcon className="size-2.5 shrink-0" />
          <span className="truncate">{data.publicHostname}</span>
        </div>
        <div className="flex items-center gap-1">
          <NetworkIcon className="size-2.5 shrink-0" />
          <span className="truncate">{data.internalHostname}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `routing-node.tsx`**

```tsx
import { type NodeProps } from "@xyflow/react";
import { Share2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RoutingNode as RoutingNodeType } from "../types";

export function RoutingNode({ data, selected }: NodeProps<RoutingNodeType>) {
  return (
    <div
      data-canvas-node="routing"
      className={cn(
        "flex w-56 flex-col gap-1.5 rounded-xl border bg-card px-3 py-3 shadow-sm",
        selected ? "border-foreground/30 ring-2 ring-foreground/10" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <Share2Icon className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Routing</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {data.domains.length} {data.domains.length === 1 ? "route" : "routes"}
        </span>
      </div>
      {data.domains.length === 0 ? (
        <div className="text-[10px] text-muted-foreground/70">No public domains yet.</div>
      ) : (
        <ul className="grid gap-0.5">
          {data.domains.slice(0, 4).map((d) => (
            <li
              key={d.domain}
              className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/80"
            >
              <span className="truncate">{d.domain}</span>
              <span className="rounded bg-muted px-1 py-px text-[9px] uppercase tracking-wide text-muted-foreground/70">
                {d.type}
              </span>
            </li>
          ))}
          {data.domains.length > 4 ? (
            <li className="text-[10px] text-muted-foreground/60">+{data.domains.length - 4} more</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Export from index.ts**

Append to `apps/web/src/features/project-canvas/index.ts`:

```ts
export { DatabaseNode } from "./components/database-node";
export { RoutingNode } from "./components/routing-node";
```

- [ ] **Step 4: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit
git add apps/web/src/features/project-canvas
git -c commit.gpgsign=false commit -m "feat(web): database and routing canvas nodes"
```

---

## Task 4: GroupNode (titled container with React Flow `parentNode`)

**Files:**
- Create: `apps/web/src/features/project-canvas/components/group-node.tsx`

The GroupNode is a titled container that lays out its children. We rely on React Flow's `parentNode` mechanism — children declare a `parentNode: <groupId>` and `extent: "parent"` so they live inside the group's bounding box. The group node itself is a styled rectangle with a header.

- [ ] **Step 1: Create `group-node.tsx`**

```tsx
import { type NodeProps } from "@xyflow/react";
import { LayersIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GroupNode as GroupNodeType } from "../types";

export function GroupNode({ data, selected }: NodeProps<GroupNodeType>) {
  return (
    <div
      data-canvas-node="group"
      className={cn(
        "h-full w-full rounded-2xl border-2 border-dashed bg-muted/20 p-3",
        selected ? "border-foreground/30" : "border-border/50",
      )}
    >
      <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
        <LayersIcon className="size-3" />
        <span>{data.label}</span>
      </div>
      {/* Children are rendered separately by React Flow when their parentNode is set; this div is purely the visual container. */}
    </div>
  );
}
```

- [ ] **Step 2: Export from index.ts**

```ts
export { GroupNode } from "./components/group-node";
```

- [ ] **Step 3: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit
git add apps/web/src/features/project-canvas
git -c commit.gpgsign=false commit -m "feat(web): group canvas node (parentNode container)"
```

---

## Task 5: `useCanvasNodes` hook (derives Node[] from oRPC data) + tests

**Files:**
- Create: `apps/web/src/features/project-canvas/hooks/use-canvas-nodes.ts`
- Create: `apps/web/src/features/project-canvas/hooks/use-canvas-nodes.test.ts`

This hook is the single source of truth that turns API data into `CanvasNode[]`. Pure logic, easy to TDD.

For Plan 2 v1, the hook produces:
- One `RoutingNode` per project (always at top-right) summarizing the project's enabled HTTP/layer4 routes.
- One `GroupNode` per project labeled "data" containing all databases.
- One `DatabaseNode` per Postgres resource (parented to the data group).
- One `VolumeNode` per database (sibling to the database, just below it, parented to the data group).
- No services in v1 (the API has no service router; ServiceNode is exported and the canvas page accepts service fixtures via prop, but the hook returns none).

Layout: simple grid. Group at `(40, 40)` sized `(360, 480)`. Databases at `(20, 50 + i*180)` inside the group. Volumes at `(20, 130 + i*180)` inside the group. Routing at `(440, 40)`.

- [ ] **Step 1: Failing test `use-canvas-nodes.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { useCanvasNodes } from "./use-canvas-nodes";
import type { DatabaseFromApi, ProxyRouteFromApi } from "../api/schema";

function makeDatabase(over: Partial<DatabaseFromApi> = {}): DatabaseFromApi {
  return {
    resourceId: "res_1",
    projectId: "proj_1",
    name: "primary",
    type: "database",
    status: "valid",
    engine: "postgres",
    databaseName: "app",
    username: "admin",
    password: "secret",
    publicHostname: "primary.proj1.local",
    publicPort: 5432,
    publicConnectionString: "postgres://...",
    internalHostname: "primary.internal",
    internalPort: 5432,
    internalConnectionString: "postgres://...",
    localConnectionString: null,
    upstreamHost: "primary",
    upstreamPort: 5432,
    runtime: {
      serviceId: "svc",
      serviceName: "primary",
      volumeName: "primary-data",
      networkName: "proj1",
      status: "running",
      health: "healthy",
    },
    ...over,
  } as DatabaseFromApi;
}

function makeRoute(over: Partial<ProxyRouteFromApi> = {}): ProxyRouteFromApi {
  return {
    id: "rt_1",
    projectId: "proj_1",
    resourceId: null,
    type: "http",
    domain: "app.example.com",
    upstreamHost: "primary",
    upstreamPort: 5432,
    protocol: "http",
    layer4Alpn: null,
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("useCanvasNodes", () => {
  it("emits a routing node, a data group, and one database+volume per database", () => {
    const { nodes } = useCanvasNodes({
      databases: [makeDatabase()],
      proxyRoutes: [makeRoute()],
    });
    const kinds = nodes.map((n) => n.type);
    expect(kinds.filter((k) => k === "routing")).toHaveLength(1);
    expect(kinds.filter((k) => k === "group")).toHaveLength(1);
    expect(kinds.filter((k) => k === "database")).toHaveLength(1);
    expect(kinds.filter((k) => k === "volume")).toHaveLength(1);
  });

  it("parents database and volume nodes to the data group", () => {
    const { nodes } = useCanvasNodes({
      databases: [makeDatabase({ resourceId: "res_a" }), makeDatabase({ resourceId: "res_b", name: "secondary" })],
      proxyRoutes: [],
    });
    const group = nodes.find((n) => n.type === "group");
    expect(group).toBeDefined();
    const databases = nodes.filter((n) => n.type === "database");
    const volumes = nodes.filter((n) => n.type === "volume");
    expect(databases.every((n) => n.parentId === group!.id)).toBe(true);
    expect(volumes.every((n) => n.parentId === group!.id)).toBe(true);
  });

  it("when no databases, still emits a routing node and an empty group", () => {
    const { nodes } = useCanvasNodes({ databases: [], proxyRoutes: [] });
    expect(nodes.find((n) => n.type === "routing")).toBeDefined();
    expect(nodes.find((n) => n.type === "group")).toBeDefined();
    expect(nodes.find((n) => n.type === "database")).toBeUndefined();
  });

  it("the routing node summarizes enabled http+layer4 domains", () => {
    const { nodes } = useCanvasNodes({
      databases: [],
      proxyRoutes: [makeRoute({ domain: "a.example.com", type: "http" }), makeRoute({ id: "rt_2", domain: "b.example.com", type: "layer4" })],
    });
    const routing = nodes.find((n) => n.type === "routing");
    expect(routing).toBeDefined();
    const data = routing!.data as { domains: ReadonlyArray<{ domain: string; type: "http" | "layer4" }> };
    expect(data.domains).toHaveLength(2);
    expect(data.domains.map((d) => d.domain).sort()).toEqual(["a.example.com", "b.example.com"]);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd apps/web && bun run test src/features/project-canvas/hooks/use-canvas-nodes.test.ts
```

- [ ] **Step 3: Implement `use-canvas-nodes.ts`**

```ts
import type { CanvasNode } from "../types";
import type { DatabaseFromApi, ProxyRouteFromApi } from "../api/schema";

const GROUP_ID = "group:data";
const ROUTING_ID = "node:routing";
const GROUP_POSITION = { x: 40, y: 40 } as const;
const ROUTING_POSITION = { x: 440, y: 40 } as const;
const DATABASE_INNER_X = 20;
const VOLUME_INNER_X = 20;
const ROW_HEIGHT = 180;

type Input = {
  databases: ReadonlyArray<DatabaseFromApi>;
  proxyRoutes: ReadonlyArray<ProxyRouteFromApi>;
};

export function useCanvasNodes(input: Input): { nodes: CanvasNode[] } {
  const { databases, proxyRoutes } = input;
  const groupHeight = Math.max(200, databases.length * ROW_HEIGHT + 60);

  const group: CanvasNode = {
    id: GROUP_ID,
    type: "group",
    position: GROUP_POSITION,
    data: { kind: "group", label: "data" },
    style: { width: 360, height: groupHeight },
  };

  const routing: CanvasNode = {
    id: ROUTING_ID,
    type: "routing",
    position: ROUTING_POSITION,
    data: {
      kind: "routing",
      domains: proxyRoutes
        .filter((r) => r.enabled)
        .map((r) => ({ domain: r.domain, type: r.type })),
    },
  };

  const dbAndVolumeNodes: CanvasNode[] = databases.flatMap((database, index) => {
    const databaseId = `db:${database.resourceId}`;
    const volumeId = `vol:${database.resourceId}`;
    const dbY = 50 + index * ROW_HEIGHT;
    const volumeY = dbY + 90;
    const dbNode: CanvasNode = {
      id: databaseId,
      type: "database",
      parentId: GROUP_ID,
      extent: "parent",
      position: { x: DATABASE_INNER_X, y: dbY },
      data: {
        kind: "database",
        resourceId: database.resourceId,
        name: database.name,
        engine: "postgres",
        status: database.runtime.status,
        health: database.runtime.health,
        publicHostname: database.publicHostname,
        internalHostname: database.internalHostname,
        volumeName: database.runtime.volumeName,
      },
    };
    const volumeNode: CanvasNode = {
      id: volumeId,
      type: "volume",
      parentId: GROUP_ID,
      extent: "parent",
      position: { x: VOLUME_INNER_X, y: volumeY },
      data: {
        kind: "volume",
        source: database.runtime.volumeName,
        target: "/var/lib/postgresql/data",
      },
    };
    return [dbNode, volumeNode];
  });

  return { nodes: [group, routing, ...dbAndVolumeNodes] };
}
```

- [ ] **Step 4: Run tests — expect 4 passing**

```bash
cd apps/web && bun run test src/features/project-canvas/hooks/use-canvas-nodes.test.ts
```

- [ ] **Step 5: Add to index.ts barrel**

Append to `apps/web/src/features/project-canvas/index.ts`:

```ts
export { useCanvasNodes } from "./hooks/use-canvas-nodes";
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/project-canvas
git -c commit.gpgsign=false commit -m "feat(web): canvas node derivation hook with tests"
```

---

## Task 6: CanvasControls (floating zoom/fit/undo toolbar)

**Files:**
- Create: `apps/web/src/features/project-canvas/components/canvas-controls.tsx`

Floating bottom-left controls. Uses React Flow's `useReactFlow()` for zoom/fit. Undo is a no-op stub for v1 (we don't yet have a history layer); rendered for visual completeness, calls an optional `onUndo` if passed.

- [ ] **Step 1: Create `canvas-controls.tsx`**

```tsx
import { useReactFlow } from "@xyflow/react";
import {
  MaximizeIcon,
  MinusIcon,
  PlusIcon,
  RotateCcwIcon,
} from "lucide-react";
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@/components/ui/toolbar";

type Props = {
  onUndo?: () => void;
};

export function CanvasControls({ onUndo }: Props) {
  const flow = useReactFlow();
  return (
    <Toolbar className="absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg border bg-background/90 p-1 shadow-sm backdrop-blur">
      <ToolbarButton aria-label="Zoom in" onClick={() => flow.zoomIn()}>
        <PlusIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton aria-label="Zoom out" onClick={() => flow.zoomOut()}>
        <MinusIcon className="size-4" />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton aria-label="Fit view" onClick={() => flow.fitView({ padding: 0.2 })}>
        <MaximizeIcon className="size-4" />
      </ToolbarButton>
      {onUndo ? (
        <>
          <ToolbarSeparator />
          <ToolbarButton aria-label="Undo" onClick={onUndo}>
            <RotateCcwIcon className="size-4" />
          </ToolbarButton>
        </>
      ) : null}
    </Toolbar>
  );
}
```

- [ ] **Step 2: Verify coss Toolbar primitives**

```bash
grep -n "^export" /Users/jeffersonchukwuka/Developer/playground/otterstack/apps/web/src/components/ui/toolbar.tsx
```

If `ToolbarButton` or `ToolbarSeparator` aren't exported, open the file and adapt. Common alternatives: `Toolbar`, `Toolbar.Button` (compound), or just `Button` inside a styled `Toolbar`. Keep behavior intact (zoom/fit calls flow methods; aria-labels for accessibility).

- [ ] **Step 3: Export + commit**

Append to `apps/web/src/features/project-canvas/index.ts`:
```ts
export { CanvasControls } from "./components/canvas-controls";
```

```bash
cd apps/web && bun run tsc --noEmit
git add apps/web/src/features/project-canvas
git -c commit.gpgsign=false commit -m "feat(web): floating canvas controls (zoom/fit/undo)"
```

---

## Task 7: Canvas component (React Flow shell wiring node types)

**Files:**
- Create: `apps/web/src/features/project-canvas/components/canvas.tsx`

The canvas component takes nodes + edges + selection callbacks and renders a React Flow with the registered node types and the floating controls.

- [ ] **Step 1: Create `canvas.tsx`**

```tsx
import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { CanvasControls } from "./canvas-controls";
import { DatabaseNode } from "./database-node";
import { GroupNode } from "./group-node";
import { RoutingNode } from "./routing-node";
import { ServiceNode } from "./service-node";
import { VolumeNode } from "./volume-node";
import type { CanvasNode } from "../types";

const nodeTypes: NodeTypes = {
  group: GroupNode,
  service: ServiceNode,
  database: DatabaseNode,
  volume: VolumeNode,
  routing: RoutingNode,
};

type Props = {
  nodes: ReadonlyArray<CanvasNode>;
  selectedNodeId: string | null;
  onSelectNode: (node: CanvasNode | null) => void;
};

function CanvasInner({ nodes, selectedNodeId, onSelectNode }: Props) {
  const decoratedNodes = useMemo<Node[]>(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedNodeId })),
    [nodes, selectedNodeId],
  );

  const handleNodeClick: NodeMouseHandler = (_, node) => {
    onSelectNode((node as CanvasNode) ?? null);
  };

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={decoratedNodes}
        nodeTypes={nodeTypes}
        edges={[]}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={handleNodeClick}
        onPaneClick={() => onSelectNode(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={14} size={1} />
        <CanvasControls />
      </ReactFlow>
    </div>
  );
}

export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
```

- [ ] **Step 2: Export + tsc**

Append to `apps/web/src/features/project-canvas/index.ts`:
```ts
export { Canvas } from "./components/canvas";
```

```bash
cd apps/web && bun run tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/project-canvas
git -c commit.gpgsign=false commit -m "feat(web): canvas shell with registered node types"
```

---

## Task 8: ResourceDrawer — `useResourceDrawer` hook + tests

**Files:**
- Create: `apps/web/src/features/resource-drawer/types.ts`
- Create: `apps/web/src/features/resource-drawer/hooks/use-resource-drawer.ts`
- Create: `apps/web/src/features/resource-drawer/hooks/use-resource-drawer.test.ts`

The drawer hook owns selection state. Selecting a resource opens; clearing closes.

- [ ] **Step 1: Create `types.ts`**

```ts
export type DrawerSelection =
  | { kind: "database"; resourceId: string; projectId: string }
  | null;
```

- [ ] **Step 2: Failing test `use-resource-drawer.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useResourceDrawer } from "./use-resource-drawer";

describe("useResourceDrawer", () => {
  it("starts closed with no selection", () => {
    const { result } = renderHook(() => useResourceDrawer());
    expect(result.current.open).toBe(false);
    expect(result.current.selection).toBeNull();
  });

  it("selecting a resource opens the drawer", () => {
    const { result } = renderHook(() => useResourceDrawer());
    act(() => result.current.select({ kind: "database", resourceId: "res_1", projectId: "proj_1" }));
    expect(result.current.open).toBe(true);
    expect(result.current.selection).toEqual({ kind: "database", resourceId: "res_1", projectId: "proj_1" });
  });

  it("close() clears the selection", () => {
    const { result } = renderHook(() => useResourceDrawer());
    act(() => result.current.select({ kind: "database", resourceId: "res_1", projectId: "proj_1" }));
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
    expect(result.current.selection).toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect fail**

```bash
cd apps/web && bun run test src/features/resource-drawer
```

- [ ] **Step 4: Implement `use-resource-drawer.ts`**

```ts
import { useCallback, useState } from "react";
import type { DrawerSelection } from "../types";

export function useResourceDrawer(): {
  selection: DrawerSelection;
  open: boolean;
  select: (next: DrawerSelection) => void;
  close: () => void;
} {
  const [selection, setSelection] = useState<DrawerSelection>(null);
  const select = useCallback((next: DrawerSelection) => setSelection(next), []);
  const close = useCallback(() => setSelection(null), []);
  return { selection, open: selection !== null, select, close };
}
```

- [ ] **Step 5: Run — expect 3 passing**

- [ ] **Step 6: Create the barrel `apps/web/src/features/resource-drawer/index.ts` with the exports we have so far**

```ts
export { useResourceDrawer } from "./hooks/use-resource-drawer";
export type { DrawerSelection } from "./types";
```

(Task 11 appends the `ResourceDrawer` export here once the container is built.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/resource-drawer
git -c commit.gpgsign=false commit -m "feat(web): resource-drawer selection hook with tests"
```

---

## Task 9: Drawer tabs — Overview, stub Deployments/Variables/Logs

**Files:**
- Create: `apps/web/src/features/resource-drawer/components/tabs/overview-tab.tsx`
- Create: `apps/web/src/features/resource-drawer/components/tabs/deployments-tab.tsx`
- Create: `apps/web/src/features/resource-drawer/components/tabs/variables-tab.tsx`
- Create: `apps/web/src/features/resource-drawer/components/tabs/logs-tab.tsx`

Overview is real (uses oRPC `project.database.getPostgres`). The other three are Empty stubs explicitly tagged for Plan 4.

- [ ] **Step 1: Create `overview-tab.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { Database, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { client } from "@/utils/orpc";

type Props = {
  projectId: string;
  resourceId: string;
};

export function OverviewTab({ projectId, resourceId }: Props) {
  const query = useQuery({
    queryKey: ["project-database", projectId, resourceId],
    queryFn: () => client.project.database.getPostgres({ projectId, resourceId }),
  });

  if (query.isLoading) {
    return (
      <div className="grid gap-3 p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Alert variant="error" className="m-4">
        <AlertCircle />
        <AlertTitle>Couldn't load database</AlertTitle>
        <AlertDescription>{query.error instanceof Error ? query.error.message : "Unknown error"}</AlertDescription>
      </Alert>
    );
  }

  const db = query.data;
  return (
    <div className="grid gap-4 p-4">
      <div className="flex items-center gap-2">
        <Database className="size-4" />
        <span className="text-sm font-medium">{db.name}</span>
        <Badge className="ml-auto" variant={db.runtime.status === "running" ? "success" : "warning"}>
          {db.runtime.status}
        </Badge>
      </div>

      <Field label="Public host" value={`${db.publicHostname}:${db.publicPort}`} />
      <Field label="Internal host" value={`${db.internalHostname}:${db.internalPort}`} />
      <Field label="Username" value={db.username} />
      <CodeBlock label="Public connection string" value={db.publicConnectionString} />
      <CodeBlock label="Internal connection string" value={db.internalConnectionString} />
      {db.localConnectionString ? (
        <CodeBlock label="Local connection string" value={db.localConnectionString} />
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <code className="break-all rounded bg-muted px-2 py-1 text-xs">{value}</code>
    </div>
  );
}

function CodeBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <pre className="overflow-x-auto rounded bg-muted px-2 py-2 text-[11px] leading-5">
        <code>{value}</code>
      </pre>
    </div>
  );
}
```

- [ ] **Step 2: Create `deployments-tab.tsx`**

```tsx
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export function DeploymentsTab() {
  return (
    <div className="grid place-items-center p-8">
      <Empty>
        <EmptyTitle>Deployments</EmptyTitle>
        <EmptyDescription>Deployment history per resource lands in Plan 4.</EmptyDescription>
      </Empty>
    </div>
  );
}
```

- [ ] **Step 3: Create `variables-tab.tsx`**

```tsx
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export function VariablesTab() {
  return (
    <div className="grid place-items-center p-8">
      <Empty>
        <EmptyTitle>Variables</EmptyTitle>
        <EmptyDescription>Shared and resource-scoped env vars land in Plan 4.</EmptyDescription>
      </Empty>
    </div>
  );
}
```

- [ ] **Step 4: Create `logs-tab.tsx`**

```tsx
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export function LogsTab() {
  return (
    <div className="grid place-items-center p-8">
      <Empty>
        <EmptyTitle>Logs</EmptyTitle>
        <EmptyDescription>Live log tail (Ghostty terminal) lands in Plan 4.</EmptyDescription>
      </Empty>
    </div>
  );
}
```

- [ ] **Step 5: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit
git add apps/web/src/features/resource-drawer
git -c commit.gpgsign=false commit -m "feat(web): drawer overview tab + stub tabs (deployments/variables/logs)"
```

---

## Task 10: Drawer Settings tab — rename + delete via oRPC

**Files:**
- Create: `apps/web/src/features/resource-drawer/components/tabs/settings-tab.tsx`
- Create: `apps/web/src/features/resource-drawer/components/tabs/settings-tab.test.tsx`

For Plan 2, "Settings" is just **delete** (rename isn't in the API yet — `database.updatePostgres` doesn't exist). Show the resource name (read-only for now), a deletion-with-confirmation flow using coss `AlertDialog`. Test the delete-confirmation interaction.

- [ ] **Step 1: Failing test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsTab } from "./settings-tab";

vi.mock("@/utils/orpc", () => ({
  client: {
    project: {
      database: {
        deletePostgres: vi.fn().mockResolvedValue({ ok: true }),
      },
    },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("SettingsTab", () => {
  it("requires confirmation before deleting", async () => {
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    render(<SettingsTab projectId="proj_1" resourceId="res_1" name="primary" onDeleted={onDeleted} />, { wrapper });
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("calls deletePostgres and onDeleted on confirm", async () => {
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    const { client } = await import("@/utils/orpc");
    render(<SettingsTab projectId="proj_1" resourceId="res_1" name="primary" onDeleted={onDeleted} />, { wrapper });
    await user.click(screen.getByRole("button", { name: /delete/i }));
    const confirm = await screen.findByRole("button", { name: /delete database/i });
    await user.click(confirm);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect((client as any).project.database.deletePostgres).toHaveBeenCalledWith({
      projectId: "proj_1",
      resourceId: "res_1",
    });
  });
});
```

- [ ] **Step 2: Implement `settings-tab.tsx`**

```tsx
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { TrashIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { client } from "@/utils/orpc";

type Props = {
  projectId: string;
  resourceId: string;
  name: string;
  onDeleted: () => void;
};

export function SettingsTab({ projectId, resourceId, name, onDeleted }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => client.project.database.deletePostgres({ projectId, resourceId }),
    onSuccess: () => {
      setConfirmOpen(false);
      onDeleted();
    },
  });

  return (
    <div className="grid gap-6 p-4">
      <Field>
        <FieldLabel>Name</FieldLabel>
        <Input value={name} disabled />
        <p className="mt-1 text-[10px] text-muted-foreground">Renaming lands when the API gains an update endpoint.</p>
      </Field>

      <div className="grid gap-2 rounded-lg border border-destructive/30 p-4">
        <div className="text-sm font-medium text-destructive-foreground">Danger zone</div>
        <p className="text-xs text-muted-foreground">
          Deleting this database removes the Swarm service, the underlying volume, and any proxy routes pointing at it.
        </p>
        <Button variant="destructive" onClick={() => setConfirmOpen(true)} className="w-fit">
          <TrashIcon className="size-4" />
          Delete
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(next) => setConfirmOpen(next)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete database "{name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the Swarm service, its volume, and any associated proxy routes. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete database"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
```

If the coss `AlertDialog` API uses different sub-component names, adapt while keeping the test's `getByRole("alertdialog")` and `getByRole("button", { name: /delete database/i })` queries working.

- [ ] **Step 3: Run tests — expect 2 passing**

```bash
cd apps/web && bun run test src/features/resource-drawer/components/tabs
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/resource-drawer
git -c commit.gpgsign=false commit -m "feat(web): drawer settings tab with delete-with-confirmation"
```

---

## Task 11: ResourceDrawer container

**Files:**
- Create: `apps/web/src/features/resource-drawer/components/resource-drawer.tsx`
- Modify: `apps/web/src/features/resource-drawer/index.ts`

Composes the coss `Sheet` with coss `Tabs` mounting the five tab components. Closing the sheet calls `onClose`.

- [ ] **Step 1: Create `resource-drawer.tsx`**

```tsx
import { Sheet, SheetPopup, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTab, TabsPanel } from "@/components/ui/tabs";
import { OverviewTab } from "./tabs/overview-tab";
import { DeploymentsTab } from "./tabs/deployments-tab";
import { VariablesTab } from "./tabs/variables-tab";
import { LogsTab } from "./tabs/logs-tab";
import { SettingsTab } from "./tabs/settings-tab";
import type { DrawerSelection } from "../types";

type Props = {
  open: boolean;
  selection: DrawerSelection;
  onClose: () => void;
  onDeleted: () => void;
  /** Display label for the drawer header (the resource's user-visible name). */
  resourceName: string;
};

export function ResourceDrawer({ open, selection, onClose, onDeleted, resourceName }: Props) {
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetPopup side="right" className="w-[480px] p-0 sm:max-w-none">
        {selection ? (
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b">
              <SheetTitle>{resourceName}</SheetTitle>
              <SheetDescription>
                {selection.kind === "database" ? "Postgres database" : "Resource"}
              </SheetDescription>
            </SheetHeader>
            <Tabs defaultValue="overview" className="flex flex-1 flex-col overflow-hidden">
              <TabsList className="border-b px-3">
                <TabsTab value="overview">Overview</TabsTab>
                <TabsTab value="deployments">Deployments</TabsTab>
                <TabsTab value="variables">Variables</TabsTab>
                <TabsTab value="logs">Logs</TabsTab>
                <TabsTab value="settings">Settings</TabsTab>
              </TabsList>
              <TabsPanel value="overview" className="flex-1 overflow-y-auto">
                {selection.kind === "database" ? (
                  <OverviewTab projectId={selection.projectId} resourceId={selection.resourceId} />
                ) : null}
              </TabsPanel>
              <TabsPanel value="deployments" className="flex-1 overflow-y-auto">
                <DeploymentsTab />
              </TabsPanel>
              <TabsPanel value="variables" className="flex-1 overflow-y-auto">
                <VariablesTab />
              </TabsPanel>
              <TabsPanel value="logs" className="flex-1 overflow-y-auto">
                <LogsTab />
              </TabsPanel>
              <TabsPanel value="settings" className="flex-1 overflow-y-auto">
                {selection.kind === "database" ? (
                  <SettingsTab
                    projectId={selection.projectId}
                    resourceId={selection.resourceId}
                    name={resourceName}
                    onDeleted={onDeleted}
                  />
                ) : null}
              </TabsPanel>
            </Tabs>
          </div>
        ) : null}
      </SheetPopup>
    </Sheet>
  );
}
```

If coss `Tabs` exports differ (e.g. `TabsTrigger` instead of `TabsTab`, `TabsContent` instead of `TabsPanel`), adapt to actual API. Keep the same five-tab structure.

- [ ] **Step 2: Update `index.ts`**

```ts
export { ResourceDrawer } from "./components/resource-drawer";
export { useResourceDrawer } from "./hooks/use-resource-drawer";
export type { DrawerSelection } from "./types";
```

- [ ] **Step 3: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit
git add apps/web/src/features/resource-drawer
git -c commit.gpgsign=false commit -m "feat(web): resource drawer container with 5 tabs"
```

---

## Task 12: AddResourceSheet skeleton

**Files:**
- Create: `apps/web/src/features/add-resource-sheet/types.ts`
- Create: `apps/web/src/features/add-resource-sheet/components/add-resource-sheet.tsx`
- Create: `apps/web/src/features/add-resource-sheet/index.ts`

For Plan 2, this is the "+ Add" panel triggered from the canvas's top-right button. It exposes a list of options (postgres database, github service, image service, volume, route). Only "postgres database" is wired to a real action (calls `project.database.createPostgres` and closes the sheet); the others render Empty stubs with which Plan tag.

- [ ] **Step 1: Create `types.ts`**

```ts
export type AddResourceKind =
  | "postgres-database"
  | "github-service"
  | "image-service"
  | "volume"
  | "route";
```

- [ ] **Step 2: Create `add-resource-sheet.tsx`**

```tsx
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ContainerIcon, DatabaseIcon, GitBranchIcon, HardDriveIcon, Share2Icon } from "lucide-react";
import { Sheet, SheetPopup, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { client, queryClient } from "@/utils/orpc";
import type { AddResourceKind } from "../types";

type Option = { kind: AddResourceKind; label: string; description: string; icon: typeof DatabaseIcon };

const options: ReadonlyArray<Option> = [
  { kind: "postgres-database", label: "Postgres database", description: "A managed Postgres resource attached to this project.", icon: DatabaseIcon },
  { kind: "github-service", label: "GitHub service", description: "Build and deploy from a GitHub repo. Lands in Plan 4.", icon: GitBranchIcon },
  { kind: "image-service", label: "Image service", description: "Deploy a Docker image. Lands in Plan 4.", icon: ContainerIcon },
  { kind: "volume", label: "Volume", description: "Standalone persistent volume. Lands in Plan 4.", icon: HardDriveIcon },
  { kind: "route", label: "Route", description: "Add a custom domain or layer4 route. Lands in Plan 4.", icon: Share2Icon },
];

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  projectId: string;
};

export function AddResourceSheet({ open, onOpenChange, projectId }: Props) {
  const [selected, setSelected] = useState<AddResourceKind | null>(null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup side="right" className="w-[480px]">
        <SheetHeader>
          <SheetTitle>Add to canvas</SheetTitle>
          <SheetDescription>Pick what you want to provision in this project.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 p-4">
          {selected === null ? (
            <ul className="grid gap-2">
              {options.map((option) => {
                const Icon = option.icon;
                return (
                  <li key={option.kind}>
                    <button
                      type="button"
                      onClick={() => setSelected(option.kind)}
                      className="flex w-full items-start gap-3 rounded-lg border bg-card px-3 py-3 text-left hover:bg-accent"
                    >
                      <Icon className="mt-0.5 size-4 text-muted-foreground" />
                      <div className="grid gap-0.5">
                        <div className="text-sm font-medium">{option.label}</div>
                        <div className="text-[11px] text-muted-foreground">{option.description}</div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : selected === "postgres-database" ? (
            <PostgresForm
              projectId={projectId}
              onCancel={() => setSelected(null)}
              onCreated={() => {
                setSelected(null);
                onOpenChange(false);
              }}
            />
          ) : (
            <Empty>
              <EmptyTitle>{options.find((o) => o.kind === selected)?.label}</EmptyTitle>
              <EmptyDescription>This resource kind lands in Plan 4.</EmptyDescription>
              <Button variant="outline" onClick={() => setSelected(null)} className="mt-3 w-fit">
                Back
              </Button>
            </Empty>
          )}
        </div>
      </SheetPopup>
    </Sheet>
  );
}

function PostgresForm({ projectId, onCancel, onCreated }: { projectId: string; onCancel: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const mutation = useMutation({
    mutationFn: () => client.project.database.createPostgres({ projectId, name: name.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-databases", projectId] });
      setName("");
      onCreated();
    },
  });
  const errorMessage = mutation.error instanceof Error ? mutation.error.message : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || mutation.isPending) return;
        mutation.mutate();
      }}
      className="grid gap-4"
    >
      <Field>
        <FieldLabel htmlFor="db-name">Database name</FieldLabel>
        <Input id="db-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="primary" />
      </Field>
      {errorMessage ? (
        <Alert variant="error">
          <AlertCircle />
          <AlertTitle>Couldn't create database</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={!name.trim() || mutation.isPending}>
          {mutation.isPending ? "Creating…" : "Create database"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Create `index.ts`**

```ts
export { AddResourceSheet } from "./components/add-resource-sheet";
export type { AddResourceKind } from "./types";
```

- [ ] **Step 4: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit
git add apps/web/src/features/add-resource-sheet
git -c commit.gpgsign=false commit -m "feat(web): + Add resource sheet with postgres create flow"
```

---

## Task 13: MiniCanvasPreview SVG component + tests

**Files:**
- Create: `apps/web/src/features/project-canvas/components/mini-canvas-preview.tsx`
- Create: `apps/web/src/features/project-canvas/components/mini-canvas-preview.test.tsx`

A static SVG renderer used by Plan 3's project list cards to show a project's shape at a glance. It takes the same `databases` + `proxyRoutes` data the canvas uses and renders a 120×80 SVG with abstract shapes (one rectangle per database, one circle for routing if any routes enabled).

- [ ] **Step 1: Failing test**

```tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MiniCanvasPreview } from "./mini-canvas-preview";

describe("MiniCanvasPreview", () => {
  it("renders empty state when nothing is configured", () => {
    const { container } = render(<MiniCanvasPreview databases={0} routes={0} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector('[data-mini="empty"]')).toBeInTheDocument();
  });

  it("renders one rect per database (capped at 4)", () => {
    const { container } = render(<MiniCanvasPreview databases={6} routes={1} />);
    expect(container.querySelectorAll('rect[data-mini="database"]').length).toBe(4);
    expect(container.querySelector('[data-mini="overflow"]')).toHaveTextContent("+2");
  });

  it("renders a routing circle when there's at least one route", () => {
    const { container } = render(<MiniCanvasPreview databases={1} routes={1} />);
    expect(container.querySelector('[data-mini="routing"]')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement `mini-canvas-preview.tsx`**

```tsx
import { useId } from "react";

type Props = {
  databases: number;
  routes: number;
  className?: string;
};

const MAX_DATABASE_RECTS = 4;

export function MiniCanvasPreview({ databases, routes, className }: Props) {
  // Unique pattern ID per instance so multiple previews on one page (Plan 3 project list) don't collide.
  const reactId = useId();
  const dotPatternId = `mini-dots-${reactId}`;
  const visible = Math.min(databases, MAX_DATABASE_RECTS);
  const overflow = Math.max(0, databases - MAX_DATABASE_RECTS);
  const hasContent = databases > 0 || routes > 0;
  return (
    <svg viewBox="0 0 120 80" className={className} role="img" aria-label="Project canvas preview">
      <defs>
        <pattern id={dotPatternId} width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.6" fill="currentColor" opacity="0.18" />
        </pattern>
      </defs>
      <rect width="120" height="80" fill={`url(#${dotPatternId})`} className="text-muted-foreground" />
      {!hasContent ? (
        <text
          data-mini="empty"
          x="60"
          y="44"
          textAnchor="middle"
          fontSize="9"
          fill="currentColor"
          className="text-muted-foreground"
        >
          empty
        </text>
      ) : (
        <>
          {Array.from({ length: visible }).map((_, i) => (
            <rect
              key={i}
              data-mini="database"
              x={10 + i * 18}
              y={28}
              width={14}
              height={24}
              rx={3}
              fill="currentColor"
              className="text-foreground/70"
            />
          ))}
          {overflow > 0 ? (
            <text
              data-mini="overflow"
              x={10 + visible * 18 + 4}
              y={42}
              fontSize="8"
              fill="currentColor"
              className="text-muted-foreground"
            >
              +{overflow}
            </text>
          ) : null}
          {routes > 0 ? (
            <circle data-mini="routing" cx={104} cy={16} r={5} fill="currentColor" className="text-amber-500" />
          ) : null}
        </>
      )}
    </svg>
  );
}
```

- [ ] **Step 3: Run tests — expect 3 passing**

```bash
cd apps/web && bun run test src/features/project-canvas/components/mini-canvas-preview.test.tsx
```

- [ ] **Step 4: Export + commit**

Append to `apps/web/src/features/project-canvas/index.ts`:
```ts
export { MiniCanvasPreview } from "./components/mini-canvas-preview";
```

```bash
cd apps/web && bun run tsc --noEmit
git add apps/web/src/features/project-canvas
git -c commit.gpgsign=false commit -m "feat(web): mini-canvas SVG preview component for project list"
```

---

## Task 14: Wire it all together in the canvas route

**Files:**
- Modify: `apps/web/src/routes/_dashboard/project/$projectId/index.tsx` (currently the Empty placeholder; replace with the real composition)

This is the integration task. The route loads the project + databases + proxy routes, derives nodes via `useCanvasNodes`, renders `<Canvas>` + `<ResourceDrawer>` + `<AddResourceSheet>`, and wires selection state via `useResourceDrawer`.

- [ ] **Step 1: Rewrite `apps/web/src/routes/_dashboard/project/$projectId/index.tsx`**

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { AddResourceSheet } from "@/features/add-resource-sheet";
import { Canvas, useCanvasNodes, type CanvasNode } from "@/features/project-canvas";
import { ResourceDrawer, useResourceDrawer } from "@/features/resource-drawer";
import { client, queryClient } from "@/utils/orpc";

export const Route = createFileRoute("/_dashboard/project/$projectId/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectId } = Route.useParams();
  const drawer = useResourceDrawer();
  const [addOpen, setAddOpen] = useState(false);

  const databasesQuery = useQuery({
    queryKey: ["project-databases", projectId],
    queryFn: () => client.project.database.listPostgres({ projectId }),
  });

  const proxyRoutesQuery = useQuery({
    queryKey: ["project-proxy-routes", projectId],
    queryFn: () => client.project.proxyRoute.list({ projectId }),
  });

  const { nodes } = useCanvasNodes({
    databases: databasesQuery.data ?? [],
    proxyRoutes: proxyRoutesQuery.data ?? [],
  });

  const selectedNodeId = drawer.selection?.kind === "database"
    ? `db:${drawer.selection.resourceId}`
    : null;

  const handleSelectNode = (node: CanvasNode | null) => {
    if (!node) {
      drawer.close();
      return;
    }
    if (node.type === "database") {
      drawer.select({ kind: "database", resourceId: node.data.resourceId, projectId });
    }
    // service / volume / routing / group nodes don't open the drawer in v1
  };

  const selectedDatabaseName =
    drawer.selection?.kind === "database"
      ? databasesQuery.data?.find((d) => d.resourceId === drawer.selection!.resourceId)?.name ?? ""
      : "";

  if (databasesQuery.isLoading || proxyRoutesQuery.isLoading) {
    return (
      <div className="grid h-full place-items-center p-8">
        <Skeleton className="h-64 w-full max-w-3xl" />
      </div>
    );
  }
  if (databasesQuery.isError || proxyRoutesQuery.isError) {
    const error = databasesQuery.error ?? proxyRoutesQuery.error;
    return (
      <div className="grid h-full place-items-center p-8">
        <Empty>
          <EmptyTitle>Couldn't load project</EmptyTitle>
          <EmptyDescription>
            {error instanceof Error ? error.message : "Try refreshing the page."}
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <Canvas nodes={nodes} selectedNodeId={selectedNodeId} onSelectNode={handleSelectNode} />

      <Button
        size="sm"
        className="absolute right-3 top-3 shadow-sm"
        onClick={() => setAddOpen(true)}
      >
        <PlusIcon className="size-4" />
        Add
      </Button>

      <ResourceDrawer
        open={drawer.open}
        selection={drawer.selection}
        onClose={drawer.close}
        onDeleted={() => {
          drawer.close();
          queryClient.invalidateQueries({ queryKey: ["project-databases", projectId] });
        }}
        resourceName={selectedDatabaseName}
      />

      <AddResourceSheet open={addOpen} onOpenChange={setAddOpen} projectId={projectId} />
    </div>
  );
}
```

- [ ] **Step 2: Type-check + run-walk**

```bash
cd apps/web && bun run tsc --noEmit
```

If type errors surface (e.g. coss `Sheet`'s `onOpenChange` shape doesn't match what `AddResourceSheet` exposes), fix in the relevant feature file — never weaken types in the route.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/_dashboard/project/$projectId/index.tsx
git -c commit.gpgsign=false commit -m "feat(web): wire project canvas + drawer + add-sheet into the canvas route"
```

---

## Task 15: Final verification

- [ ] **Step 1: Run all tests**

```bash
cd apps/web && bun run test
```

Expected total: 13 (Plan 1) + 4 (useCanvasNodes) + 3 (useResourceDrawer) + 2 (SettingsTab) + 3 (MiniCanvasPreview) = **25 tests**, 8 files, all passing.

- [ ] **Step 2: Type-check**

```bash
cd apps/web && bun run tsc --noEmit
```

Filter out the unrelated `packages/api/src/swarm/postgres.ts` errors:

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS"
```

Filtered output must be empty.

- [ ] **Step 3: Manual walk (optional if no browser)**

```bash
cd apps/web && bun dev
```

Sign in, create or open a project. Confirm:
- [ ] Canvas renders with at least the routing node + the data group (even with zero databases)
- [ ] "+ Add" button top-right opens the AddResourceSheet
- [ ] Picking "Postgres database", entering a name, submitting → new database appears as a node + a volume sibling
- [ ] Clicking a database node opens the drawer
- [ ] Drawer Overview tab shows real connection strings
- [ ] Drawer Deployments / Variables / Logs tabs show the Empty stubs
- [ ] Drawer Settings tab → Delete → confirmation → confirm → drawer closes, node disappears
- [ ] Floating canvas controls (zoom in/out/fit) work
- [ ] ⌘K still opens the command palette over the canvas

Stop the dev server.

- [ ] **Step 4: Fix-up commit if anything surfaced**

If bugs or layout issues appear during the walk, fix inline, then:

```bash
git add -p
git -c commit.gpgsign=false commit -m "fix(web): plan-2 walkthrough fixes"
```

If the walk was clean, no commit needed.

---

## Done — what's next

After Plan 2 lands, **Plan 3** redesigns the workspace project list using `MiniCanvasPreview`, plus implements Servers, Routing, Activity, Members, Settings (workspace-level). **Plan 4** adds the real backends behind the drawer's stubbed tabs (Logs/Ghostty, Deployments, Variables) and the project-level Networking screen. **Plan 5** wires the command palette to real actions, hardens performance (virtualization, lazy-loaded Ghostty), and adds smoke tests per route.

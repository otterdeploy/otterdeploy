# Zero Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace oRPC/TanStack Query reads with Zero reactive queries and add Zero mutators for core CRUD operations (projects, environments, resources, resource links, viewports).

**Architecture:** Client components use `useQuery` from `@rocicorp/zero/react` with named queries from `packages/zero/src/queries.ts`. Mutations use `zero.mutate(mutators.*.action(args))`. The Zero instance is accessed via `useRouter().options.context.zero` (set by ZeroProvider). Route loaders use `context.zero.run(query)` to warm the Zero cache. Server-side mutators in `packages/zero/src/mutators.ts` handle validation via existing domain services.

**Tech Stack:** @rocicorp/zero@0.25.12, TanStack Router, React, Hono, drizzle-zero

**Reference:** See `ztunes/` directory for working Zero + TanStack Router patterns.

---

### Task 1: Add `resourceById` query to packages/zero/src/queries.ts

**Files:**

- Modify: `packages/zero/src/queries.ts`

**Step 1: Add the query**

Add after the existing `resourceList` query:

```ts
resourceById: defineQuery(
  z.object({ resourceId: z.string() }),
  ({ args: { resourceId } }) =>
    zql.projectResource.where("id", resourceId).one(),
),
```

**Step 2: Commit**

```bash
git add packages/zero/src/queries.ts
git commit -m "feat(zero): add resourceById query"
```

---

### Task 2: Define Zero mutators in packages/zero/src/mutators.ts

**Files:**

- Modify: `packages/zero/src/mutators.ts`

**Step 1: Write the mutators**

Replace the file contents with:

```ts
import { defineMutators, defineMutator } from "@rocicorp/zero";
import { zql } from "./schema";
import * as z from "zod";

export const mutators = defineMutators({
  project: {
    create: defineMutator(
      z.object({
        id: z.string(),
        organizationId: z.string(),
        ownerId: z.string(),
        name: z.string(),
        slug: z.string(),
      }),
      async ({ tx, args }) => {
        await tx.mutate.project.insert({
          id: args.id,
          organizationId: args.organizationId,
          ownerId: args.ownerId,
          name: args.name,
          slug: args.slug,
        });
      },
    ),

    update: defineMutator(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        slug: z.string().optional(),
      }),
      async ({ tx, args }) => {
        await tx.mutate.project.update({
          id: args.id,
          ...(args.name !== undefined && { name: args.name }),
          ...(args.slug !== undefined && { slug: args.slug }),
        });
      },
    ),

    delete: defineMutator(z.object({ id: z.string() }), async ({ tx, args }) => {
      await tx.mutate.project.update({
        id: args.id,
        deletedAt: Date.now(),
      });
    }),
  },

  environment: {
    create: defineMutator(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string(),
      }),
      async ({ tx, args }) => {
        await tx.mutate.projectEnvironment.insert({
          id: args.id,
          projectId: args.projectId,
          name: args.name,
        });
      },
    ),

    delete: defineMutator(z.object({ id: z.string() }), async ({ tx, args }) => {
      await tx.mutate.projectEnvironment.delete({ id: args.id });
    }),
  },

  resource: {
    create: defineMutator(
      z.object({
        id: z.string(),
        environmentId: z.string(),
        kind: z.string(),
        name: z.string(),
        posX: z.number().optional(),
        posY: z.number().optional(),
      }),
      async ({ tx, args }) => {
        await tx.mutate.projectResource.insert({
          id: args.id,
          environmentId: args.environmentId,
          kind: args.kind,
          name: args.name,
          posX: args.posX ?? 0,
          posY: args.posY ?? 0,
        });
      },
    ),

    update: defineMutator(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        posX: z.number().optional(),
        posY: z.number().optional(),
      }),
      async ({ tx, args }) => {
        await tx.mutate.projectResource.update({
          id: args.id,
          ...(args.name !== undefined && { name: args.name }),
          ...(args.posX !== undefined && { posX: args.posX }),
          ...(args.posY !== undefined && { posY: args.posY }),
        });
      },
    ),

    delete: defineMutator(z.object({ id: z.string() }), async ({ tx, args }) => {
      await tx.mutate.projectResource.delete({ id: args.id });
    }),
  },

  resourceLink: {
    create: defineMutator(
      z.object({
        id: z.string(),
        environmentId: z.string(),
        sourceResourceId: z.string(),
        targetResourceId: z.string(),
        linkType: z.string().optional(),
      }),
      async ({ tx, args }) => {
        await tx.mutate.projectResourceLink.insert({
          id: args.id,
          environmentId: args.environmentId,
          sourceResourceId: args.sourceResourceId,
          targetResourceId: args.targetResourceId,
          linkType: args.linkType ?? "depends_on",
        });
      },
    ),

    delete: defineMutator(z.object({ id: z.string() }), async ({ tx, args }) => {
      await tx.mutate.projectResourceLink.delete({ id: args.id });
    }),
  },

  viewport: {
    upsert: defineMutator(
      z.object({
        environmentId: z.string(),
        x: z.number(),
        y: z.number(),
        zoom: z.number(),
      }),
      async ({ tx, args }) => {
        await tx.mutate.projectViewport.upsert({
          environmentId: args.environmentId,
          x: args.x,
          y: args.y,
          zoom: args.zoom,
        });
      },
    ),
  },
});
```

**Step 2: Commit**

```bash
git add packages/zero/src/mutators.ts
git commit -m "feat(zero): define CRUD mutators for project, environment, resource, link, viewport"
```

---

### Task 3: Update ZeroProvider to pass mutators

**Files:**

- Modify: `apps/web/src/components/zero-provider.tsx`

**Step 1: Update the provider**

Replace the file contents with:

```tsx
import { type Zero } from "@rocicorp/zero";
import { ZeroProvider as RocicorpZeroProvider } from "@rocicorp/zero/react";
import { schema } from "@otterdeploy/zero";
import { mutators } from "@otterdeploy/zero/mutators";
import { env } from "@otterdeploy/env/web";
import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";

interface ZeroProviderProps {
  userID: string;
  children: React.ReactNode;
}

export function ZeroProviderWrapper({ userID, children }: ZeroProviderProps) {
  const router = useRouter();
  const context = { userId: userID };
  const cacheURL = env.VITE_ZERO_URL;

  const init = useCallback(
    (zero: Zero) => {
      router.update({
        context: {
          ...router.options.context,
          zero,
        },
      });
      router.invalidate();
    },
    [router],
  );

  return (
    <RocicorpZeroProvider {...{ schema, userID, context, cacheURL, mutators, init }}>
      {children}
    </RocicorpZeroProvider>
  );
}
```

**Step 2: Delete the redundant singleton file**

Delete `apps/web/src/utils/zero.ts` — it's unused since ZeroProvider manages the instance.

**Step 3: Commit**

```bash
git add apps/web/src/components/zero-provider.tsx
git rm apps/web/src/utils/zero.ts
git commit -m "feat(zero): pass mutators to ZeroProvider, remove unused zero singleton"
```

---

### Task 4: Add Zero type to router context

The Zero instance needs to be typed in the router context so routes can access `context.zero`.

**Files:**

- Find and modify: the file that defines the router context type (look for `createRouter` or `routerContext` in `apps/web/src/`)

**Step 1: Find the router context definition**

Search for `createRouter` or `routeContext` in `apps/web/src/`. Add `zero` to the context type:

```ts
import type { Zero } from "@rocicorp/zero";
import type { Schema } from "@otterdeploy/zero";

// In the router context type:
zero: Zero<Schema>;
```

The `zero` property should be optional (`zero?: Zero<Schema>`) since it's set asynchronously by ZeroProvider's `init` callback.

**Step 2: Commit**

```bash
git add apps/web/src/<router-context-file>
git commit -m "feat(zero): add Zero instance to router context type"
```

---

### Task 5: Migrate projects/index.tsx (projects list page)

**Files:**

- Modify: `apps/web/src/routes/_dashboard/projects/index.tsx`

**Step 1: Replace imports and loader**

Remove:

```ts
import { orpc, client, queryClient } from "@/utils/orpc";
```

Add:

```ts
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@otterdeploy/zero/queries";
import { mutators } from "@otterdeploy/zero/mutators";
import { useRouter } from "@tanstack/react-router";
```

Replace the loader with Zero cache warming:

```ts
loader: async ({ context }) => {
  if (!context.auth.session.activeOrganizationId) throw new Error("No active organization");
  if (context.zero) {
    context.zero.run(queries.projectList({ organizationId: context.auth.session.activeOrganizationId }));
  }
  return { organizationId: context.auth.session.activeOrganizationId };
},
```

**Step 2: Replace RouteComponent data fetching**

In `RouteComponent`, replace `Route.useLoaderData()` with Zero queries:

```tsx
function RouteComponent() {
  const { organizationId } = Route.useLoaderData();
  const { zero } = useRouter().options.context;
  const [sort, setSort] = useState<SortOption>("updated");
  const [view, setView] = useState<ViewMode>("architecture");

  const [projects] = useQuery(queries.projectList({ organizationId }));

  const sortedProjects = useMemo(() => {
    const items = [...(projects ?? [])];
    switch (sort) {
      case "updated":
        return items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      case "name-asc":
        return items.sort((a, b) => a.name.localeCompare(b.name));
      case "name-desc":
        return items.sort((a, b) => b.name.localeCompare(a.name));
      case "newest":
        return items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      case "oldest":
        return items.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      default:
        return items;
    }
  }, [projects, sort]);
  // ... rest of component
```

Note: timestamps from Zero are epoch numbers, not ISO strings, so sorting uses direct number comparison instead of `new Date().getTime()`.

**Step 3: Replace CreateProjectDialog mutation**

Replace the oRPC mutation with Zero mutator. Use `crypto.randomUUID()` for IDs:

```tsx
function CreateProjectDialog() {
  const { organizationId } = Route.useLoaderData();
  const router = useRouter();
  const { zero } = router.options.context;
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: { name: "" },
    validators: {
      onSubmit: z.object({
        name: z.string().min(1, "Project name is required").max(128, "Name is too long"),
      }),
    },
    onSubmit: async ({ value }) => {
      const id = crypto.randomUUID();
      const slug = value.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      zero.mutate(
        mutators.project.create({
          id,
          organizationId,
          ownerId: /* get from auth context */,
          name: value.name.trim(),
          slug,
        }),
      );
      setOpen(false);
      form.reset();
      router.navigate({
        to: "/projects/$projectId",
        params: { projectId: id },
      });
    },
  });
  // ... rest same
```

Note: The `ownerId` needs to come from the auth context. Check how the dashboard layout passes `auth.user.id` — you may need to pass it down or access it from route context.

**Step 4: Update project card rendering**

The `ProjectCard` currently receives enriched data (resources, environment). With Zero, subscribe to resources and environments per project inline, OR simplify the card to just show project name + timestamps (since fetching per-project resources in a list is expensive with Zero). Simpler approach: just show project data from the Zero query directly.

**Step 5: Commit**

```bash
git add apps/web/src/routes/_dashboard/projects/index.tsx
git commit -m "feat(zero): migrate projects list to Zero queries and mutators"
```

---

### Task 6: Migrate projects/$projectId/layout.tsx (project layout)

**Files:**

- Modify: `apps/web/src/routes/_dashboard/projects/$projectId/layout.tsx`

**Step 1: Replace imports**

Remove:

```ts
import { orpc, client, queryClient } from "@/utils/orpc";
import { useQuery } from "@tanstack/react-query";
```

Add:

```ts
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@otterdeploy/zero/queries";
import { mutators } from "@otterdeploy/zero/mutators";
```

**Step 2: Replace loader**

Replace the oRPC loader with Zero cache warming:

```ts
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
```

**Step 3: Replace ProjectHeader data**

In `ProjectHeader`, replace `Route.useLoaderData()` with Zero queries:

```tsx
function ProjectHeader({ onCreateResource }: { onCreateResource: (...) => void }) {
  const { projectId } = useParams({ strict: false });
  const { organizationId } = Route.useLoaderData();
  const { zero } = useRouter().options.context;

  const [project] = useQuery(queries.projectById({ projectId: projectId! }));
  const [environments] = useQuery(queries.environmentList({ projectId: projectId! }));
  const [projects] = useQuery(queries.projectList({ organizationId }));

  if (!project) return null;
  // ... rest uses project, environments, projects directly
```

**Step 4: Replace EnvironmentSwitcher mutation**

Replace `client.environment.create` + `queryClient.invalidateQueries` with:

```tsx
onSubmit: async ({ value }) => {
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
```

No need for `router.invalidate()` — Zero auto-syncs.

**Step 5: Replace CreateResourcePalette**

Replace the `useQuery(orpc.environment.list.queryOptions(...))` with Zero:

```tsx
const [environments] = useQuery(queries.environmentList({ projectId: projectId! }));
```

Replace `client.resource.create` + `queryClient.invalidateQueries` with:

```tsx
async function createResource(kind: ResourceKind, name: string) {
  if (!projectId) return;
  const env = environments?.[0];
  if (!env) return;

  const id = crypto.randomUUID();
  zero.mutate(
    mutators.resource.create({
      id,
      environmentId: env.id,
      kind,
      name,
      posX: 100 + Math.random() * 200,
      posY: 100 + Math.random() * 200,
    }),
  );

  onCreated({ id, name, kind, status: "unknown" });
  handleOpenChange(false);
}
```

**Step 6: Replace graph data in RouteComponent**

The `RouteComponent` currently uses `graph` from loader data. Replace with reactive Zero queries:

```tsx
function RouteComponent() {
  const { projectId } = useParams({ strict: false });
  const { zero } = useRouter().options.context;

  const [environments] = useQuery(queries.environment.list({ projectId: projectId! }));
  const firstEnvId = environments?.[0]?.id;

  const [resources] = useQuery(
    firstEnvId ? queries.resourceList({ environmentId: firstEnvId }) : undefined,
  );
  const [links] = useQuery(
    firstEnvId ? queries.resourceLinkList({ environmentId: firstEnvId }) : undefined,
  );

  // Compose graph nodes from resources
  const graphNodes = useMemo<Node[]>(() => {
    if (!resources) return [];
    return resources.map((r) => ({
      id: r.id,
      type: "resource" as const,
      position: { x: r.posX ?? 0, y: r.posY ?? 0 },
      data: {
        name: r.name,
        kind: r.kind,
        status: r.status ?? "unknown",
        metadata: r.metadata ?? {},
      },
    }));
  }, [resources]);

  // Compose graph edges from links
  const graphEdges = useMemo(() => {
    if (!links) return [];
    return links.map((l) => ({
      id: l.id,
      source: l.sourceResourceId,
      target: l.targetResourceId,
      type: "smoothstep",
      animated: true,
    }));
  }, [links]);

  // ... rest of ReactFlow setup uses graphNodes and graphEdges
```

**Step 7: Commit**

```bash
git add apps/web/src/routes/_dashboard/projects/\$projectId/layout.tsx
git commit -m "feat(zero): migrate project layout to Zero queries and mutators"
```

---

### Task 7: Migrate projects/$projectId/index.tsx (project detail/canvas page)

**Files:**

- Modify: `apps/web/src/routes/_dashboard/projects/$projectId/index.tsx`

**Step 1: Replace imports and loader**

Remove:

```ts
import { orpc } from "@/utils/orpc";
```

Add:

```ts
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@otterdeploy/zero/queries";
```

Replace the `beforeLoad` and `loader` with Zero-based logic:

```ts
export const Route = createFileRoute("/_dashboard/projects/$projectId/")({
  component: RouteComponent,
  validateSearch: searchSchema,
  loader: async ({ context, params }) => {
    if (context.zero) {
      context.zero.run(queries.environmentList({ projectId: params.projectId }));
    }
  },
});
```

**Step 2: Replace RouteComponent**

The component currently uses hardcoded `initialNodes`/`initialEdges`. Replace with reactive Zero data (this will be the same pattern as task 6 step 6 — resources and links composed into nodes/edges). Remove the hardcoded mock data arrays.

```tsx
function RouteComponent() {
  const { projectId } = Route.useParams();
  const { env } = Route.useSearch();

  const [environments] = useQuery(queries.environmentList({ projectId }));
  const matched = environments?.find((e) => e.name === env);

  const [resources] = useQuery(
    matched ? queries.resourceList({ environmentId: matched.id }) : undefined,
  );
  const [links] = useQuery(
    matched ? queries.resourceLinkList({ environmentId: matched.id }) : undefined,
  );
  const [viewport] = useQuery(
    matched ? queries.viewport({ environmentId: matched.id }) : undefined,
  );

  const graphNodes = useMemo(() => {
    if (!resources) return [];
    return resources.map((r) => ({
      id: r.id,
      type: "resource" as const,
      position: { x: r.posX ?? 0, y: r.posY ?? 0 },
      data: {
        id: r.id,
        name: r.name,
        kind: r.kind,
        status: r.status ?? "unknown",
        metadata: r.metadata ?? {},
      },
    }));
  }, [resources]);

  const graphEdges = useMemo(() => {
    if (!links) return [];
    return links.map((l) => ({
      id: l.id,
      source: l.sourceResourceId,
      target: l.targetResourceId,
      type: "smoothstep",
    }));
  }, [links]);

  const [nodes, , onNodesChange] = useNodesState(graphNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphEdges);
  const onConnect: OnConnect = useCallback(
    (params) => setEdges((els) => addEdge(params, els)),
    [setEdges],
  );

  return (
    <div style={{ height: "100dvh" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        defaultViewport={
          viewport
            ? { x: viewport.x ?? 0, y: viewport.y ?? 0, zoom: viewport.zoom ?? 1 }
            : undefined
        }
        colorMode="dark"
        fitView={!viewport}
      >
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
}
```

**Step 3: Remove hardcoded mock data**

Delete the `initialNodes` and `initialEdges` arrays (lines ~91-221 in current file).

**Step 4: Commit**

```bash
git add apps/web/src/routes/_dashboard/projects/\$projectId/index.tsx
git commit -m "feat(zero): migrate project detail page to Zero reactive queries"
```

---

### Task 8: Migrate projects/$projectId/service/$serviceId.tsx

**Files:**

- Modify: `apps/web/src/routes/_dashboard/projects/$projectId/service/$serviceId.tsx`

**Step 1: Replace imports and loader**

Remove:

```ts
import { orpc } from "@/utils/orpc";
```

Add:

```ts
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@otterdeploy/zero/queries";
import { useRouter } from "@tanstack/react-router";
```

Replace the loader:

```ts
loader: async ({ context, params }) => {
  if (context.zero) {
    context.zero.run(queries.resourceById({ resourceId: params.serviceId }));
  }
},
```

**Step 2: Use Zero query in the component**

```tsx
function RouteComponent() {
  const { tab } = Route.useSearch();
  const { projectId, serviceId } = Route.useParams();
  const { zero } = useRouter().options.context;

  const [resource] = useQuery(queries.resourceById({ resourceId: serviceId }));
  const navigate = useNavigate();

  return (
    <Panel
      title={resource?.name ?? "Service"}
      defaultTab={tab}
      onClose={() => navigate({ to: "/projects/$projectId", params: { projectId } })}
    >
      {/* ... tabs same as before */}
    </Panel>
  );
}
```

**Step 3: Commit**

```bash
git add apps/web/src/routes/_dashboard/projects/\$projectId/service/\$serviceId.tsx
git commit -m "feat(zero): migrate service detail to Zero reactive query"
```

---

### Task 9: Set up server-side Zero endpoints

**Files:**

- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/package.json` (ensure `pg` is a dependency for the Zero adapter)

**Step 1: Add the endpoints**

The server needs `POST /api/zero/query` and `POST /api/zero/mutate`. Import from `@rocicorp/zero/server` and `@rocicorp/zero/server/adapters/pg`:

```ts
import { schema, queries, mutators } from "@otterdeploy/zero";
import { handleQueryRequest, handleMutateRequest } from "@rocicorp/zero/server";
import { mustGetQuery, mustGetMutator } from "@rocicorp/zero";
import { zeroNodePg } from "@rocicorp/zero/server/adapters/pg";

const dbProvider = zeroNodePg(schema, env.DATABASE_URL);

// After the auth endpoint:

app.post("/api/zero/query", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const ctx = session ? { userId: session.user.id } : undefined;
  const result = await handleQueryRequest(
    (name, args) => {
      const query = mustGetQuery(queries, name);
      return query.fn({ args, ctx });
    },
    schema,
    c.req.raw,
  );
  return c.json(result);
});

app.post("/api/zero/mutate", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const ctx = { userId: session.user.id };
  const result = await handleMutateRequest(
    dbProvider,
    async (transact) => {
      return await transact(async (tx, name, args) => {
        const mutator = mustGetMutator(mutators, name);
        return await mutator.fn({ tx, ctx, args });
      });
    },
    c.req.raw,
  );
  return c.json(result);
});
```

**Step 2: Ensure `pg` is in server dependencies**

Check if `pg` is already a dependency via drizzle-orm/node-postgres. If not:

```bash
cd apps/server && bun add pg
```

**Step 3: Commit**

```bash
git add apps/server/src/index.ts apps/server/package.json
git commit -m "feat(zero): add server-side query and mutate endpoints"
```

---

### Task 10: Clean up and verify

**Files:**

- Delete: `apps/web/src/utils/zero.ts`
- Verify: All routes compile, no unused oRPC imports remain for migrated entities

**Step 1: Run typecheck**

```bash
bun run typecheck
```

Fix any type errors. Common issues:

- `context.zero` may be undefined (use optional chaining in loaders)
- Zero query results are arrays, not objects with `.items` (adjust `projects.items` to just `projects`)
- Timestamps are epoch numbers, not ISO strings

**Step 2: Run dev**

```bash
bun run dev
```

Verify the dashboard loads, projects list shows, project detail page renders the canvas, and creating a project works with instant optimistic update.

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(zero): complete migration of core CRUD to Zero reactive queries"
```

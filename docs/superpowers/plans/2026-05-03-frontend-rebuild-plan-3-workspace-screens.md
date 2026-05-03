# Frontend Rebuild — Plan 3: Workspace Screens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder pages on the outer rail (Projects, Servers, Routing, Activity, Members, Settings) with real content where backends exist (Projects, Routing) and IA-faithful skeletons where they don't (Servers, Activity, Members, Settings) — so the workspace navigation feels like a real product, not a coming-soon mock-up.

**Architecture:** Each workspace screen becomes its own feature folder under `apps/web/src/features/workspace-<screen>/` with `components/`, `hooks/` (when needed), `types.ts`, `index.ts`. Routes (`apps/web/src/routes/_dashboard/<screen>.tsx`) stay thin: load data, hand to the feature component. The Project list reuses `MiniCanvasPreview` from Plan 2. Long-scroll Settings layout uses `IntersectionObserver`-driven sticky TOC.

**Tech Stack:** No new deps. coss UI primitives (Card, Table, Empty, Tabs, Form, Skeleton, Toolbar, Badge, Avatar, Meter, Field). better-auth's `authClient.useSession()` for the current-user member entry. oRPC `project.list` + `project.database.listPostgres` + `project.proxyRoute.list` for the project list and routing aggregation.

**Spec:** `docs/superpowers/specs/2026-05-02-frontend-rebuild-design.md` §4 (outer rail items), §6 (per-screen sketches), §7 (component conventions), §13 (folder layout).

**Foundation in place:** Plan 1 + 2 shipped. Plan 1 created the placeholder routes; Plan 2 delivered `MiniCanvasPreview` for use here. HEAD: `94cb0b2`.

**Out of scope for this plan:**
- **Real Servers data** — no Swarm-nodes oRPC contract yet. Servers screen is a skeleton (table header + empty state + disabled "+ Add server" with a tooltip pointing at Plan 6).
- **Real Activity audit log** — no audit endpoint. Activity is an empty state with the date-range filter UI in place.
- **Real RBAC** — no members/invitations/PATs API. Members shows the current user (via better-auth session) and a disabled "Invite" button.
- **Real workspace settings persistence** — no workspace-settings API. Settings renders the full long-scroll layout with sticky TOC and form fields, but Save buttons are disabled with "Settings API ships in Plan 6".
- **Workspace switcher real wiring** — Plan 1's hardcoded placeholder workspace stays for now; real workspace data lands when there's a `workspace.list` endpoint.

---

## File map

```
apps/web/src/
  features/
    workspace-projects/
      components/
        project-card.tsx                       ← CREATE (uses MiniCanvasPreview)
        project-card.test.tsx                  ← CREATE
        project-list.tsx                       ← CREATE (grid of project cards + create CTA)
        create-project-dialog.tsx              ← CREATE (extracted from current routes/_dashboard/index.tsx)
      hooks/
        use-project-summaries.ts               ← CREATE (project + db count + route count)
        use-project-summaries.test.ts          ← CREATE
      types.ts                                 ← CREATE
      index.ts                                 ← CREATE
    workspace-routing/
      components/
        workspace-routes-table.tsx             ← CREATE (aggregates per-project proxy routes)
      hooks/
        use-workspace-routes.ts                ← CREATE
        use-workspace-routes.test.ts           ← CREATE
      types.ts                                 ← CREATE
      index.ts                                 ← CREATE
    workspace-servers/
      components/
        servers-table.tsx                      ← CREATE (skeleton table with empty state + disabled CTA)
      types.ts                                 ← CREATE
      index.ts                                 ← CREATE
    workspace-activity/
      components/
        activity-feed.tsx                      ← CREATE (empty state + date-range filter UI)
      types.ts                                 ← CREATE
      index.ts                                 ← CREATE
    workspace-members/
      components/
        members-table.tsx                      ← CREATE (current user + disabled invite CTA)
      types.ts                                 ← CREATE
      index.ts                                 ← CREATE
    workspace-settings/
      components/
        settings-page.tsx                      ← CREATE (long-scroll + sticky TOC)
        toc-sidebar.tsx                        ← CREATE (IntersectionObserver-driven anchor links)
      hooks/
        use-active-section.ts                  ← CREATE
        use-active-section.test.ts             ← CREATE
      types.ts                                 ← CREATE
      index.ts                                 ← CREATE
  routes/
    _dashboard/
      index.tsx                                ← REWRITE (replace inline UI with <ProjectList/>)
      servers.tsx                              ← REWRITE (replace Empty with <ServersTable/>)
      routing.tsx                              ← REWRITE (replace Empty with <WorkspaceRoutesTable/>)
      activity.tsx                             ← REWRITE (replace Empty with <ActivityFeed/>)
      members.tsx                              ← REWRITE (replace Empty with <MembersTable/>)
      settings.tsx                             ← REWRITE (replace Empty with <SettingsPage/>)
```

---

## Conventions for every task

- **TDD where the unit has logic** (hooks, derived data, IntersectionObserver-driven section detection). Pure presentation gets smoke tests at most.
- **coss UI strictly.**
- **No `Co-Authored-By` trailers**, plain `git commit -m "..."` with `-c commit.gpgsign=false`. Specific paths in `git add` — never `git add -A` or `git add .`.
- **No new deps.**
- **All commits on `feat/v2-rebuild`.**
- **`bun run tsc --noEmit` is the type-check signal** (filter pre-existing `packages/api/src/swarm/postgres.ts` errors).
- **Skeletons must look real** — use coss `Table`, `Skeleton`, `Empty`, `Toolbar`, etc. with the actual shape the eventual feature will have. The "lands in Plan 6" message is one line at the bottom of the empty state, not a 50% screen takeover.

---

## Task 1: Project list — `useProjectSummaries` hook + tests

**Files:**
- Create: `apps/web/src/features/workspace-projects/types.ts`
- Create: `apps/web/src/features/workspace-projects/hooks/use-project-summaries.ts`
- Create: `apps/web/src/features/workspace-projects/hooks/use-project-summaries.test.ts`

The hook fans out per-project queries (databases + proxy routes) and returns a unified `ProjectSummary[]` with `databases.count` and `routes.count`. Pure derivation given the per-project query results.

Approach: take an array of projects as input; for each, the route component runs `useQueries` to fetch `project.database.listPostgres({ projectId })` and `project.proxyRoute.list({ projectId })`. The hook itself is pure — it takes resolved counts and rolls them up into `ProjectSummary[]`.

- [ ] **Step 1: Create `types.ts`**

```ts
import type { ProjectFromApi } from "@/features/project-canvas/api/schema";

export type ProjectSummary = {
  project: ProjectFromApi;
  databases: { count: number };
  routes: { count: number };
};

export type ProjectSummariesInput = {
  projects: ReadonlyArray<ProjectFromApi>;
  /** Map of projectId → resolved database count (undefined while pending). */
  databaseCounts: Record<string, number | undefined>;
  /** Map of projectId → resolved route count (undefined while pending). */
  routeCounts: Record<string, number | undefined>;
};
```

- [ ] **Step 2: Failing test `use-project-summaries.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { useProjectSummaries } from "./use-project-summaries";
import type { ProjectFromApi } from "@/features/project-canvas/api/schema";

function makeProject(over: Partial<ProjectFromApi> = {}): ProjectFromApi {
  return {
    id: "proj_1",
    name: "Acme",
    slug: "acme",
    environmentId: "env_1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  } as ProjectFromApi;
}

describe("useProjectSummaries", () => {
  it("returns one summary per project, in input order", () => {
    const summaries = useProjectSummaries({
      projects: [makeProject({ id: "a" }), makeProject({ id: "b" })],
      databaseCounts: {},
      routeCounts: {},
    });
    expect(summaries.map((s) => s.project.id)).toEqual(["a", "b"]);
  });

  it("returns zero counts when no per-project data has resolved", () => {
    const summaries = useProjectSummaries({
      projects: [makeProject({ id: "a" })],
      databaseCounts: {},
      routeCounts: {},
    });
    expect(summaries[0].databases.count).toBe(0);
    expect(summaries[0].routes.count).toBe(0);
  });

  it("uses provided counts when resolved", () => {
    const summaries = useProjectSummaries({
      projects: [makeProject({ id: "a" })],
      databaseCounts: { a: 3 },
      routeCounts: { a: 2 },
    });
    expect(summaries[0].databases.count).toBe(3);
    expect(summaries[0].routes.count).toBe(2);
  });
});
```

- [ ] **Step 3: Run — expect failure**

```bash
cd apps/web && bun run test src/features/workspace-projects
```

- [ ] **Step 4: Implement `use-project-summaries.ts`**

```ts
import type { ProjectSummariesInput, ProjectSummary } from "../types";

export function useProjectSummaries(input: ProjectSummariesInput): ProjectSummary[] {
  return input.projects.map((project) => ({
    project,
    databases: { count: input.databaseCounts[project.id] ?? 0 },
    routes: { count: input.routeCounts[project.id] ?? 0 },
  }));
}
```

- [ ] **Step 5: Run — expect 3 passing**

- [ ] **Step 6: Create `apps/web/src/features/workspace-projects/index.ts`**

```ts
export { useProjectSummaries } from "./hooks/use-project-summaries";
export type { ProjectSummary, ProjectSummariesInput } from "./types";
```

- [ ] **Step 7: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
git add apps/web/src/features/workspace-projects
git -c commit.gpgsign=false commit -m "feat(web): workspace-projects summary hook with tests"
```

---

## Task 2: Project card + tests

**Files:**
- Create: `apps/web/src/features/workspace-projects/components/project-card.tsx`
- Create: `apps/web/src/features/workspace-projects/components/project-card.test.tsx`

A card that renders a `MiniCanvasPreview` plus name, slug, env, and counts. Wraps a `Link` to `/project/$projectId`.

- [ ] **Step 1: Failing test**

```tsx
import { describe, expect, it } from "vitest";
import { renderWithRouter } from "@/test/utils";
import { ProjectCard } from "./project-card";
import type { ProjectSummary } from "../types";

const summary: ProjectSummary = {
  project: {
    id: "proj_1",
    name: "Acme API",
    slug: "acme-api",
    environmentId: "env_1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as ProjectSummary["project"],
  databases: { count: 2 },
  routes: { count: 1 },
};

describe("ProjectCard", () => {
  it("links to the project canvas", async () => {
    const { container } = await renderWithRouter(<ProjectCard summary={summary} />);
    const link = container.querySelector("a[data-project-card]");
    expect(link?.getAttribute("href")).toBe("/project/proj_1");
  });

  it("shows project name, slug, and counts", async () => {
    const { getByText } = await renderWithRouter(<ProjectCard summary={summary} />);
    expect(getByText("Acme API")).toBeInTheDocument();
    expect(getByText("acme-api")).toBeInTheDocument();
    expect(getByText(/2.*databases/i)).toBeInTheDocument();
    expect(getByText(/1.*route/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `project-card.tsx`**

```tsx
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { MiniCanvasPreview } from "@/features/project-canvas";
import type { ProjectSummary } from "../types";

type Props = {
  summary: ProjectSummary;
};

export function ProjectCard({ summary }: Props) {
  const { project, databases, routes } = summary;
  return (
    <Link
      to="/project/$projectId"
      params={{ projectId: project.id }}
      data-project-card
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <div className="text-sm font-semibold">{project.name}</div>
          <div className="text-xs text-muted-foreground">{project.slug}</div>
        </div>
        <Badge variant="outline" className="text-[10px]">project</Badge>
      </div>
      <div className="overflow-hidden rounded-md border bg-muted/30">
        <MiniCanvasPreview databases={databases.count} routes={routes.count} className="h-20 w-full" />
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span><b className="text-foreground">{databases.count}</b> {databases.count === 1 ? "database" : "databases"}</span>
        <span><b className="text-foreground">{routes.count}</b> {routes.count === 1 ? "route" : "routes"}</span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Run — expect 2 passing**

- [ ] **Step 5: Append to `apps/web/src/features/workspace-projects/index.ts`**

```ts
export { ProjectCard } from "./components/project-card";
```

- [ ] **Step 6: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
git add apps/web/src/features/workspace-projects
git -c commit.gpgsign=false commit -m "feat(web): project card with mini-canvas preview"
```

---

## Task 3: Project list + create-project dialog (extract from current index.tsx)

**Files:**
- Create: `apps/web/src/features/workspace-projects/components/create-project-dialog.tsx`
- Create: `apps/web/src/features/workspace-projects/components/project-list.tsx`

Both extracted from the existing `routes/_dashboard/index.tsx`. The dialog is a self-contained piece (open state + form + mutation). The list takes `summaries` as input (route component does the fetching) and renders the grid.

- [ ] **Step 1: Create `create-project-dialog.tsx`**

```tsx
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, FolderPlus, Loader2, PlusIcon } from "lucide-react";

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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { client, queryClient } from "@/utils/orpc";

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CreateProjectDialog() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => client.project.create({ name: name.trim(), slug: slug.trim() }),
    onSuccess: async (project) => {
      setName("");
      setSlug("");
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await navigate({ to: "/project/$projectId", params: { projectId: project.id } });
    },
  });

  const errorMessage = createMutation.error instanceof Error ? createMutation.error.message : null;
  const suggestedSlug = useMemo(() => toSlug(name), [name]);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button size="lg" />}>
        <PlusIcon />
        New project
      </DialogTrigger>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            A default development environment is created automatically so the project is usable right away.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4 p-6 pt-0"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || !slug.trim() || createMutation.isPending) return;
            createMutation.mutate();
          }}
        >
          <Field>
            <FieldLabel htmlFor="project-name">Name</FieldLabel>
            <Input
              id="project-name"
              placeholder="Acme API"
              value={name}
              onChange={(event) => {
                const next = event.target.value;
                setName(next);
                if (!slug.trim() || slug === suggestedSlug) setSlug(toSlug(next));
              }}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="project-slug">Slug</FieldLabel>
            <Input
              id="project-slug"
              placeholder="acme-api"
              value={slug}
              onChange={(event) => setSlug(toSlug(event.target.value))}
            />
            <FieldDescription>Used in hostnames and internal identifiers.</FieldDescription>
          </Field>

          {errorMessage ? (
            <Alert variant="error">
              <AlertCircle />
              <AlertTitle>Couldn't create project</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter variant="bare">
            <Button disabled={!name.trim() || !slug.trim() || createMutation.isPending} type="submit">
              {createMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <FolderPlus className="size-4" />}
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create `project-list.tsx`**

```tsx
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { ProjectCard } from "./project-card";
import { CreateProjectDialog } from "./create-project-dialog";
import type { ProjectSummary } from "../types";

type Props = {
  summaries: ReadonlyArray<ProjectSummary>;
};

export function ProjectList({ summaries }: Props) {
  return (
    <div className="grid gap-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Open a project to manage its services, databases, and routes.</p>
        </div>
        <CreateProjectDialog />
      </div>

      {summaries.length === 0 ? (
        <Empty>
          <EmptyTitle>No projects yet</EmptyTitle>
          <EmptyDescription>Create your first project to get started.</EmptyDescription>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {summaries.map((summary) => (
            <ProjectCard key={summary.project.id} summary={summary} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Append to barrel**

```ts
export { ProjectList } from "./components/project-list";
export { CreateProjectDialog } from "./components/create-project-dialog";
```

- [ ] **Step 4: Rewrite `apps/web/src/routes/_dashboard/index.tsx`** to use the new components and run per-project queries

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";

import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { ProjectList, useProjectSummaries } from "@/features/workspace-projects";
import { client } from "@/utils/orpc";

export const Route = createFileRoute("/_dashboard/")({
  component: RouteComponent,
});

function RouteComponent() {
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => client.project.list(),
  });

  const projects = projectsQuery.data ?? [];

  const databaseQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["project-databases", project.id],
      queryFn: () => client.project.database.listPostgres({ projectId: project.id }),
    })),
  });

  const routeQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["project-proxy-routes", project.id],
      queryFn: () => client.project.proxyRoute.list({ projectId: project.id }),
    })),
  });

  const databaseCounts: Record<string, number | undefined> = {};
  const routeCounts: Record<string, number | undefined> = {};
  projects.forEach((project, index) => {
    databaseCounts[project.id] = databaseQueries[index]?.data?.length;
    routeCounts[project.id] = routeQueries[index]?.data?.length;
  });

  const summaries = useProjectSummaries({ projects, databaseCounts, routeCounts });

  if (projectsQuery.isLoading) {
    return (
      <div className="grid gap-4 p-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      </div>
    );
  }
  if (projectsQuery.isError) {
    return (
      <div className="p-6">
        <Alert variant="error">
          <AlertCircle />
          <AlertTitle>Couldn't load projects</AlertTitle>
          <AlertDescription>
            {projectsQuery.error instanceof Error ? projectsQuery.error.message : "Unknown error"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <ProjectList summaries={summaries} />;
}
```

Note: this file replaces ALL existing UI in `routes/_dashboard/index.tsx`. The old gradient-card layout is gone — `ProjectList` is the new face of the workspace home.

- [ ] **Step 5: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
git add apps/web/src/features/workspace-projects apps/web/src/routes/_dashboard/index.tsx
git -c commit.gpgsign=false commit -m "feat(web): redesign workspace project list with mini-canvas cards"
```

---

## Task 4: Workspace Routing — `useWorkspaceRoutes` hook + table

**Files:**
- Create: `apps/web/src/features/workspace-routing/types.ts`
- Create: `apps/web/src/features/workspace-routing/hooks/use-workspace-routes.ts`
- Create: `apps/web/src/features/workspace-routing/hooks/use-workspace-routes.test.ts`
- Create: `apps/web/src/features/workspace-routing/components/workspace-routes-table.tsx`
- Create: `apps/web/src/features/workspace-routing/index.ts`
- Modify: `apps/web/src/routes/_dashboard/routing.tsx`

The screen aggregates `proxyRoute.list` results across all projects into a single Table. Workspace-level Caddy global config (admin socket, ACME issuer, redirect rules) is **out of scope for Plan 3** — note in the page that those land in Plan 6.

- [ ] **Step 1: Create `types.ts`**

```ts
import type { ProxyRouteFromApi, ProjectFromApi } from "@/features/project-canvas/api/schema";

export type WorkspaceRouteRow = {
  route: ProxyRouteFromApi;
  project: Pick<ProjectFromApi, "id" | "name" | "slug">;
};

export type WorkspaceRoutesInput = {
  projects: ReadonlyArray<ProjectFromApi>;
  /** Map of projectId → resolved proxy route list (undefined while pending). */
  routesByProject: Record<string, ReadonlyArray<ProxyRouteFromApi> | undefined>;
};
```

- [ ] **Step 2: Failing test `use-workspace-routes.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { useWorkspaceRoutes } from "./use-workspace-routes";
import type { ProjectFromApi, ProxyRouteFromApi } from "@/features/project-canvas/api/schema";

function makeProject(over: Partial<ProjectFromApi> = {}): ProjectFromApi {
  return {
    id: "p",
    name: "Project",
    slug: "project",
    environmentId: "e",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  } as ProjectFromApi;
}

function makeRoute(over: Partial<ProxyRouteFromApi> = {}): ProxyRouteFromApi {
  return {
    id: "r",
    projectId: "p",
    resourceId: null,
    type: "http",
    domain: "example.com",
    upstreamHost: "h",
    upstreamPort: 80,
    protocol: "http",
    layer4Alpn: null,
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("useWorkspaceRoutes", () => {
  it("flattens routes from all projects with their owning project tag", () => {
    const rows = useWorkspaceRoutes({
      projects: [makeProject({ id: "a", name: "A" }), makeProject({ id: "b", name: "B" })],
      routesByProject: {
        a: [makeRoute({ id: "r1", projectId: "a", domain: "a.example.com" })],
        b: [makeRoute({ id: "r2", projectId: "b", domain: "b.example.com" })],
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].route.domain).toBe("a.example.com");
    expect(rows[0].project.id).toBe("a");
    expect(rows[1].project.id).toBe("b");
  });

  it("skips projects with no resolved routes yet", () => {
    const rows = useWorkspaceRoutes({
      projects: [makeProject({ id: "a" })],
      routesByProject: {},
    });
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run — expect fail**

- [ ] **Step 4: Implement `use-workspace-routes.ts`**

```ts
import type { WorkspaceRouteRow, WorkspaceRoutesInput } from "../types";

export function useWorkspaceRoutes(input: WorkspaceRoutesInput): WorkspaceRouteRow[] {
  const rows: WorkspaceRouteRow[] = [];
  for (const project of input.projects) {
    const routes = input.routesByProject[project.id];
    if (!routes) continue;
    for (const route of routes) {
      rows.push({ route, project: { id: project.id, name: project.name, slug: project.slug } });
    }
  }
  return rows;
}
```

- [ ] **Step 5: Run — expect 2 passing**

- [ ] **Step 6: Implement `workspace-routes-table.tsx`**

```tsx
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { WorkspaceRouteRow } from "../types";

type Props = {
  rows: ReadonlyArray<WorkspaceRouteRow>;
};

export function WorkspaceRoutesTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyTitle>No routes yet</EmptyTitle>
        <EmptyDescription>
          Routes appear here as soon as a project exposes a public domain. Open a project's Networking screen to add one.
        </EmptyDescription>
      </Empty>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Domain</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ route, project }) => (
          <TableRow key={route.id}>
            <TableCell className="font-mono text-xs">{route.domain}</TableCell>
            <TableCell>
              <Link
                to="/project/$projectId"
                params={{ projectId: project.id }}
                className="text-sm hover:underline"
              >
                {project.name}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant="outline" className="text-[10px] uppercase">{route.type}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant={route.enabled ? "success" : "warning"}>
                {route.enabled ? "enabled" : "disabled"}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 7: Create `index.ts`**

```ts
export { WorkspaceRoutesTable } from "./components/workspace-routes-table";
export { useWorkspaceRoutes } from "./hooks/use-workspace-routes";
export type { WorkspaceRouteRow, WorkspaceRoutesInput } from "./types";
```

- [ ] **Step 8: Rewrite `routes/_dashboard/routing.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
  WorkspaceRoutesTable,
  useWorkspaceRoutes,
} from "@/features/workspace-routing";
import { client } from "@/utils/orpc";
import type { ProxyRouteFromApi } from "@/features/project-canvas/api/schema";

export const Route = createFileRoute("/_dashboard/routing")({
  component: RouteComponent,
});

function RouteComponent() {
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => client.project.list(),
  });
  const projects = projectsQuery.data ?? [];

  const routeQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["project-proxy-routes", project.id],
      queryFn: () => client.project.proxyRoute.list({ projectId: project.id }),
    })),
  });

  const routesByProject: Record<string, ReadonlyArray<ProxyRouteFromApi> | undefined> = {};
  projects.forEach((project, index) => {
    routesByProject[project.id] = routeQueries[index]?.data;
  });

  const rows = useWorkspaceRoutes({ projects, routesByProject });
  const isLoading = projectsQuery.isLoading || routeQueries.some((q) => q.isLoading);

  return (
    <div className="grid gap-4 p-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Routing</h1>
        <p className="text-sm text-muted-foreground">
          All public domains across your projects. Global Caddy config (TLS issuer, redirects, wildcards) lands in Plan 6.
        </p>
      </div>
      {isLoading ? <Skeleton className="h-64 w-full" /> : <WorkspaceRoutesTable rows={rows} />}
    </div>
  );
}
```

- [ ] **Step 9: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
git add apps/web/src/features/workspace-routing apps/web/src/routes/_dashboard/routing.tsx
git -c commit.gpgsign=false commit -m "feat(web): workspace routing aggregated table"
```

---

## Task 5: Workspace Servers — skeleton table

**Files:**
- Create: `apps/web/src/features/workspace-servers/types.ts`
- Create: `apps/web/src/features/workspace-servers/components/servers-table.tsx`
- Create: `apps/web/src/features/workspace-servers/index.ts`
- Modify: `apps/web/src/routes/_dashboard/servers.tsx`

No backend yet, but the IA must look real. Render a `Table` with the columns the eventual feature will have, an empty body, and an explicit "Server orchestration ships in Plan 6" message.

- [ ] **Step 1: Create `types.ts`**

```ts
export type ServerRow = {
  id: string;
  name: string;
  role: "manager" | "worker";
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  uptime: string;
  status: "ready" | "draining" | "down";
};
```

- [ ] **Step 2: Create `servers-table.tsx`**

```tsx
import { ServerIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";

export function ServersTable() {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Servers</h1>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button size="sm" disabled>
                + Add server
              </Button>
            }
          />
          <TooltipPopup>Server provisioning ships in Plan 6</TooltipPopup>
        </Tooltip>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>CPU</TableHead>
            <TableHead>Memory</TableHead>
            <TableHead>Disk</TableHead>
            <TableHead>Uptime</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* rows render here when the Swarm-nodes API ships */}
        </TableBody>
      </Table>

      <Empty>
        <ServerIcon className="size-6" />
        <EmptyTitle>No servers connected</EmptyTitle>
        <EmptyDescription>
          Add a server by pasting its Swarm join token to spread workloads across machines. Backend ships in Plan 6.
        </EmptyDescription>
      </Empty>
    </div>
  );
}
```

- [ ] **Step 3: Create `index.ts`**

```ts
export { ServersTable } from "./components/servers-table";
export type { ServerRow } from "./types";
```

- [ ] **Step 4: Rewrite `routes/_dashboard/servers.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { ServersTable } from "@/features/workspace-servers";

export const Route = createFileRoute("/_dashboard/servers")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="p-6">
      <ServersTable />
    </div>
  );
}
```

- [ ] **Step 5: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
git add apps/web/src/features/workspace-servers apps/web/src/routes/_dashboard/servers.tsx
git -c commit.gpgsign=false commit -m "feat(web): workspace servers skeleton screen"
```

---

## Task 6: Workspace Activity — empty feed with filter UI

**Files:**
- Create: `apps/web/src/features/workspace-activity/types.ts`
- Create: `apps/web/src/features/workspace-activity/components/activity-feed.tsx`
- Create: `apps/web/src/features/workspace-activity/index.ts`
- Modify: `apps/web/src/routes/_dashboard/activity.tsx`

- [ ] **Step 1: Create `types.ts`**

```ts
export type ActivityKind = "deploy" | "create" | "delete" | "update" | "auth";

export type ActivityRow = {
  id: string;
  kind: ActivityKind;
  actor: { id: string; name: string };
  object: { kind: "project" | "database" | "service" | "route"; name: string };
  occurredAt: string;
};
```

- [ ] **Step 2: Create `activity-feed.tsx`**

```tsx
import { ActivityIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@/components/ui/toolbar";

export function ActivityFeed() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">Audit trail across this workspace.</p>
      </div>

      <Toolbar className="flex items-center gap-1 rounded-lg border bg-background p-1">
        <ToolbarButton disabled>All actors</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton disabled>All kinds</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton disabled>Last 24h</ToolbarButton>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" disabled>Export</Button>
      </Toolbar>

      <Empty>
        <ActivityIcon className="size-6" />
        <EmptyTitle>No activity yet</EmptyTitle>
        <EmptyDescription>
          The audit log records every deploy, resource change, and admin action. Backend ships in Plan 6.
        </EmptyDescription>
      </Empty>
    </div>
  );
}
```

- [ ] **Step 3: Create `index.ts`**

```ts
export { ActivityFeed } from "./components/activity-feed";
export type { ActivityRow, ActivityKind } from "./types";
```

- [ ] **Step 4: Rewrite `routes/_dashboard/activity.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { ActivityFeed } from "@/features/workspace-activity";

export const Route = createFileRoute("/_dashboard/activity")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="p-6">
      <ActivityFeed />
    </div>
  );
}
```

- [ ] **Step 5: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
git add apps/web/src/features/workspace-activity apps/web/src/routes/_dashboard/activity.tsx
git -c commit.gpgsign=false commit -m "feat(web): workspace activity skeleton with filter toolbar"
```

---

## Task 7: Workspace Members — current-user table via better-auth

**Files:**
- Create: `apps/web/src/features/workspace-members/types.ts`
- Create: `apps/web/src/features/workspace-members/components/members-table.tsx`
- Create: `apps/web/src/features/workspace-members/index.ts`
- Modify: `apps/web/src/routes/_dashboard/members.tsx`

- [ ] **Step 1: Create `types.ts`**

```ts
export type WorkspaceRole = "owner" | "admin" | "deployer" | "viewer";

export type MemberRow = {
  id: string;
  name: string;
  email: string;
  role: WorkspaceRole;
};
```

- [ ] **Step 2: Create `members-table.tsx`**

```tsx
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth";
import type { MemberRow } from "../types";

export function MembersTable() {
  const session = authClient.useSession();

  if (session.isPending) {
    return <Skeleton className="h-64 w-full" />;
  }

  const me = session.data?.user;
  const rows: MemberRow[] = me
    ? [
        {
          id: me.id,
          name: me.name,
          email: me.email,
          role: "owner",
        },
      ]
    : [];

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <Tooltip>
          <TooltipTrigger render={<Button size="sm" disabled>+ Invite</Button>} />
          <TooltipPopup>RBAC + invitations ship in Plan 6</TooltipPopup>
        </Tooltip>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Avatar className="size-6 rounded">
                    <AvatarFallback className="text-[10px]">{row.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium">{row.name}</span>
                </div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{row.email}</TableCell>
              <TableCell>
                <Badge variant="outline" className="text-[10px] uppercase">{row.role}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 3: Create `index.ts`**

```ts
export { MembersTable } from "./components/members-table";
export type { MemberRow, WorkspaceRole } from "./types";
```

- [ ] **Step 4: Rewrite `routes/_dashboard/members.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { MembersTable } from "@/features/workspace-members";

export const Route = createFileRoute("/_dashboard/members")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="p-6">
      <MembersTable />
    </div>
  );
}
```

- [ ] **Step 5: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
git add apps/web/src/features/workspace-members apps/web/src/routes/_dashboard/members.tsx
git -c commit.gpgsign=false commit -m "feat(web): workspace members table with current user via better-auth"
```

---

## Task 8: Workspace Settings — `useActiveSection` hook + tests

**Files:**
- Create: `apps/web/src/features/workspace-settings/hooks/use-active-section.ts`
- Create: `apps/web/src/features/workspace-settings/hooks/use-active-section.test.ts`
- Create: `apps/web/src/features/workspace-settings/types.ts`

The hook tracks which section is currently scrolled into view by observing each section's heading via `IntersectionObserver`. Returns the active section id.

- [ ] **Step 1: Create `types.ts`**

```ts
export type SettingsSection = {
  id: string;
  label: string;
};
```

- [ ] **Step 2: Failing test `use-active-section.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useActiveSection } from "./use-active-section";
import type { SettingsSection } from "../types";

const sections: ReadonlyArray<SettingsSection> = [
  { id: "general", label: "General" },
  { id: "danger", label: "Danger" },
];

describe("useActiveSection", () => {
  it("starts with the first section active when nothing has been observed yet", () => {
    const { result } = renderHook(() => useActiveSection(sections));
    expect(result.current.activeId).toBe("general");
  });

  it("setActive updates the active id", () => {
    const { result } = renderHook(() => useActiveSection(sections));
    act(() => result.current.setActive("danger"));
    expect(result.current.activeId).toBe("danger");
  });

  it("ignores ids not in the section list", () => {
    const { result } = renderHook(() => useActiveSection(sections));
    act(() => result.current.setActive("not-a-section"));
    expect(result.current.activeId).toBe("general");
  });
});
```

- [ ] **Step 3: Run — expect fail**

- [ ] **Step 4: Implement `use-active-section.ts`**

```ts
import { useCallback, useState } from "react";
import type { SettingsSection } from "../types";

export function useActiveSection(sections: ReadonlyArray<SettingsSection>) {
  const [activeId, setActiveId] = useState<string>(() => sections[0]?.id ?? "");
  const setActive = useCallback(
    (id: string) => {
      if (sections.some((s) => s.id === id)) setActiveId(id);
    },
    [sections],
  );
  return { activeId, setActive };
}
```

- [ ] **Step 5: Run — expect 3 passing**

- [ ] **Step 6: Commit**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
git add apps/web/src/features/workspace-settings
git -c commit.gpgsign=false commit -m "feat(web): workspace-settings active-section hook with tests"
```

---

## Task 9: Workspace Settings — TOC sidebar + page

**Files:**
- Create: `apps/web/src/features/workspace-settings/components/toc-sidebar.tsx`
- Create: `apps/web/src/features/workspace-settings/components/settings-page.tsx`
- Create: `apps/web/src/features/workspace-settings/index.ts`
- Modify: `apps/web/src/routes/_dashboard/settings.tsx`

- [ ] **Step 1: Create `toc-sidebar.tsx`**

```tsx
import { cn } from "@/lib/utils";
import type { SettingsSection } from "../types";

type Props = {
  sections: ReadonlyArray<SettingsSection>;
  activeId: string;
  onJump: (id: string) => void;
};

export function TocSidebar({ sections, activeId, onJump }: Props) {
  return (
    <nav aria-label="Settings sections" className="sticky top-3 grid gap-1 self-start text-sm">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => onJump(section.id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-left transition-colors",
            section.id === activeId
              ? "bg-accent font-medium text-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Create `settings-page.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveSection } from "../hooks/use-active-section";
import type { SettingsSection } from "../types";
import { TocSidebar } from "./toc-sidebar";

const sections: ReadonlyArray<SettingsSection> = [
  { id: "general", label: "General" },
  { id: "identity", label: "Identity" },
  { id: "integrations", label: "Integrations" },
  { id: "billing", label: "Billing" },
  { id: "update-channel", label: "Update channel" },
  { id: "danger", label: "Danger zone" },
];

export function SettingsPage() {
  const { activeId, setActive } = useActiveSection(sections);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          const id = visible[0].target.getAttribute("data-section-id");
          if (id) setActive(id);
        }
      },
      { rootMargin: "-30% 0px -50% 0px", threshold: [0, 1] },
    );

    sections.forEach((section) => {
      const element = root.querySelector(`[data-section-id="${section.id}"]`);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [setActive]);

  const handleJump = (id: string) => {
    const element = containerRef.current?.querySelector(`[data-section-id="${id}"]`);
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="grid grid-cols-[1fr_180px] gap-8 p-6">
      <div ref={containerRef} className="grid gap-10">
        <h1 className="text-2xl font-semibold tracking-tight">Workspace settings</h1>
        <Section id="general" title="General">
          <Field>
            <FieldLabel htmlFor="ws-name">Workspace name</FieldLabel>
            <Input id="ws-name" defaultValue="otterstack" disabled />
            <FieldDescription>Persistence ships when the workspace settings API lands in Plan 6.</FieldDescription>
          </Field>
          <SaveButton />
        </Section>
        <Section id="identity" title="Identity & SSO">
          <p className="text-sm text-muted-foreground">SAML, OIDC, and SCIM provisioning configuration ships in Plan 6.</p>
        </Section>
        <Section id="integrations" title="Integrations">
          <p className="text-sm text-muted-foreground">GitHub, Resend, Inngest, Polar — connection management ships in Plan 6.</p>
        </Section>
        <Section id="billing" title="Billing">
          <p className="text-sm text-muted-foreground">Plan + invoices via Polar ships in Plan 6.</p>
        </Section>
        <Section id="update-channel" title="Update channel">
          <p className="text-sm text-muted-foreground">Stable / beta channel selector for self-hosted updates ships in Plan 6.</p>
        </Section>
        <Section id="danger" title="Danger zone">
          <Tooltip>
            <TooltipTrigger render={<Button variant="destructive" disabled>Delete workspace</Button>} />
            <TooltipPopup>Workspace deletion ships in Plan 6</TooltipPopup>
          </Tooltip>
        </Section>
      </div>
      <TocSidebar sections={sections} activeId={activeId} onJump={handleJump} />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section data-section-id={id} className="grid gap-4 scroll-mt-4">
      <h2 className="text-lg font-medium">{title}</h2>
      <div className="grid gap-4 rounded-xl border bg-card p-5">{children}</div>
    </section>
  );
}

function SaveButton() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button size="sm" className="w-fit" disabled>
            Save
          </Button>
        }
      />
      <TooltipPopup>Settings API ships in Plan 6</TooltipPopup>
    </Tooltip>
  );
}
```

- [ ] **Step 3: Create `apps/web/src/features/workspace-settings/index.ts`** (Task 8 deliberately did not create this barrel; it's created here once both the hook and the page exist)

```ts
export { SettingsPage } from "./components/settings-page";
export { useActiveSection } from "./hooks/use-active-section";
export type { SettingsSection } from "./types";
```

- [ ] **Step 4: Rewrite `routes/_dashboard/settings.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/features/workspace-settings";

export const Route = createFileRoute("/_dashboard/settings")({
  component: RouteComponent,
});

function RouteComponent() {
  return <SettingsPage />;
}
```

- [ ] **Step 5: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
git add apps/web/src/features/workspace-settings apps/web/src/routes/_dashboard/settings.tsx
git -c commit.gpgsign=false commit -m "feat(web): workspace settings long-scroll page with sticky TOC"
```

---

## Task 10: Final verification + PR

- [ ] **Step 1: Run full test suite**

```bash
cd apps/web && bun run test 2>&1 | tail -10
```

Expected: 25 (Plan 1+2) + 3 (useProjectSummaries) + 2 (ProjectCard) + 2 (useWorkspaceRoutes) + 3 (useActiveSection) = **35 tests** in 12 files. All passing.

- [ ] **Step 2: tsc clean**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
```

- [ ] **Step 3: Manual walk (optional)**

Open `bun dev`, sign in, walk every workspace screen:
- [ ] `/` — projects with mini-canvas previews; create-project dialog still works
- [ ] `/servers` — table header + empty state + disabled "+ Add"
- [ ] `/routing` — aggregated routes from all projects (or empty state)
- [ ] `/activity` — disabled filter toolbar + empty state
- [ ] `/members` — current user as owner + disabled invite
- [ ] `/settings` — long scroll with TOC, scrolling updates the active TOC item; clicking TOC scrolls to section

- [ ] **Step 4: Push branch + open PR delta**

The branch is already pushed (Plan 2 PR #5). Push the new commits:

```bash
git push origin feat/v2-rebuild
```

- [ ] **Step 5: Update PR description**

Use `gh pr edit 5 --body "$(cat <<'EOF' ... EOF)"` to update the PR description to include Plan 3 in the summary. Or comment on the PR with the Plan 3 delta. Whichever the maintainer prefers — for now, default to commenting:

```bash
gh pr comment 5 --repo artzkaizen/otterdeploy --body "$(cat <<'EOF'
### Plan 3 — Workspace Screens (added to this PR)

- **Projects** — workspace home redesigned with `MiniCanvasPreview` cards, real database + route counts via per-project queries, polished create-project dialog.
- **Routing** — aggregated proxy routes table across all projects (real data via `project.proxyRoute.list`).
- **Servers / Activity / Members / Settings** — IA-faithful skeleton screens with the eventual shape (Tables, Toolbars, sticky TOC, sections), backend wiring deferred to Plan 6 with explicit "lands in Plan 6" tooltips.
- **Members** — current user listed as owner via `authClient.useSession()`.
- **Settings** — long-scroll page with sticky TOC sidebar, IntersectionObserver-driven active-section detection.

Tests: 35 passing in 12 files. tsc clean for `apps/web/src/`.
EOF
)"
```

---

## Done — what's next

After Plan 3 lands, **Plan 4** ships real Logs (Ghostty terminal), Deployments tab content, Variables tab content, project-level Networking screen. **Plan 5** wires the command palette to real actions, hardens performance, and adds smoke tests. **Plan 6** is everything currently labeled "ships in Plan 6" — Servers/Swarm-nodes API, Activity audit log, Members RBAC, workspace Settings persistence, global Caddy config.

# Frontend Rebuild — Plan 4: Logs / Deployments / Variables / Project Networking

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill in the project sub-screens that Plans 1-3 left as Empty placeholders. Mount the Ghostty terminal in the Logs tab and full-page Logs route (with a stubbed feed), upgrade Deployments and Variables drawer tabs + routes to structural Tables, and wire the project Networking route to the real `project.proxyRoute.list` data.

**Architecture:** A single `LogsTerminal` feature wraps `@wterm/react`'s `Terminal` and lazy-loads the Ghostty WASM core (~400KB) only when the component actually mounts. The drawer's Logs tab and the project-level `/project/$id/logs` route both consume this component, parametrized by what to subscribe to (a single resource vs. all services in the project). For Plan 4, both feed the terminal a fixed demo string explaining where the real log source will plug in (Plan 6: the server's WebSocket gateway). Deployments and Variables become coss `Table`-shaped pages with empty states and disabled write CTAs. Project Networking is the only screen with a real backend in Plan 4 — uses the existing `project.proxyRoute.list` per-project query, renders a routes table.

**Tech Stack:** No new deps. coss UI primitives (Table, Tabs, Toolbar, Empty, Field, Tooltip, Badge, Button, Skeleton, Sheet). `@wterm/ghostty` + `@wterm/react` (already installed Plan 1) lazy-loaded.

**Spec:** `docs/superpowers/specs/2026-05-02-frontend-rebuild-design.md` §4 (drawers + per-project IA), §6 (per-screen sketches), §10 (`@wterm/ghostty` lazy load), §11 (project routes).

**Foundation in place:** Plans 1-3 shipped at HEAD `bab141d`. The drawer's Logs/Deployments/Variables tabs are currently `Empty` stubs from Plan 2 Task 9. The project routes for `logs/networking/variables/deployments` are Plan 1 placeholders.

**Out of scope for this plan:**
- **Real log streaming** — no server-side log gateway yet. The terminal mounts and shows a fixed multi-line "Log streaming ships when the server provides a WebSocket gateway (Plan 6)" message; the websocket plumbing itself is Plan 6.
- **Variables CRUD** — no `project.variable.*` API. The page renders an empty Table with a disabled "+ Add variable" CTA (tooltip → Plan 6).
- **Deployments history** — no `project.deployment.*` API. Same skeleton-with-disabled-CTA treatment.
- **Networking write operations** — `project.proxyRoute.list` exists but no create/update/delete. The page reads + renders; edit/add/delete actions are disabled.
- **Bulk env import / Caddy fragment editor** — both deferred to Plan 6 once their APIs ship.

---

## File map

```
apps/web/src/
  features/
    logs-terminal/
      components/
        logs-terminal.tsx                      ← CREATE (lazy-loads Ghostty + @wterm/react Terminal)
      types.ts                                 ← CREATE
      index.ts                                 ← CREATE
    project-deployments/
      components/
        deployments-table.tsx                  ← CREATE (skeleton table + empty state)
      types.ts                                 ← CREATE
      index.ts                                 ← CREATE
    project-variables/
      components/
        variables-table.tsx                    ← CREATE (skeleton table + disabled add CTA)
      types.ts                                 ← CREATE
      index.ts                                 ← CREATE
    project-networking/
      components/
        project-routes-table.tsx               ← CREATE (real proxyRoute.list data)
      types.ts                                 ← CREATE
      index.ts                                 ← CREATE
    resource-drawer/
      components/tabs/
        logs-tab.tsx                           ← MODIFY (replace Empty stub with <LogsTerminal/>)
        deployments-tab.tsx                    ← MODIFY (richer skeleton)
        variables-tab.tsx                      ← MODIFY (richer skeleton)
  routes/
    project/$projectId/
      logs.tsx                                 ← REWRITE (full-page Logs)
      deployments.tsx                          ← REWRITE (full-page Deployments)
      variables.tsx                            ← REWRITE (full-page Variables)
      networking.tsx                           ← REWRITE (full-page Networking, real data)
```

---

## Conventions for every task

- **No new deps.** Bun, coss UI strictly, one-line WHY comments only.
- **No `Co-Authored-By` trailers**, plain `git commit -m "..."` with `-c commit.gpgsign=false`. Specific paths in `git add`.
- **All commits on `feat/v2-rebuild`**.
- **`bun run tsc --noEmit` is the type-check signal.** Filter the unrelated `packages/api/src/swarm/postgres.ts` errors.
- **Lazy-load Ghostty WASM.** Use `React.lazy()` + `Suspense` so the ~400KB binary doesn't ship on the initial bundle.
- **Skeletons must look real** — actual coss `Table` headers + Toolbar chrome. The "ships in Plan 6" copy lives in a small footer or tooltip, not in a giant takeover.

---

## Task 1: LogsTerminal component (lazy-loaded Ghostty)

**Files:**
- Create: `apps/web/src/features/logs-terminal/types.ts`
- Create: `apps/web/src/features/logs-terminal/components/logs-terminal.tsx`
- Create: `apps/web/src/features/logs-terminal/index.ts`

The component is a lazy boundary: imports `@wterm/react`'s `Terminal` and `@wterm/ghostty`'s `GhosttyCore` only when actually rendered. Accepts a `subscribeTo` prop describing what context to label the demo feed for (project-wide vs. per-resource).

- [ ] **Step 1: Create `types.ts`**

```ts
export type LogsScope =
  | { kind: "project"; projectId: string }
  | { kind: "resource"; projectId: string; resourceId: string; resourceName: string };
```

- [ ] **Step 2: Create `logs-terminal.tsx`**

```tsx
import { Suspense, lazy, useEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { LogsScope } from "../types";
import type { TerminalHandle } from "@wterm/react";

// Lazy: ~400KB Ghostty WASM core only loads when this component mounts.
// Renamed the inner @wterm/react Terminal to WTermTerminal to avoid shadowing
// the outer lazy-wrapper binding.
const Terminal = lazy(async () => {
  const [{ Terminal: WTermTerminal }, { GhosttyCore }] = await Promise.all([
    import("@wterm/react"),
    import("@wterm/ghostty"),
  ]);

  const core = await GhosttyCore.load();

  return {
    default: function GhosttyTerminal({
      scope,
      onReady,
    }: {
      scope: LogsScope;
      onReady: (handle: TerminalHandle) => void;
    }) {
      return (
        <WTermTerminal
          core={core}
          autoResize
          theme="dark"
          ref={(handle) => {
            if (handle) onReady(handle);
          }}
          className="h-full w-full"
          aria-label={
            scope.kind === "project"
              ? `Logs for project ${scope.projectId}`
              : `Logs for ${scope.resourceName}`
          }
        />
      );
    },
  };
});

type Props = {
  scope: LogsScope;
};

const PLACEHOLDER_BANNER = [
  "\x1b[1;33m─── otterdeploy logs (Plan 6 will wire real streaming) ───\x1b[0m",
  "",
  "The Ghostty terminal is mounted, sized, and ready to receive log data.",
  "When the server's WebSocket log gateway ships, this terminal will tail",
  "logs in real time, with filter, search, and time-range support.",
  "",
];

function bannerForScope(scope: LogsScope): string[] {
  if (scope.kind === "project") {
    return [
      ...PLACEHOLDER_BANNER,
      `\x1b[2mscope:\x1b[0m project=${scope.projectId} (all services)`,
      "",
    ];
  }
  return [
    ...PLACEHOLDER_BANNER,
    `\x1b[2mscope:\x1b[0m resource=${scope.resourceName} (${scope.resourceId})`,
    "",
  ];
}

export function LogsTerminal({ scope }: Props) {
  const handleRef = useRef<TerminalHandle | null>(null);

  // Re-emit the placeholder when scope changes so users see it reflect their selection.
  const lines = bannerForScope(scope).join("\r\n");
  useEffect(() => {
    handleRef.current?.write(lines + "\r\n");
  }, [lines]);

  return (
    <div className="h-full w-full bg-zinc-950">
      <Suspense fallback={<Skeleton className="h-full w-full" />}>
        <Terminal
          scope={scope}
          onReady={(handle) => {
            handleRef.current = handle;
            handle.write(lines + "\r\n");
          }}
        />
      </Suspense>
    </div>
  );
}
```

If `@wterm/react`'s ref callback API differs from the typed `TerminalHandle`, adapt. If `theme` doesn't accept `"dark"`, drop the prop (the bg color comes from the wrapping div).

- [ ] **Step 3: Create `index.ts`**

```ts
export { LogsTerminal } from "./components/logs-terminal";
export type { LogsScope } from "./types";
```

- [ ] **Step 4: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
git add apps/web/src/features/logs-terminal
git -c commit.gpgsign=false commit -m "feat(web): logs-terminal feature (lazy ghostty wrapper)"
```

---

## Task 2: Wire LogsTerminal into drawer Logs tab

**Files:**
- Modify: `apps/web/src/features/resource-drawer/components/tabs/logs-tab.tsx`
- Modify: `apps/web/src/features/resource-drawer/components/resource-drawer.tsx` (pass resource name to LogsTab)

The drawer's Logs tab needs `projectId`, `resourceId`, and `resourceName` to scope the logs to a single resource.

- [ ] **Step 1: Rewrite `logs-tab.tsx`**

```tsx
import { LogsTerminal } from "@/features/logs-terminal";

type Props = {
  projectId: string;
  resourceId: string;
  resourceName: string;
};

export function LogsTab({ projectId, resourceId, resourceName }: Props) {
  return (
    <div className="h-[calc(100vh-220px)] min-h-[320px]">
      <LogsTerminal scope={{ kind: "resource", projectId, resourceId, resourceName }} />
    </div>
  );
}
```

- [ ] **Step 2: Update `resource-drawer.tsx` to pass the props through**

Find the `<TabsPanel value="logs">` block and replace its `<LogsTab />` with the props-passing variant:

```tsx
<TabsPanel value="logs" className="flex-1 overflow-y-auto">
  {selection.kind === "database" ? (
    <LogsTab
      projectId={selection.projectId}
      resourceId={selection.resourceId}
      resourceName={resourceName}
    />
  ) : null}
</TabsPanel>
```

- [ ] **Step 3: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
git add apps/web/src/features/resource-drawer
git -c commit.gpgsign=false commit -m "feat(web): mount LogsTerminal in drawer logs tab"
```

---

## Task 3: Project-level Logs route

**Files:**
- Rewrite: `apps/web/src/routes/project/$projectId/logs.tsx`

Full-page logs view: top filter chrome (disabled service multi-select / time range / severity / search — all "lands in Plan 6") + main terminal pane + sticky right activity rail (placeholder).

- [ ] **Step 1: Rewrite `logs.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { ActivityIcon, SearchIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@/components/ui/toolbar";
import { LogsTerminal } from "@/features/logs-terminal";

export const Route = createFileRoute("/project/$projectId/logs")({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectId } = Route.useParams();
  return (
    <div className="grid h-full grid-cols-[1fr_280px] gap-3 p-3">
      <div className="grid grid-rows-[auto_1fr] gap-2 min-h-0">
        <Toolbar className="flex items-center gap-1 rounded-lg border bg-background p-1">
          <Input placeholder="Filter and search logs…" className="h-7 w-64 border-0 bg-transparent" disabled>
            <SearchIcon className="size-4" />
          </Input>
          <ToolbarSeparator />
          <ToolbarButton disabled>All services</ToolbarButton>
          <ToolbarSeparator />
          <ToolbarButton disabled>All severities</ToolbarButton>
          <ToolbarSeparator />
          <ToolbarButton disabled>Last 15 min</ToolbarButton>
        </Toolbar>
        <div className="min-h-0 overflow-hidden rounded-lg border">
          <LogsTerminal scope={{ kind: "project", projectId }} />
        </div>
      </div>

      <aside className="grid gap-2 self-start rounded-lg border bg-background p-3 text-sm">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <ActivityIcon className="size-3" /> Activity
        </div>
        <Empty>
          <EmptyTitle>No recent activity</EmptyTitle>
          <EmptyDescription>Deploys, restarts, and cert renewals appear here. Backend ships in Plan 6.</EmptyDescription>
        </Empty>
      </aside>
    </div>
  );
}
```

If `<Input>` doesn't support arbitrary children for an icon adornment, drop the inner `<SearchIcon />` and just leave the placeholder text. The filter chrome is illustrative — disabled state is what matters.

- [ ] **Step 2: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
git add apps/web/src/routes/project/$projectId/logs.tsx
git -c commit.gpgsign=false commit -m "feat(web): project-level logs route with terminal + filter chrome"
```

---

## Task 4: Project Deployments — feature + drawer tab + route

**Files:**
- Create: `apps/web/src/features/project-deployments/types.ts`
- Create: `apps/web/src/features/project-deployments/components/deployments-table.tsx`
- Create: `apps/web/src/features/project-deployments/index.ts`
- Modify: `apps/web/src/features/resource-drawer/components/tabs/deployments-tab.tsx`
- Rewrite: `apps/web/src/routes/project/$projectId/deployments.tsx`

- [ ] **Step 1: types.ts**

```ts
export type DeploymentStatus = "queued" | "building" | "deploying" | "success" | "failed" | "rolled-back";

export type DeploymentRow = {
  id: string;
  serviceName: string;
  commit: { sha: string; message: string };
  author: { name: string };
  status: DeploymentStatus;
  durationSeconds: number;
  startedAt: string;
};
```

- [ ] **Step 2: deployments-table.tsx**

```tsx
import { RotateCcwIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@/components/ui/toolbar";

type Props = {
  scope: "project" | "resource";
};

export function DeploymentsTable({ scope }: Props) {
  return (
    <div className="grid gap-3">
      <Toolbar className="flex items-center gap-1 rounded-lg border bg-background p-1">
        <ToolbarButton disabled>All services</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton disabled>All statuses</ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton disabled>Last 7 days</ToolbarButton>
      </Toolbar>

      <Table>
        <TableHeader>
          <TableRow>
            {scope === "project" ? <TableHead>Service</TableHead> : null}
            <TableHead>Commit</TableHead>
            <TableHead>Author</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Started</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Rows render here when project.deployment.list ships in Plan 6 */}
        </TableBody>
      </Table>

      <Empty>
        <RotateCcwIcon className="size-6" />
        <EmptyTitle>No deployments yet</EmptyTitle>
        <EmptyDescription>
          Build and deploy history shows up here. Backend ships in Plan 6.
        </EmptyDescription>
      </Empty>

      <Badge variant="outline" className="w-fit text-[10px]">
        scope: {scope}
      </Badge>
    </div>
  );
}
```

- [ ] **Step 3: index.ts**

```ts
export { DeploymentsTable } from "./components/deployments-table";
export type { DeploymentRow, DeploymentStatus } from "./types";
```

- [ ] **Step 4: Update drawer tab `deployments-tab.tsx`**

```tsx
import { DeploymentsTable } from "@/features/project-deployments";

export function DeploymentsTab() {
  return (
    <div className="p-4">
      <DeploymentsTable scope="resource" />
    </div>
  );
}
```

- [ ] **Step 5: Rewrite `routes/project/$projectId/deployments.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { DeploymentsTable } from "@/features/project-deployments";

export const Route = createFileRoute("/project/$projectId/deployments")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid gap-4 p-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Deployments</h1>
        <p className="text-sm text-muted-foreground">
          Build + deploy history across this project's services and environments.
        </p>
      </div>
      <DeploymentsTable scope="project" />
    </div>
  );
}
```

- [ ] **Step 6: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
git add apps/web/src/features/project-deployments apps/web/src/features/resource-drawer/components/tabs/deployments-tab.tsx apps/web/src/routes/project/$projectId/deployments.tsx
git -c commit.gpgsign=false commit -m "feat(web): project deployments table (skeleton, drawer + route)"
```

---

## Task 5: Project Variables — feature + drawer tab + route

**Files:**
- Create: `apps/web/src/features/project-variables/types.ts`
- Create: `apps/web/src/features/project-variables/components/variables-table.tsx`
- Create: `apps/web/src/features/project-variables/index.ts`
- Modify: `apps/web/src/features/resource-drawer/components/tabs/variables-tab.tsx`
- Rewrite: `apps/web/src/routes/project/$projectId/variables.tsx`

- [ ] **Step 1: types.ts**

```ts
export type VariableScope = "project" | "resource";

export type VariableRow = {
  key: string;
  /** Always returned masked from the API (e.g. "sk_***"). Plan 6 ships reveal-on-demand. */
  maskedValue: string;
  referencedBy: ReadonlyArray<{ kind: "service" | "database"; name: string }>;
};
```

- [ ] **Step 2: variables-table.tsx**

```tsx
import { KeyRoundIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import type { VariableScope } from "../types";

type Props = {
  scope: VariableScope;
};

export function VariablesTable({ scope }: Props) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-end gap-2">
        <Tooltip>
          <TooltipTrigger render={<Button size="sm" variant="outline" disabled>Bulk import</Button>} />
          <TooltipPopup>Paste a .env file when the variables API ships (Plan 6)</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button size="sm" disabled>+ Add variable</Button>} />
          <TooltipPopup>Variable CRUD ships in Plan 6</TooltipPopup>
        </Tooltip>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Referenced by</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Rows render here when project.variable.list ships in Plan 6 */}
        </TableBody>
      </Table>

      <Empty>
        <KeyRoundIcon className="size-6" />
        <EmptyTitle>No variables yet</EmptyTitle>
        <EmptyDescription>
          {scope === "project"
            ? "Shared env vars become referenceable from any service via ${shared.X}. Backend ships in Plan 6."
            : "Resource-scoped env vars override shared ones. Backend ships in Plan 6."}
        </EmptyDescription>
      </Empty>
    </div>
  );
}
```

- [ ] **Step 3: index.ts**

```ts
export { VariablesTable } from "./components/variables-table";
export type { VariableRow, VariableScope } from "./types";
```

- [ ] **Step 4: Update drawer tab `variables-tab.tsx`**

```tsx
import { VariablesTable } from "@/features/project-variables";

export function VariablesTab() {
  return (
    <div className="p-4">
      <VariablesTable scope="resource" />
    </div>
  );
}
```

- [ ] **Step 5: Rewrite `routes/project/$projectId/variables.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { VariablesTable } from "@/features/project-variables";

export const Route = createFileRoute("/project/$projectId/variables")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid gap-4 p-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Variables</h1>
        <p className="text-sm text-muted-foreground">
          Shared env vars per environment, referenced from services as{" "}
          <code className="text-xs">{"${shared.X}"}</code>.
        </p>
      </div>
      <VariablesTable scope="project" />
    </div>
  );
}
```

- [ ] **Step 6: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
git add apps/web/src/features/project-variables apps/web/src/features/resource-drawer/components/tabs/variables-tab.tsx apps/web/src/routes/project/$projectId/variables.tsx
git -c commit.gpgsign=false commit -m "feat(web): project variables table (skeleton, drawer + route)"
```

---

## Task 6: Project Networking — feature + route (real proxyRoute data)

**Files:**
- Create: `apps/web/src/features/project-networking/types.ts`
- Create: `apps/web/src/features/project-networking/components/project-routes-table.tsx`
- Create: `apps/web/src/features/project-networking/index.ts`
- Rewrite: `apps/web/src/routes/project/$projectId/networking.tsx`

This is the only screen in Plan 4 with real data. Reads `client.project.proxyRoute.list({ projectId })` and renders a Table with domain / type / upstream / status. Edit/Delete/Add are disabled (Plan 6).

- [ ] **Step 1: types.ts**

```ts
import type { ProxyRouteFromApi } from "@/features/project-canvas/api/schema";

export type ProjectRouteRow = {
  route: ProxyRouteFromApi;
};
```

- [ ] **Step 2: project-routes-table.tsx**

```tsx
import { Share2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProjectRouteRow } from "../types";

type Props = {
  rows: ReadonlyArray<ProjectRouteRow>;
};

export function ProjectRoutesTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <Empty>
        <Share2Icon className="size-6" />
        <EmptyTitle>No routes yet</EmptyTitle>
        <EmptyDescription>
          Add a public domain to expose a service or database. Editor ships in Plan 6.
        </EmptyDescription>
      </Empty>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Domain</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Upstream</TableHead>
          <TableHead>Status</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ route }) => (
          <TableRow key={route.id}>
            <TableCell className="font-mono text-xs">{route.domain}</TableCell>
            <TableCell>
              <Badge variant="outline" className="text-[10px] uppercase">{route.type}</Badge>
            </TableCell>
            <TableCell className="font-mono text-xs">{route.upstreamHost}:{route.upstreamPort}</TableCell>
            <TableCell>
              <Badge variant={route.enabled ? "success" : "warning"}>
                {route.enabled ? "enabled" : "disabled"}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <Tooltip>
                <TooltipTrigger render={<Button size="xs" variant="outline" disabled>Edit</Button>} />
                <TooltipPopup>Route editor ships in Plan 6</TooltipPopup>
              </Tooltip>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

If coss `Button` doesn't support `size="xs"`, drop to `size="sm"`.

- [ ] **Step 3: index.ts**

```ts
export { ProjectRoutesTable } from "./components/project-routes-table";
export type { ProjectRouteRow } from "./types";
```

- [ ] **Step 4: Rewrite `routes/project/$projectId/networking.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { ProjectRoutesTable } from "@/features/project-networking";
import { client } from "@/utils/orpc";

export const Route = createFileRoute("/project/$projectId/networking")({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectId } = Route.useParams();
  const query = useQuery({
    queryKey: ["project-proxy-routes", projectId],
    queryFn: () => client.project.proxyRoute.list({ projectId }),
  });

  return (
    <div className="grid gap-4 p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Networking</h1>
          <p className="text-sm text-muted-foreground">
            Public domains for this project. Caddy fragment editor + add/edit/delete ships in Plan 6.
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger render={<Button size="sm" disabled>+ Add route</Button>} />
          <TooltipPopup>Route editor ships in Plan 6</TooltipPopup>
        </Tooltip>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <Alert variant="error">
          <AlertCircle />
          <AlertTitle>Couldn't load routes</AlertTitle>
          <AlertDescription>
            {query.error instanceof Error ? query.error.message : "Unknown error"}
          </AlertDescription>
        </Alert>
      ) : (
        <ProjectRoutesTable rows={(query.data ?? []).map((route) => ({ route }))} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Type-check + commit**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
git add apps/web/src/features/project-networking apps/web/src/routes/project/$projectId/networking.tsx
git -c commit.gpgsign=false commit -m "feat(web): project networking route with real proxy routes table"
```

---

## Task 7: Final verification + push + PR comment

- [ ] **Step 1: Run full test suite**

```bash
cd apps/web && bun run test 2>&1 | tail -10
```

Expected: still **35 tests** in 12 files (Plan 4 doesn't add new tests — all changes are presentation/integration). All passing.

- [ ] **Step 2: tsc clean**

```bash
cd apps/web && bun run tsc --noEmit 2>&1 | grep -v "packages/api/src/swarm/postgres.ts" | grep "error TS" || echo "clean"
```

- [ ] **Step 3: Manual walk (optional, requires browser + dev server)**

```bash
cd apps/web && bun dev
```

Confirm:
- [ ] Open a project canvas, click a database node → drawer Logs tab → terminal mounts and shows the placeholder banner with the resource name
- [ ] Visit `/project/$id/logs` → full-page terminal with project-scoped placeholder banner; filter chrome disabled; right activity rail shows empty
- [ ] Visit `/project/$id/deployments` → table headers + empty state + disabled filters
- [ ] Visit `/project/$id/variables` → table headers + disabled "+ Add" / "Bulk import" tooltips
- [ ] Visit `/project/$id/networking` → real routes table if any exist, otherwise empty state; "+ Add route" disabled with tooltip
- [ ] All other previously-shipped routes still work

- [ ] **Step 4: Push**

```bash
git push origin feat/v2-rebuild
```

- [ ] **Step 5: PR comment for Plan 4 delta**

```bash
gh pr comment 5 --repo artzkaizen/otterdeploy --body "$(cat <<'EOF'
### Plan 4 — Logs / Deployments / Variables / Networking (added to this PR)

**Real, wired-up:**
- **Project Networking** (`/project/$id/networking`) — real `project.proxyRoute.list` data rendered in a `ProjectRoutesTable` (domain / type / upstream / status). Edit and Add disabled until Plan 6 ships the editor.
- **Logs terminal** — Ghostty WASM core lazy-loaded via `React.lazy()` inside a `Suspense` boundary; mounts in both the drawer Logs tab and the full-page `/project/$id/logs` route. Renders a placeholder banner per scope (project vs resource) until the server's WebSocket log gateway ships.

**IA-faithful skeletons (backends ship in Plan 6):**
- **Project Deployments** (`/project/$id/deployments` + drawer) — `DeploymentsTable` with the eventual columns (Service / Commit / Author / Status / Duration / Started), filter toolbar, empty state.
- **Project Variables** (`/project/$id/variables` + drawer) — `VariablesTable` with Key / Value / Referenced-by columns, disabled "+ Add" and "Bulk import" CTAs.

**Tests:** still 35 passing in 12 files (no new tests — Plan 4 is integration / presentation).

**Type-check:** clean for `apps/web/src/`.

**Up next:** Plan 5 (⌘K real actions, websocket-driven status, virtualization, smoke tests). Plan 6 covers backend wiring for everything tagged "Plan 6" in this PR.
EOF
)"
```

---

## Done — what's next

Plan 5 wires the command palette to real navigation actions, plumbs websocket-driven status into the canvas, virtualizes long lists, and adds smoke tests per route. Plan 6 is everything currently tagged "ships in Plan 6" — Logs WebSocket gateway, Servers/Swarm-nodes, Activity audit log, Members/RBAC, Deployments/Variables/Settings/Caddy backends.

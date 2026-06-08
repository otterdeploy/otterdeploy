# Frontend Rebuild — Plan 1: Foundation & Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the new app shell — workspace + project shells, outer/inner rails, breadcrumb with env+workspace switchers, ⌘K skeleton, all v1 routes reachable as placeholders, restyled auth — so subsequent plans can fill in real screens behind a stable shell.

**Architecture:** TanStack Router file-based routes (`routeToken: "layout"`) under `apps/web/src/routes/`. Two reusable shells (`WorkspaceShell`, `ProjectShell`) compose breadcrumb bar, outer rail, optional inner rail, and a content slot. coss ui primitives only — no handrolled replacements. Feature-folder structure under `apps/web/src/features/`. Dark-first via existing `ThemeProvider` (defaultTheme already `"dark"`); add an amber brand accent token. Tests via vitest + testing-library; no vitest config exists yet so we add one.

**Tech Stack:** React 19, TanStack Router, TanStack Query, coss ui (in-tree at `components/ui/`), Tailwind v4, motion/react, lucide-react, sonner, vitest, @testing-library/react, jsdom. New deps: `@wterm/ghostty`, `@wterm/react`, `@tanstack/react-virtual` (added now even though only Plans 4–5 use them, so deps live in one commit).

**Spec:** `docs/superpowers/specs/2026-05-02-frontend-rebuild-design.md`. Read §3 (direction), §4 (IA), §5 (layout shell), §7 (component conventions), §11 (keep/scrap), §13 (folder layout) before starting. This plan implements the *empty-but-correct* version of the shell — real screen content lands in Plans 2-5.

**Out of scope for this plan:**
- Real Canvas, Logs, Networking, Variables, Deployments, Settings content (Plans 2-4)
- Service drawer, mini-canvas previews (Plan 2)
- Project list redesign, mini-canvas, real Servers/Routing/Activity/Members content (Plan 3)
- ⌘K real actions (Plan 5) — only the open/close skeleton lands here
- WebSocket-driven status, virtualization, lazy-loading Ghostty (Plan 5)

---

## File map (created or modified by this plan)

```
apps/web/
  package.json                                                          ← MODIFY (add deps)
  vitest.config.ts                                                       ← CREATE (carries its own /// <reference types="vitest" />)
  vitest.setup.ts                                                        ← CREATE
  src/
    index.css                                                            ← MODIFY (add --brand-* tokens)
    routes/
      __root.tsx                                                         ← KEEP AS-IS (audit only)
      _dashboard/
        layout.tsx                                                       ← REWRITE → WorkspaceShell
        index.tsx                                                        ← LEAVE for Plan 3 (still functional)
        playground.tsx                                                   ← DELETE (Task 3)
        servers.tsx                                                      ← CREATE (placeholder)
        routing.tsx                                                      ← CREATE (placeholder)
        activity.tsx                                                     ← CREATE (placeholder)
        members.tsx                                                      ← CREATE (placeholder)
        settings.tsx                                                     ← CREATE (placeholder)
        project/
          layout.tsx                                                     ← KEEP (still bare <Outlet/>; project shell moves down a level)
          $projectId/
            layout.tsx                                                   ← REWRITE (currently full canvas; becomes thin ProjectShell wrapper, Task 13)
            index.tsx                                                    ← CREATE (canvas placeholder)
            observability.tsx                                            ← DELETE (existing; v1.1 IA, Plan 4)
            settings.tsx                                                 ← DELETE then RECREATE (Task 14 placeholder)
            logs.tsx                                                     ← CREATE (placeholder)
            networking.tsx                                               ← CREATE (placeholder)
            variables.tsx                                                ← CREATE (placeholder)
            deployments.tsx                                              ← CREATE (placeholder)
      auth/
        layout.tsx                                                       ← KEEP
        sign-in.tsx                                                      ← KEEP
        sign-up.tsx                                                      ← KEEP
    features/
      auth/form/sign-in.tsx                                              ← REWRITE (coss Form/Field)
      auth/form/sign-up.tsx                                              ← REWRITE (coss Form/Field)
      environment-switcher/                                              ← DELETE (entire folder, in Task 13)
      env-switcher/
        components/env-switcher-dropdown.tsx                             ← CREATE
        components/env-switcher-dropdown.test.tsx                        ← CREATE
        types.ts                                                         ← CREATE
        index.ts                                                         ← CREATE
      workspace-switcher/
        components/workspace-switcher-dropdown.tsx                       ← CREATE
        types.ts                                                         ← CREATE
        index.ts                                                         ← CREATE
      command-palette/
        components/command-palette.tsx                                   ← CREATE
        components/command-palette.test.tsx                              ← CREATE
        hooks/use-command-palette.ts                                     ← CREATE
        index.ts                                                         ← CREATE
    components/
      shell/
        outer-rail.tsx                                                   ← CREATE
        outer-rail.test.tsx                                              ← CREATE
        inner-rail.tsx                                                   ← CREATE
        inner-rail.test.tsx                                              ← CREATE
        breadcrumb-bar.tsx                                               ← CREATE
        workspace-shell.tsx                                              ← CREATE
        project-shell.tsx                                                ← CREATE
        rail-items.ts                                                    ← CREATE (typed item arrays)
      header.tsx                                                         ← DELETE (folded into shells)
      mode-toggle.tsx                                                    ← KEEP (used by shell)
      theme-provider.tsx                                                 ← KEEP
      user-menu.tsx                                                      ← MOVE → shell/user-menu.tsx (path update)
      loader.tsx                                                         ← KEEP
    test/
      utils.tsx                                                          ← CREATE (renderWithRouter helper)
```

---

## Conventions for every task

- **TDD where the unit has logic.** Pure presentation rails with no branching get a smoke test (renders + has-expected-text); logic-bearing units (env switcher reading/writing search params, command palette hotkey binding) get failing-test-first.
- **Imports use the `@/` alias** (already configured in `vite.config.ts`).
- **coss components only.** If you reach for a `<div className="...">` that duplicates a coss primitive, stop and use the primitive.
- **No new comments** beyond one-line "WHY" comments for non-obvious code (per repo CLAUDE.md).
- **One commit per task.** Conventional commits style. Don't squash within a task.
- **All commits go on `feat/v2-rebuild`** (current branch).

---

## Task 1: Add dependencies & set up vitest

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/vitest.setup.ts`
- Create: `apps/web/src/test/utils.tsx`

- [ ] **Step 1: Add runtime deps**

```bash
cd apps/web
bun add @wterm/ghostty @wterm/react @tanstack/react-virtual
```

- [ ] **Step 2: Create `apps/web/vitest.config.ts`**

```ts
/// <reference types="vitest" />
import path from "node:path";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tanstackRouter({ routeToken: "layout" }), react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
    css: false,
  },
});
```

- [ ] **Step 3: Create `apps/web/vitest.setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 4: Add a `test` script to `apps/web/package.json`**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Create `apps/web/src/test/utils.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

export function renderWithRouter(ui: ReactElement, initialPath = "/"): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => ui });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => ui });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {/* @ts-expect-error - test-only router */}
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
```

- [ ] **Step 6: Sanity-check the runner**

```bash
cd apps/web && bun run test
```
Expected: "No test files found" (exit code may be non-zero — that's fine for now). If vitest complains about config, fix the config until it loads.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/bun.lock apps/web/vitest.config.ts apps/web/vitest.setup.ts apps/web/vite.config.ts apps/web/src/test/utils.tsx
git commit -m "chore(web): add wterm/ghostty, react-virtual, vitest config"
```

---

## Task 2: Add brand-amber accent tokens

**Files:**
- Modify: `apps/web/src/index.css`

The dark theme is already configured (default in `ThemeProvider`); we only need otterdeploy's amber brand accent so primary CTAs and the otter logo can use a token, not a hex.

- [ ] **Step 1: Append brand tokens at the end of `:root`**

In `apps/web/src/index.css`, inside the `:root { ... }` block (after `--code-highlight`), add:

```css
  --brand: var(--color-amber-500);
  --brand-foreground: var(--color-white);
  --brand-muted: --alpha(var(--color-amber-500) / 12%);
```

- [ ] **Step 2: Append matching dark overrides**

Inside the `.dark { ... }` block, add at the end:

```css
  --brand: var(--color-amber-500);
  --brand-foreground: var(--color-amber-50);
  --brand-muted: --alpha(var(--color-amber-500) / 16%);
```

- [ ] **Step 3: Expose tokens via `@theme inline`**

In the `@theme inline { ... }` block, add:

```css
  --color-brand: var(--brand);
  --color-brand-foreground: var(--brand-foreground);
  --color-brand-muted: var(--brand-muted);
```

- [ ] **Step 4: Verify `bun dev` still renders**

```bash
cd apps/web && bun dev
```
Open the dev URL. Expected: app loads dark, no console errors, no missing-token warnings.
Stop the dev server with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/index.css
git commit -m "feat(web): add brand-amber accent tokens"
```

---

## Task 3: Delete playground route

**Files:**
- Delete: `apps/web/src/routes/_dashboard/playground.tsx`

The old `features/environment-switcher/` folder cannot be deleted yet — it has two consumers (`hooks/use-invalidation-socket.ts` and the existing `routes/_dashboard/project/$projectId/layout.tsx` canvas). Both are properly handled in Task 13, which rewrites the canvas layout to be a thin ProjectShell wrapper, drops the stale env collection refetch, and only then deletes the old feature folder.

- [ ] **Step 1: Confirm no imports reference the playground path**

```bash
cd apps/web && grep -rn "_dashboard/playground" src/ | grep -v routeTree.gen.ts || echo "clean"
```
Should print "clean" — only `routeTree.gen.ts` should match (autogenerated; safe to ignore).

- [ ] **Step 2: Delete the file**

```bash
rm apps/web/src/routes/_dashboard/playground.tsx
```

- [ ] **Step 3: Regenerate the route tree**

```bash
cd apps/web && bun run typecheck
```
This runs `tsr generate && tsc --noEmit`. Expected: clean type-check; the regenerated `routeTree.gen.ts` no longer references `playground`. Pre-existing errors in unrelated files are out of scope.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_dashboard apps/web/src/routeTree.gen.ts
git -c commit.gpgsign=false commit -m "chore(web): remove playground route"
```

---

## Task 4: Outer rail (workspace icon nav)

**Files:**
- Create: `apps/web/src/components/shell/rail-items.ts`
- Create: `apps/web/src/components/shell/outer-rail.tsx`
- Create: `apps/web/src/components/shell/outer-rail.test.tsx`

Per spec §4 outer rail items: Projects, Servers, Routing, Activity, Members, Settings (Volumes/Templates excluded from v1).

- [ ] **Step 1: Create `apps/web/src/components/shell/rail-items.ts`**

```ts
import {
  ActivityIcon,
  CogIcon,
  LayoutGridIcon,
  NetworkIcon,
  ServerIcon,
  UsersIcon,
  type LucideIcon,
  // project rail icons:
  BoxIcon,
  KeyRoundIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  SettingsIcon,
  Share2Icon,
} from "lucide-react";

export type RailItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
};

export const outerRailItems: ReadonlyArray<RailItem> = [
  { id: "projects", label: "Projects", href: "/", icon: LayoutGridIcon },
  { id: "servers", label: "Servers", href: "/servers", icon: ServerIcon },
  { id: "routing", label: "Routing", href: "/routing", icon: NetworkIcon },
  { id: "activity", label: "Activity", href: "/activity", icon: ActivityIcon },
  { id: "members", label: "Members", href: "/members", icon: UsersIcon },
  { id: "settings", label: "Settings", href: "/settings", icon: CogIcon },
];

export const innerRailItems: ReadonlyArray<RailItem> = [
  { id: "canvas", label: "Canvas", href: "", icon: BoxIcon },
  { id: "logs", label: "Logs", href: "logs", icon: ScrollTextIcon },
  { id: "networking", label: "Networking", href: "networking", icon: Share2Icon },
  { id: "variables", label: "Variables", href: "variables", icon: KeyRoundIcon },
  { id: "deployments", label: "Deployments", href: "deployments", icon: RotateCcwIcon },
  { id: "settings", label: "Settings", href: "settings", icon: SettingsIcon },
];
```

- [ ] **Step 2: Write the failing test `apps/web/src/components/shell/outer-rail.test.tsx`**

```tsx
import { describe, expect, it } from "vitest";
import { renderWithRouter } from "@/test/utils";
import { OuterRail } from "./outer-rail";

describe("OuterRail", () => {
  it("renders one icon per outer rail item", () => {
    const { container } = renderWithRouter(<OuterRail currentHref="/" />);
    const links = container.querySelectorAll("a[data-rail-item]");
    expect(links.length).toBe(6);
  });

  it("marks the link matching currentHref as active", () => {
    const { container } = renderWithRouter(<OuterRail currentHref="/servers" />);
    const active = container.querySelector('a[data-rail-item][data-active="true"]');
    expect(active?.getAttribute("href")).toBe("/servers");
  });

  it("treats nested project routes as Projects-active", () => {
    const { container } = renderWithRouter(<OuterRail currentHref="/project/abc123" />);
    const active = container.querySelector('a[data-rail-item][data-active="true"]');
    expect(active?.getAttribute("href")).toBe("/");
  });
});
```

- [ ] **Step 3: Run test — expect failure (file does not yet exist)**

```bash
cd apps/web && bun run test src/components/shell/outer-rail.test.tsx
```
Expected: cannot resolve `./outer-rail`.

- [ ] **Step 4: Create `apps/web/src/components/shell/outer-rail.tsx`**

```tsx
import { Link } from "@tanstack/react-router";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { outerRailItems, type RailItem } from "./rail-items";

type Props = {
  currentHref: string;
};

function isActive(item: RailItem, currentHref: string): boolean {
  if (item.href === "/") {
    return currentHref === "/" || currentHref.startsWith("/project");
  }
  return currentHref === item.href || currentHref.startsWith(item.href + "/");
}

export function OuterRail({ currentHref }: Props) {
  return (
    <nav
      aria-label="Workspace navigation"
      className="flex h-full w-12 flex-col items-center gap-1 border-r border-border bg-sidebar py-3"
    >
      {outerRailItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item, currentHref);
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger
              render={
                <Link
                  to={item.href}
                  data-rail-item
                  data-active={active}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md text-sidebar-foreground transition-colors",
                    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    active && "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </Link>
              }
            />
            <TooltipPopup side="right">{item.label}</TooltipPopup>
          </Tooltip>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 5: Run tests — expect 3 passing**

```bash
cd apps/web && bun run test src/components/shell/outer-rail.test.tsx
```
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/shell
git commit -m "feat(web): outer rail with active-route detection"
```

---

## Task 5: Inner rail (project icon nav)

**Files:**
- Create: `apps/web/src/components/shell/inner-rail.tsx`
- Create: `apps/web/src/components/shell/inner-rail.test.tsx`

The inner rail's `href` values in `rail-items.ts` are *relative segments* (e.g. `"logs"`); the component prepends `/project/${projectId}/`.

- [ ] **Step 1: Write failing tests `apps/web/src/components/shell/inner-rail.test.tsx`**

```tsx
import { describe, expect, it } from "vitest";
import { renderWithRouter } from "@/test/utils";
import { InnerRail } from "./inner-rail";

describe("InnerRail", () => {
  it("renders 6 items", () => {
    const { container } = renderWithRouter(
      <InnerRail projectId="abc" currentHref="/project/abc" />,
    );
    expect(container.querySelectorAll("a[data-rail-item]").length).toBe(6);
  });

  it("Canvas link points to /project/$id (no trailing segment)", () => {
    const { container } = renderWithRouter(
      <InnerRail projectId="abc" currentHref="/project/abc" />,
    );
    const canvas = container.querySelector('a[data-rail-item][data-id="canvas"]');
    expect(canvas?.getAttribute("href")).toBe("/project/abc");
  });

  it("highlights Canvas when on the project root", () => {
    const { container } = renderWithRouter(
      <InnerRail projectId="abc" currentHref="/project/abc" />,
    );
    expect(
      container.querySelector('a[data-rail-item][data-id="canvas"]')?.getAttribute("data-active"),
    ).toBe("true");
  });

  it("highlights Logs when on /project/$id/logs", () => {
    const { container } = renderWithRouter(
      <InnerRail projectId="abc" currentHref="/project/abc/logs" />,
    );
    expect(
      container.querySelector('a[data-rail-item][data-id="logs"]')?.getAttribute("data-active"),
    ).toBe("true");
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd apps/web && bun run test src/components/shell/inner-rail.test.tsx
```

- [ ] **Step 3: Create `apps/web/src/components/shell/inner-rail.tsx`**

```tsx
import { Link } from "@tanstack/react-router";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { innerRailItems } from "./rail-items";

type Props = {
  projectId: string;
  currentHref: string;
};

function buildHref(projectId: string, segment: string): string {
  return segment === "" ? `/project/${projectId}` : `/project/${projectId}/${segment}`;
}

function isActive(href: string, currentHref: string): boolean {
  if (href === currentHref) return true;
  // Canvas is active only on exact match; sub-routes match prefix.
  return href !== `/project/${href.split("/")[2]}` && currentHref.startsWith(href + "/");
}

export function InnerRail({ projectId, currentHref }: Props) {
  return (
    <nav
      aria-label="Project navigation"
      className="flex h-full w-12 flex-col items-center gap-1 border-r border-border bg-sidebar py-3"
    >
      {innerRailItems.map((item) => {
        const Icon = item.icon;
        const href = buildHref(projectId, item.href);
        const active = isActive(href, currentHref);
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger
              render={
                <Link
                  to={href}
                  data-rail-item
                  data-id={item.id}
                  data-active={active}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md text-sidebar-foreground transition-colors",
                    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    active && "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </Link>
              }
            />
            <TooltipPopup side="right">{item.label}</TooltipPopup>
          </Tooltip>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run tests — expect 4 passing**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shell
git commit -m "feat(web): inner rail (project nav) with active-route detection"
```

---

## Task 6: Env switcher dropdown (reads/writes ?env=)

**Files:**
- Create: `apps/web/src/features/env-switcher/types.ts`
- Create: `apps/web/src/features/env-switcher/components/env-switcher-dropdown.tsx`
- Create: `apps/web/src/features/env-switcher/components/env-switcher-dropdown.test.tsx`
- Create: `apps/web/src/features/env-switcher/index.ts`

Per spec §4: env switcher lives in the top-bar breadcrumb when inside a project; reads/writes the `env` search param.

- [ ] **Step 1: Create `apps/web/src/features/env-switcher/types.ts`**

```ts
export type EnvName = "development" | "staging" | "production";

export type EnvOption = {
  name: EnvName;
  label: string;
  color: "emerald" | "amber" | "rose";
};

export const envOptions: ReadonlyArray<EnvOption> = [
  { name: "development", label: "Dev", color: "emerald" },
  { name: "staging", label: "Staging", color: "amber" },
  { name: "production", label: "Prod", color: "rose" },
];
```

- [ ] **Step 2: Write failing tests `env-switcher-dropdown.test.tsx`**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EnvSwitcherDropdown } from "./env-switcher-dropdown";

describe("EnvSwitcherDropdown", () => {
  it("renders the current env label", () => {
    render(<EnvSwitcherDropdown current="production" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /prod/i })).toBeInTheDocument();
  });

  it("calls onChange with the new env when an option is selected", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<EnvSwitcherDropdown current="production" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /prod/i }));
    await user.click(await screen.findByRole("menuitem", { name: /dev/i }));
    expect(onChange).toHaveBeenCalledWith("development");
  });
});
```

- [ ] **Step 3: Run — expect failure**

```bash
cd apps/web && bun run test src/features/env-switcher
```

- [ ] **Step 4: Create the component `env-switcher-dropdown.tsx`**

```tsx
import { ChevronsUpDownIcon } from "lucide-react";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { envOptions, type EnvName } from "../types";

const dotByColor: Record<"emerald" | "amber" | "rose", string> = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
};

type Props = {
  current: EnvName;
  onChange: (next: EnvName) => void;
};

export function EnvSwitcherDropdown({ current, onChange }: Props) {
  const active = envOptions.find((e) => e.name === current) ?? envOptions[0];
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            className="inline-flex h-7 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs hover:bg-accent"
          >
            <span className={cn("size-1.5 rounded-full", dotByColor[active.color])} />
            <span className="font-medium">{active.label}</span>
            <ChevronsUpDownIcon className="size-3 opacity-60" />
          </button>
        }
      />
      <MenuPopup className="min-w-32">
        {envOptions.map((option) => (
          <MenuItem
            key={option.name}
            onClick={() => onChange(option.name)}
            data-active={option.name === current}
          >
            <span className={cn("size-1.5 rounded-full", dotByColor[option.color])} />
            {option.label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
```

- [ ] **Step 5: Create `apps/web/src/features/env-switcher/index.ts`**

```ts
export { EnvSwitcherDropdown } from "./components/env-switcher-dropdown";
export { envOptions, type EnvName, type EnvOption } from "./types";
```

- [ ] **Step 6: Run tests — expect 2 passing**

If `Menu` exports differ from coss expectations, open `apps/web/src/components/ui/menu.tsx` and align names.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/env-switcher
git commit -m "feat(web): env switcher dropdown (top-bar)"
```

---

## Task 7: Workspace switcher dropdown (placeholder data)

**Files:**
- Create: `apps/web/src/features/workspace-switcher/types.ts`
- Create: `apps/web/src/features/workspace-switcher/components/workspace-switcher-dropdown.tsx`
- Create: `apps/web/src/features/workspace-switcher/index.ts`

Real workspace data wires up in Plan 3. Here we render a placeholder list driven by props so the breadcrumb doesn't depend on a query that doesn't exist yet.

- [ ] **Step 1: Create `types.ts`**

```ts
export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "deployer" | "viewer";
};
```

- [ ] **Step 2: Create `workspace-switcher-dropdown.tsx`**

```tsx
import { ChevronsUpDownIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Menu, MenuItem, MenuPopup, MenuTrigger, MenuSeparator } from "@/components/ui/menu";
import type { WorkspaceSummary } from "../types";

type Props = {
  current: WorkspaceSummary;
  workspaces: ReadonlyArray<WorkspaceSummary>;
  onSelect: (workspaceId: string) => void;
};

export function WorkspaceSwitcherDropdown({ current, workspaces, onSelect }: Props) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            className="inline-flex h-7 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent"
          >
            <Avatar className="size-5 rounded">
              <AvatarFallback className="text-[10px]">{current.name.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="font-medium">{current.name}</span>
            <ChevronsUpDownIcon className="size-3 opacity-60" />
          </button>
        }
      />
      <MenuPopup className="min-w-56">
        {workspaces.map((ws) => (
          <MenuItem key={ws.id} onClick={() => onSelect(ws.id)}>
            <Avatar className="size-5 rounded">
              <AvatarFallback className="text-[10px]">{ws.name.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span>{ws.name}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{ws.role}</span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onClick={() => onSelect("__create__")}>+ New workspace</MenuItem>
      </MenuPopup>
    </Menu>
  );
}
```

- [ ] **Step 3: Create `index.ts`**

```ts
export { WorkspaceSwitcherDropdown } from "./components/workspace-switcher-dropdown";
export type { WorkspaceSummary } from "./types";
```

- [ ] **Step 4: Type-check passes**

```bash
cd apps/web && bun run typecheck
```

If `MenuSeparator` isn't exported from `@/components/ui/menu`, drop it and use `Separator` from `@/components/ui/separator`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace-switcher
git commit -m "feat(web): workspace switcher dropdown (placeholder data)"
```

---

## Task 8: Breadcrumb bar (top-bar shell component)

**Files:**
- Create: `apps/web/src/components/shell/breadcrumb-bar.tsx`

The breadcrumb shows: workspace switcher · (project name dropdown when in a project) · env switcher (when in a project) · spacer · ⌘K hint · alerts · user menu.

- [ ] **Step 1: Create `breadcrumb-bar.tsx`**

```tsx
import type { ReactNode } from "react";
import { BellIcon } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { ModeToggle } from "@/components/mode-toggle";
import { UserMenu } from "@/components/user-menu";
import {
  WorkspaceSwitcherDropdown,
  type WorkspaceSummary,
} from "@/features/workspace-switcher";

type Props = {
  workspace: WorkspaceSummary;
  workspaces: ReadonlyArray<WorkspaceSummary>;
  onSelectWorkspace: (workspaceId: string) => void;
  /** Optional middle slot rendered between workspace switcher and the spacer (e.g. project + env switcher). */
  middle?: ReactNode;
  onOpenCommandPalette: () => void;
};

export function BreadcrumbBar({
  workspace,
  workspaces,
  onSelectWorkspace,
  middle,
  onOpenCommandPalette,
}: Props) {
  return (
    <header className="flex h-10 items-center gap-2 border-b border-border bg-background px-3 text-sm">
      <WorkspaceSwitcherDropdown
        current={workspace}
        workspaces={workspaces}
        onSelect={onSelectWorkspace}
      />
      {middle ? (
        <>
          <Separator orientation="vertical" className="mx-1 h-4" />
          {middle}
        </>
      ) : null}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="inline-flex h-7 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent"
      >
        <span>Search</span>
        <Kbd>⌘K</Kbd>
      </button>
      <button
        type="button"
        aria-label="Notifications"
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
      >
        <BellIcon className="size-4" />
      </button>
      <ModeToggle />
      <UserMenu />
    </header>
  );
}
```

- [ ] **Step 2: Verify imports compile**

```bash
cd apps/web && bun run typecheck
```
If `Kbd` is named differently in `apps/web/src/components/ui/kbd.tsx`, adjust import.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/shell/breadcrumb-bar.tsx
git commit -m "feat(web): breadcrumb bar with command-palette trigger"
```

---

## Task 9: Command palette skeleton + ⌘K hotkey

**Files:**
- Create: `apps/web/src/features/command-palette/hooks/use-command-palette.ts`
- Create: `apps/web/src/features/command-palette/components/command-palette.tsx`
- Create: `apps/web/src/features/command-palette/components/command-palette.test.tsx`
- Create: `apps/web/src/features/command-palette/index.ts`

Real actions are wired in Plan 5; here we wire ⌘K to open a coss `Command` modal that just shows an "Actions coming in v1.1" empty state. This lands the binding once and proves the wiring.

- [ ] **Step 1: Create `use-command-palette.ts`**

```ts
import { useEffect, useState } from "react";

export function useCommandPalette(): {
  open: boolean;
  setOpen: (next: boolean) => void;
  toggle: () => void;
} {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      const isModK = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
      if (!isModK) return;
      event.preventDefault();
      setOpen((prev) => !prev);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen, toggle: () => setOpen((p) => !p) };
}
```

- [ ] **Step 2: Failing test for the hook + component `command-palette.test.tsx`**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./command-palette";

describe("CommandPalette", () => {
  it("is closed by default", () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on Cmd+K", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect failure (no component yet)**

- [ ] **Step 4: Create `command-palette.tsx`**

```tsx
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogPopup } from "@/components/ui/dialog";
import { useCommandPalette } from "../hooks/use-command-palette";

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="max-w-xl gap-0 p-0">
        <Command>
          <CommandInput placeholder="Type a command or search…" />
          <CommandList>
            <CommandEmpty>Actions coming soon.</CommandEmpty>
          </CommandList>
        </Command>
      </DialogPopup>
    </Dialog>
  );
}
```

- [ ] **Step 5: Create `index.ts`**

```ts
export { CommandPalette } from "./components/command-palette";
export { useCommandPalette } from "./hooks/use-command-palette";
```

- [ ] **Step 6: Run tests — expect 3 passing**

```bash
cd apps/web && bun run test src/features/command-palette
```

If coss `Command`/`Dialog` API differs (e.g. trigger requires a `<DialogTrigger>` even when controlling via `open` prop), adapt to the actual signatures from `apps/web/src/components/ui/{command,dialog}.tsx`. Keep tests as the contract.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/command-palette
git commit -m "feat(web): command-palette skeleton with cmd+k binding"
```

---

## Task 10: Workspace shell composition

**Files:**
- Create: `apps/web/src/components/shell/workspace-shell.tsx`

This is the layout used by all `/_dashboard/*` routes. It composes BreadcrumbBar + OuterRail + (optional InnerRail) + main content slot.

- [ ] **Step 1: Create `workspace-shell.tsx`**

```tsx
import type { ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { OuterRail } from "./outer-rail";
import { BreadcrumbBar } from "./breadcrumb-bar";
import type { WorkspaceSummary } from "@/features/workspace-switcher";

const placeholderWorkspace: WorkspaceSummary = {
  id: "ws_default",
  name: "otterdeploy",
  slug: "otterdeploy",
  role: "owner",
};

const placeholderWorkspaces: ReadonlyArray<WorkspaceSummary> = [placeholderWorkspace];

type Props = {
  /** Optional middle breadcrumb content (project switcher + env switcher). */
  middle?: ReactNode;
  /** Optional second rail (rendered to the right of OuterRail when set). */
  innerRail?: ReactNode;
  children: ReactNode;
};

export function WorkspaceShell({ middle, innerRail, children }: Props) {
  const navigate = useNavigate();
  const location = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="grid h-svh grid-rows-[auto_1fr]">
      <BreadcrumbBar
        workspace={placeholderWorkspace}
        workspaces={placeholderWorkspaces}
        onSelectWorkspace={() => {
          // real wiring lands in Plan 3
        }}
        middle={middle}
        onOpenCommandPalette={() => {
          // CommandPalette listens globally on cmd+k; we trigger by simulating it
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
        }}
      />
      <div className="grid min-h-0 grid-cols-[auto_auto_1fr]">
        <OuterRail currentHref={location} />
        {innerRail ?? <div />}
        <main className="min-h-0 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check passes**

```bash
cd apps/web && bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/shell/workspace-shell.tsx
git commit -m "feat(web): workspace shell composition"
```

---

## Task 11: Project shell composition

**Files:**
- Create: `apps/web/src/components/shell/project-shell.tsx`

ProjectShell wraps WorkspaceShell, providing the inner rail and the project+env middle breadcrumb.

- [ ] **Step 1: Create `project-shell.tsx`**

```tsx
import type { ReactNode } from "react";
import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { Separator } from "@/components/ui/separator";
import { EnvSwitcherDropdown, type EnvName } from "@/features/env-switcher";
import { InnerRail } from "./inner-rail";
import { WorkspaceShell } from "./workspace-shell";

type Props = {
  projectId: string;
  projectName: string;
  children: ReactNode;
};

export function ProjectShell({ projectId, projectName, children }: Props) {
  const navigate = useNavigate();
  const location = useRouterState({ select: (s) => s.location.pathname });
  const search = useSearch({ strict: false }) as { env?: EnvName };
  const currentEnv: EnvName = (search.env ?? "development") as EnvName;

  const middle = (
    <div className="flex items-center gap-2">
      <span className="font-medium">{projectName}</span>
      <Separator orientation="vertical" className="h-4" />
      <EnvSwitcherDropdown
        current={currentEnv}
        onChange={(next) =>
          navigate({ to: location, search: (prev) => ({ ...prev, env: next }) })
        }
      />
    </div>
  );

  return (
    <WorkspaceShell
      middle={middle}
      innerRail={<InnerRail projectId={projectId} currentHref={location} />}
    >
      {children}
    </WorkspaceShell>
  );
}
```

- [ ] **Step 2: Type-check passes**

```bash
cd apps/web && bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/shell/project-shell.tsx
git commit -m "feat(web): project shell composition"
```

---

## Task 12: Replace `_dashboard/layout.tsx` with WorkspaceShell

**Files:**
- Modify: `apps/web/src/routes/_dashboard/layout.tsx`
- Modify: `apps/web/src/main.tsx` (mount CommandPalette once globally)

- [ ] **Step 1: Rewrite `_dashboard/layout.tsx`**

```tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { WorkspaceShell } from "@/components/shell/workspace-shell";

export const Route = createFileRoute("/_dashboard")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <WorkspaceShell>
      <Outlet />
    </WorkspaceShell>
  );
}
```

- [ ] **Step 2: Mount the command palette once globally in `main.tsx`**

Update `apps/web/src/main.tsx` so that `<CommandPalette />` is rendered once at the app root. Change the `Wrap` callback:

```tsx
import { CommandPalette } from "@/features/command-palette";
// ...
const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPendingComponent: () => <Loader />,
  context: { orpc, queryClient },
  Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
        <CommandPalette />
      </QueryClientProvider>
    );
  },
});
```

- [ ] **Step 3: Verify dev server**

```bash
cd apps/web && bun dev
```
Open the URL, sign in, navigate to `/`. Expected: outer rail renders on the left, breadcrumb on top with workspace switcher and ⌘K trigger; pressing ⌘K opens an empty command palette. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_dashboard/layout.tsx apps/web/src/main.tsx
git commit -m "feat(web): wire WorkspaceShell into dashboard layout"
```

---

## Task 13: Rewrite project canvas layout as ProjectShell + clean up environment-switcher

**Files:**
- Keep: `apps/web/src/routes/_dashboard/project/layout.tsx` (still bare `<Outlet/>`)
- Rewrite: `apps/web/src/routes/_dashboard/project/$projectId/layout.tsx` (currently the full canvas; replace with a thin ProjectShell wrapper)
- Create: `apps/web/src/routes/_dashboard/project/$projectId/index.tsx` (canvas placeholder for Plan 2)
- Modify: `apps/web/src/hooks/use-invalidation-socket.ts` (drop the `envCollection.utils.refetch()` import & call)
- Delete: `apps/web/src/features/environment-switcher/` (entire folder — only reachable now after the two consumers above are detached)
- Delete: `apps/web/src/routes/_dashboard/project/$projectId/observability.tsx` (existing experiment; the new IA puts observability in v1.1, not v1)
- Delete: `apps/web/src/routes/_dashboard/project/$projectId/settings.tsx` (existing settings page; Task 14 creates the new placeholder)

**Why this is consolidated into Task 13 and not earlier:** the existing `$projectId/layout.tsx` does triple duty (Route definition, env-switcher hotkeys, ReactFlow canvas, database drawer). We can't safely delete `environment-switcher/` until this layout file no longer imports from it. Plan 2 rebuilds the canvas with new node components; for Plan 1 we just need the layout to be the shell so all the other v1 routes can mount under it.

The existing canvas content (ReactFlow + database drawer + hotkeys) is intentionally NOT preserved here — it will be rebuilt cleanly in Plan 2 around the new `GroupNode` / `ServiceNode` / `DatabaseNode` / `RoutingNode` / `VolumeNode` design. Until then, opening a project shows a "Canvas lands in Plan 2" Empty placeholder.

- [ ] **Step 1: Drop the env-collection refetch from `use-invalidation-socket.ts`**

In `apps/web/src/hooks/use-invalidation-socket.ts`, remove the `envCollection` import (line 3) and the `envCollection.utils.refetch()` call inside the WebSocket message handler. The remaining `queryClient.invalidateQueries({ queryKey: [data.resource] })` line continues to work generically.

After edit, the message handler should look like:

```ts
ws.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "invalidate") {
    queryClient.invalidateQueries({ queryKey: [data.resource] });
  }
});
```

Add `import { queryClient } from "@/utils/orpc";` at the top if it isn't already there (it currently imports `envCollection` from `environment-switcher/api` and references `envCollection.utils.queryClient` — switch to importing the queryClient directly).

- [ ] **Step 2: Rewrite `apps/web/src/routes/_dashboard/project/$projectId/layout.tsx`**

Replace the entire file (currently the full canvas) with the thin ProjectShell wrapper:

```tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";
import * as z from "zod";
import { ProjectShell } from "@/components/shell/project-shell";

const search = z.object({
  env: z.enum(["development", "staging", "production"]).default("development"),
});

export const Route = createFileRoute("/_dashboard/project/$projectId")({
  validateSearch: search,
  component: RouteComponent,
});

function RouteComponent() {
  const { projectId } = Route.useParams();
  return (
    <ProjectShell projectId={projectId} projectName={projectId}>
      <Outlet />
    </ProjectShell>
  );
}
```

The canvas guts (ReactFlow, database drawer, hotkeys) are deliberately discarded. Plan 2 rebuilds them with the new node design.

- [ ] **Step 3: Delete the existing observability and settings routes inside `$projectId/`**

```bash
rm apps/web/src/routes/_dashboard/project/$projectId/observability.tsx
rm apps/web/src/routes/_dashboard/project/$projectId/settings.tsx
```

These were earlier experiments. Task 14 recreates them as Empty-state placeholders that fit the new IA (settings is v1, observability is v1.1).

- [ ] **Step 4: Delete the old `environment-switcher` feature folder**

```bash
rm -r apps/web/src/features/environment-switcher
```

- [ ] **Step 5: Verify no remaining importers of environment-switcher**

```bash
cd apps/web && grep -rn "features/environment-switcher" src/ || echo "clean"
```
Must print "clean" before continuing.

- [ ] **Step 6: Create the canvas placeholder `$projectId/index.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export const Route = createFileRoute("/_dashboard/project/$projectId/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid h-full place-items-center p-8">
      <Empty>
        <EmptyTitle>Canvas</EmptyTitle>
        <EmptyDescription>
          Project canvas lands in Plan 2. Services, databases, volumes, and routing show up here.
        </EmptyDescription>
      </Empty>
    </div>
  );
}
```

- [ ] **Step 7: Type-check + verify route generation**

```bash
cd apps/web && bun run typecheck
```
Expected: `routeTree.gen.ts` regenerates without observability and settings under `$projectId/` (Task 14 will re-add settings as a placeholder). No new type errors compared to before this task.

If `Empty`'s subcomponent names differ in coss, open `apps/web/src/components/ui/empty.tsx` and adapt.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/routes/_dashboard/project apps/web/src/features apps/web/src/hooks/use-invalidation-socket.ts apps/web/src/routeTree.gen.ts
git -c commit.gpgsign=false commit -m "feat(web): project shell layout + canvas placeholder; drop old environment-switcher"
```

---

## Task 14: Placeholder routes for the remaining v1 screens

**Files (create all):**
- `apps/web/src/routes/_dashboard/servers.tsx`
- `apps/web/src/routes/_dashboard/routing.tsx`
- `apps/web/src/routes/_dashboard/activity.tsx`
- `apps/web/src/routes/_dashboard/members.tsx`
- `apps/web/src/routes/_dashboard/settings.tsx`
- `apps/web/src/routes/_dashboard/project/$projectId/logs.tsx`
- `apps/web/src/routes/_dashboard/project/$projectId/networking.tsx`
- `apps/web/src/routes/_dashboard/project/$projectId/variables.tsx`
- `apps/web/src/routes/_dashboard/project/$projectId/deployments.tsx`
- `apps/web/src/routes/_dashboard/project/$projectId/settings.tsx`

Each is a 15-line placeholder. Repeat the same template for each, swapping the path and labels.

- [ ] **Step 1: Create the helper placeholder template — apply once per screen**

Template (substitute `$PATH`, `$TITLE`, `$DESC`, `$PLAN`):

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export const Route = createFileRoute("$PATH")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="grid h-full place-items-center p-8">
      <Empty>
        <EmptyTitle>$TITLE</EmptyTitle>
        <EmptyDescription>$DESC Lands in $PLAN.</EmptyDescription>
      </Empty>
    </div>
  );
}
```

Apply with these values:

| File | `$PATH` | `$TITLE` | `$DESC` | `$PLAN` |
|---|---|---|---|---|
| `_dashboard/servers.tsx` | `/_dashboard/servers` | `Servers` | `Swarm nodes, CPU/mem/disk meters, drain & remove.` | `Plan 3` |
| `_dashboard/routing.tsx` | `/_dashboard/routing` | `Routing` | `Global Caddyfile root: domains, certs, redirects.` | `Plan 3` |
| `_dashboard/activity.tsx` | `/_dashboard/activity` | `Activity` | `Workspace audit log.` | `Plan 3` |
| `_dashboard/members.tsx` | `/_dashboard/members` | `Members` | `RBAC, invitations, personal access tokens.` | `Plan 3` |
| `_dashboard/settings.tsx` | `/_dashboard/settings` | `Settings` | `Workspace name, SSO, integrations, billing.` | `Plan 3` |
| `_dashboard/project/$projectId/logs.tsx` | `/_dashboard/project/$projectId/logs` | `Logs` | `Live tail across services, filter by service & severity.` | `Plan 4` |
| `_dashboard/project/$projectId/networking.tsx` | `/_dashboard/project/$projectId/networking` | `Networking` | `Project Caddy fragment, custom domains, TLS.` | `Plan 4` |
| `_dashboard/project/$projectId/variables.tsx` | `/_dashboard/project/$projectId/variables` | `Variables` | `Shared env vars per environment.` | `Plan 4` |
| `_dashboard/project/$projectId/deployments.tsx` | `/_dashboard/project/$projectId/deployments` | `Deployments` | `History across services and environments.` | `Plan 4` |
| `_dashboard/project/$projectId/settings.tsx` | `/_dashboard/project/$projectId/settings` | `Settings` | `Long-scroll settings page with sticky TOC.` | `Plan 4` |

- [ ] **Step 2: Type-check + route generation**

```bash
cd apps/web && bun run typecheck
```
Expected: every new route appears in `routeTree.gen.ts`.

- [ ] **Step 3: Manual verification**

```bash
cd apps/web && bun dev
```
Visit each route in the browser. Each should render the Empty placeholder with rails + breadcrumb intact. ⌘K should still open the palette on every screen. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes apps/web/src/routeTree.gen.ts
git commit -m "feat(web): placeholder routes for v1 workspace and project screens"
```

---

## Task 15: Restyle auth forms with coss Field/Form

**Files:**
- Modify: `apps/web/src/features/auth/form/sign-in.tsx`
- Modify: `apps/web/src/features/auth/form/sign-up.tsx`

The current forms use ad-hoc `text-red-500` and a hardcoded `text-indigo-600` link. Switch to coss `Field` (which owns label, control, error styling) and the `link` button variant.

- [ ] **Step 1: Rewrite `sign-in.tsx`**

```tsx
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import * as z from "zod";

import { authClient } from "@/lib/auth";
import Loader from "@/components/loader";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export default function SignInForm({ onSwitchToSignUp }: { onSwitchToSignUp: () => void }) {
  const navigate = useNavigate({ from: "/" });
  const { isPending } = authClient.useSession();

  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      await authClient.signIn.email(value, {
        onSuccess: () => {
          navigate({ to: "/" });
          toast.success("Signed in");
        },
        onError: (error) => toast.error(error.error.message || error.error.statusText),
      });
    },
    validators: {
      onSubmit: z.object({
        email: z.email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    },
  });

  if (isPending) return <Loader />;

  return (
    <div className="mx-auto mt-10 w-full max-w-md p-6">
      <h1 className="mb-6 text-center text-2xl font-semibold">Welcome back</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-4"
      >
        <form.Field name="email">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Email</FieldLabel>
              <FieldControl>
                <Input
                  id={field.name}
                  type="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FieldControl>
              {field.state.meta.errors[0]?.message ? (
                <FieldError>{field.state.meta.errors[0].message}</FieldError>
              ) : null}
            </Field>
          )}
        </form.Field>

        <form.Field name="password">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Password</FieldLabel>
              <FieldControl>
                <Input
                  id={field.name}
                  type="password"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FieldControl>
              {field.state.meta.errors[0]?.message ? (
                <FieldError>{field.state.meta.errors[0].message}</FieldError>
              ) : null}
            </Field>
          )}
        </form.Field>

        <form.Subscribe>
          {(state) => (
            <Button type="submit" className="w-full" disabled={!state.canSubmit || state.isSubmitting}>
              {state.isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <div className="mt-4 text-center">
        <Button variant="link" onClick={onSwitchToSignUp}>
          Need an account? Sign up
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mirror the same pattern for `sign-up.tsx`**

Open `apps/web/src/features/auth/form/sign-up.tsx`, apply the same transformation: replace the ad-hoc div + `text-red-500 <p>` patterns with `Field` / `FieldLabel` / `FieldControl` / `FieldError`. Keep all existing form fields, validators, and submit handlers untouched.

- [ ] **Step 3: Verify auth still works**

```bash
cd apps/web && bun dev
```
Sign out, hit the sign-in route, sign in with a test account. The form should validate, errors should render via coss `FieldError`. Stop the dev server.

- [ ] **Step 4: Type-check**

```bash
cd apps/web && bun run typecheck
```
If `Field` subcomponent names in coss differ (e.g. `FieldErrors` instead of `FieldError`), open `apps/web/src/components/ui/field.tsx` and align. Ditto for `FieldControl` — some coss builds export it as `FieldRoot`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/auth
git commit -m "refactor(web): restyle auth forms with coss Field components"
```

---

## Task 16: Final verification of the foundation

- [ ] **Step 1: Run the full test suite**

```bash
cd apps/web && bun run test
```
Expected: green for all written tests (OuterRail, InnerRail, EnvSwitcherDropdown, CommandPalette).

- [ ] **Step 2: Run type-check across the app**

```bash
cd apps/web && bun run typecheck
```
Expected: no type errors.

- [ ] **Step 3: Run dev server, walk every route**

```bash
cd apps/web && bun dev
```
Visit and verify:
- [ ] `/` (existing project list — Plan 3 redesigns it; still functional)
- [ ] `/servers`, `/routing`, `/activity`, `/members`, `/settings` — placeholders, rails active correctly
- [ ] Sign in flow renders with new coss styling
- [ ] Create or open a project (uses existing `/_dashboard/index.tsx`), navigates to `/project/$id` — canvas placeholder renders, inner rail visible, env switcher in breadcrumb
- [ ] `/project/$id/{logs,networking,variables,deployments,settings}` — placeholders, inner rail active correctly
- [ ] ⌘K opens the palette on every route, ESC closes it
- [ ] Switching env via breadcrumb updates the `?env=` search param

Stop the dev server.

- [ ] **Step 4: Final commit if anything was tweaked during walkthrough**

If the walkthrough surfaced bugs (active-state mismatches, missing imports, layout overflow), fix them inline, then:

```bash
git add -p
git commit -m "fix(web): foundation walkthrough fixes"
```

If the walkthrough was clean, no commit needed.

---

## Done — what's next

After Plan 1 lands:

- **Plan 2** — Project Canvas & Service Drawer. React Flow node redesigns (`GroupNode`, `ServiceNode`, `DatabaseNode`, `RoutingNode`, `VolumeNode`), service drawer with 5 tabs (Overview / Deployments / Variables / Logs / Settings), mini-canvas SVG renderer reused by Plan 3's project list.
- **Plan 3** — Workspace Screens. Real Projects, Servers, Routing, Activity, Members, Settings screens, replacing today's placeholders.
- **Plan 4** — Project Sub-screens. Real Logs (Ghostty terminal), Networking (Caddy fragment editor), Variables, Deployments, Settings (long-scroll + TOC).
- **Plan 5** — Polish & Live. ⌘K real actions, websocket-driven status everywhere, virtualization for long lists, lazy-load Ghostty, route-level smoke tests, performance budget enforcement.

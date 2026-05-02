# Frontend Rebuild — Design Spec

**Date:** 2026-05-02
**Status:** Draft
**Branch:** `feat/v2-rebuild`
**Companion to:** [`2026-04-07-otterstack-paas-v1-design.md`](./2026-04-07-otterstack-paas-v1-design.md)

This spec covers only the `apps/web` rebuild. Resource model, runtime, and API surface are unchanged — see the v1 PaaS spec.

---

## 1. Goal & Non-Goals

**Goal.** Rebuild `apps/web` so otterstack feels like a serious, performant PaaS — a tool a solo dev, an agency, or an internal platform team would happily run every day. Match Railway's information architecture and Linear's polish, on top of coss ui primitives.

**Non-goals.**
- Not changing the API contract or domain model.
- Not building observability dashboards in v1 (v1.1).
- Not building light theme in v1 (v1.1 — but tokens are already var-driven so it costs days, not weeks).
- Not building a templates marketplace (later).

---

## 2. Personas & primary jobs

We design for **all three** with progressive disclosure. The canvas-first flow is the floor; RBAC, multi-server, audit are the ceiling.

| Persona | Primary job | Lives in |
|---|---|---|
| Solo dev | Push code, get a URL, attach a Postgres. | Canvas, Service drawer |
| Agency | Run 5-30 client projects with isolation and handoff. | Projects, Members, Activity |
| Platform team | Operate a multi-server cluster with RBAC and audit. | Servers, Routing, Activity, Settings |

---

## 3. Design direction

**Shape:** Workbench — outer icon rail (workspace) + inner icon rail (project) + main content + right-side drawer for detail. Top breadcrumb with environment switcher.

**DNA:** Railway (canvas-as-centerpiece, mini-canvas previews, drawer-over-canvas, long-scroll settings with sticky TOC, persistent activity rail). Linear (smooth animations, ⌘K-first, keyboard shortcuts visible everywhere). Plane (open-source-grade dense list aesthetics).

**Tone:** Dark-first, near-black background (`#0a0a0c`-ish), ui-monospace for hostnames/IDs/commands, ui-sans-serif for prose, subtle warm accents (amber/orange) reserved for the otter brand and primary actions.

**Differentiator vs Railway:** Self-hosted infrastructure is a *feature*, not buried plumbing. Servers, Caddy global config, TLS cert status, overlay networks all get first-class screens.

---

## 4. Information Architecture

### Outer rail (workspace, always visible)

| Screen | Path | Tier | Purpose |
|---|---|---|---|
| Projects | `/` | v1 | Project list with mini-canvas previews. Default landing. |
| Servers | `/servers` | v1 | Swarm nodes — add (paste join token), monitor (CPU/mem/disk), drain, remove. |
| Routing | `/routing` | v1 | Global Caddyfile root: admin socket, ACME/cert issuer, `local_certs`, layer4 root, redirects, wildcards. |
| Volumes | `/volumes` | v1.1 | Persistent volumes across all projects, last backup, attached service. |
| Activity | `/activity` | v1 | Workspace audit log: who deployed/changed/SSHed. Filter by actor, project, kind. |
| Templates | `/templates` | later | Curated starters (T3, Rails, Astro, etc.). |
| Members | `/members` | v1 | RBAC (owner/admin/deployer/viewer), per-project overrides, invitations, PATs. |
| Settings | `/settings` | v1 | Workspace name, SSO, integrations (GitHub, Resend, Inngest), billing (Polar), update channel. |

### Inner rail (visible inside a project)

| Screen | Path | Tier | Purpose |
|---|---|---|---|
| Canvas | `/project/$id` | v1 | Centerpiece. Groups, services, databases, volumes on a dot grid (React Flow). |
| Observability | `/project/$id/observability` | v1.1 | Per-environment metrics dashboards. |
| Logs | `/project/$id/logs` | v1 | Live tail across services, filter by service/severity/time. Activity rail right. |
| Networking | `/project/$id/networking` | v1 | Project's Caddy fragment: public services, custom domains, TLS, internal-only routes, overlay membership. |
| Variables | `/project/$id/variables` | v1 | Shared env vars per env, referenced from services as `${shared.X}`. |
| Deployments | `/project/$id/deployments` | v1 | History across services × envs in this project. |
| Settings | `/project/$id/settings` | v1 | Long-scroll page with sticky TOC: General · Source · Networking · Scale · Deploy · Variables · Config-as-code · Feature flags · Danger. |

### Caddy file scoping

- `/routing` (workspace) edits the **global Caddyfile root block** — the part already produced by `buildCaddyfile` in `packages/api/src/caddy/builder.ts`.
- `/project/$id/networking` edits **that project's fragment** — the part produced by `buildProjectFragment`.
- The reconciler composes: read enabled `proxy_routes` from DB, group by project, render fragments, concat, push to Caddy admin API. UI shows fragment-level diff before applying.

### Drawers, modals, overlays (used everywhere)

- **Service / database detail (right drawer over canvas).** coss `Sheet` (~480px right). Tabs (v1): Overview · Deployments · Variables · Logs · Settings. (Metrics tab added in v1.1.) ESC closes; scrim dims canvas.
- **⌘K command palette (centered modal).** coss `Command`. Jump to project, deploy, view logs, edit env var, kill service, add server, invite member.
- **Add anything sheet.** coss `Sheet`. GitHub repo / Docker image / database template / volume / domain. Triggered from + on canvas, + on project list, ⌘K.
- **Environment switcher (top-bar dropdown).** coss `Select`-driven. dev / staging / prod chips, color-coded. Replaces current `features/environment-switcher` dot-grid UI.
- **Workspace switcher (top-bar dropdown).** coss `Menu`. Avatar + name + role chip per workspace.
- **Toasts.** coss `Toast` (already wired via Sonner). WebSocket-driven progress for deploys, restarts, cert renewals. Optimistic UI with rollback on failure.

---

## 5. Layout shell

```
┌──────────────────────────────────────────────────────────────────────┐
│ ┌─┐ acme-co · acme-api · production ▾                       ⌘K  ◔ ◯ │  ← top breadcrumb (workspace · project · env switcher · ⌘K · alerts · avatar)
├─┴─┴────┬─────────────────────────────────────────────────────────────┤
│ outer │ inner│                                                        │
│ rail  │ rail │            main content                                │
│ 40px  │ 40px │                                                        │
│       │      │                                                        │
│ ▦ on  │ ◇ on │       (canvas / list / form / dashboard)               │
│ ◈     │ ◐    │                                                        │
│ ↯     │ ▤    │                                                        │
│ ⊟     │ ↯    │                                                        │
│ ≡     │ ⊕    │                                                        │
│ ⏍     │ ↻    │                                                        │
│ ⚙     │ !    │                                                        │
└───────┴──────┴────────────────────────────────────────────────────────┘
```

Inner rail only renders when route matches `/project/$id*`. Outer rail uses coss `Sidebar` in icon-only mode. Top breadcrumb is a custom shell component composed of coss `Menu`, `Select`, `Avatar`, `Kbd`.

---

## 6. Layout & screen sketches (v1)

Compact intent per screen. Visual fidelity in implementation; this is enough to plan against.

### Projects (`/`)
- Header: workspace name, "+ New project" button (coss `Button`), search (coss `Input` with `⌘K` `Kbd` hint).
- Grid of cards (coss `Card`). Each card shows project name + slug, env chip, mini-canvas preview (small SVG of the React Flow layout, no interaction), service count + db count.
- Empty state: coss `Empty` with friendly copy.

### Servers (`/servers`)
- Table (coss `Table`). Columns: name, role (manager/worker), CPU/mem/disk meters (coss `Meter`), uptime, status (coss `Badge`).
- "+ Add server" opens a coss `Sheet` with platform-specific install commands and join token.
- Row click → drawer with detailed metrics, drain action (coss `AlertDialog` confirm), remove action.

### Routing (`/routing`)
- coss `Tabs`: Domains · Certificates · Redirects · Layer4 · Advanced.
- Each tab is a list view (coss `Table` or `Group`) plus a side panel for the form.
- "Apply changes" button shows fragment-level diff before commit.

### Activity (`/activity`)
- Virtual list (TanStack Virtual + coss `Group`). Filter row (coss `InputGroup` with chips for actor, kind, project).
- Each entry: avatar, actor, verb, object, timestamp, optional inline diff (coss `Collapsible`).

### Members (`/members`)
- Two-tab page: Members · Invitations · Personal access tokens.
- Members list with role select per row. Owner is locked. Invite opens coss `Dialog`.

### Settings (workspace `/settings`)
- Long-scroll with sticky TOC right (custom component using `IntersectionObserver` + coss `Separator`).
- Sections: General · Identity · Integrations · Billing · Update channel · Danger.

### Canvas (`/project/$id`)
- React Flow with custom nodes:
  - `GroupNode` — titled container (resizable, droppable). Replaces ad-hoc layout.
  - `ServiceNode` — image/repo, status pill, hostname row.
  - `DatabaseNode` — engine icon, status, attached `VolumeNode` cards beneath.
  - `RoutingNode` — Caddy as a first-class node showing public domains.
- Floating bottom-left controls (coss `Toolbar`): zoom in/out/fit, undo/redo, mini-map toggle.
- Top-right "+ Add" button → coss `Sheet`.
- Click any node → service/database drawer.

### Logs (`/project/$id/logs`)
- Filter row (coss `InputGroup` + service multi-select via coss `Combobox` + time range coss `Calendar` popover).
- Main pane: a `@wterm/react` `Terminal` driven by `@wterm/ghostty` core, fed by a SSE/WebSocket log stream. Scrollback handled by Ghostty.
- Right rail (sticky): **project-scoped** activity feed — recent deployments and status events for *this project* (not workspace-wide). Uses coss `Avatar` + status icons. (Workspace-wide audit lives at `/activity`.)

### Networking (`/project/$id/networking`)
- Two-column: routes list (coss `Table`) + selected route form (coss `Form`/`Field`).
- "Show generated fragment" button → coss `Drawer` with the Caddy fragment text.

### Variables (`/project/$id/variables`)
- Per-env tabs (coss `Tabs`).
- coss `Table` with key, value (masked, coss `useCopyToClipboard`), referenced-by, edit.
- Bulk import via coss `Sheet` with `.env` paste.

### Deployments (`/project/$id/deployments`)
- Virtual list grouped by date (coss `Group`).
- Row: service avatar, commit, author, status pill, duration, "View logs" → opens drawer with a Ghostty terminal of build output.

### Settings (project `/project/$id/settings`)
- Same long-scroll + sticky TOC pattern as workspace settings.
- Sections: General · Source · Networking · Scale · Deploy · Variables · Config-as-code · Feature flags · Danger.

### Service drawer (over canvas)
- coss `Sheet` (right side, ~480px width).
- Tabs (coss `Tabs`): Overview · Deployments · Variables · Logs · Settings.
- "Logs" tab embeds a Ghostty terminal (lazy-loaded; WASM not paid for unless opened).

---

## 7. Component conventions — strict rules

1. **coss ui only.** `apps/web/src/components/ui/*` is the source of truth. We compose; we do not reimplement. If a primitive is missing, file a TODO and use the closest coss equivalent — do not handroll a div-with-tailwind replacement.
2. **Feature folder structure.** All product surfaces live under `apps/web/src/features/<feature>/`. A feature folder owns:
   ```
   features/<feature>/
     api/        ← oRPC client wrappers, schemas (read-only mirrors of contract)
     components/ ← React components specific to this feature
     hooks/      ← React hooks specific to this feature
     types.ts    ← Feature-local types
     index.ts    ← Public exports for the feature
   ```
   Routes (`routes/_dashboard/...`) are thin — they import from features, do route-level data prep (loaders, search params), and render.
3. **No business logic in route files.** Loaders are fine; data shaping is not. Push to `features/<feature>/hooks/` or `packages/api`.
4. **Queries live in `packages/api`** (existing rule). Frontend never builds DB queries.
5. **Result-pattern propagation.** `.isOk()` / `.isErr()` from the API; never `.unwrap()` (existing rule). Surface errors via coss `Alert` or `Toast`.
6. **One-line comments at most.** Per repo convention.

---

## 8. Theme & tokens

- Use coss tokens (Cal.com-inspired CSS vars). Override the dark palette in `apps/web/src/index.css`.
- Defaults: Inter (sans), Geist Mono (mono), Inter (heading).
- otterstack accent: warm amber/orange gradient reserved for primary buttons and the brand mark. Status colors use coss's `success` / `warning` / `destructive` / `info` tokens (don't introduce new ones).
- Dark-first via `class="dark"` on `<html>`. Light theme exists as a v1.1 toggle — keep tokens var-driven so the switch is one class, not a redesign.

---

## 9. Performance budget

| Metric | Target | How |
|---|---|---|
| Route transition | < 100ms perceived | TanStack Router `defaultPreload="intent"` (already set), route-level skeletons (coss `Skeleton`), preload on hover |
| Initial paint | < 1.5s on cold cache | Vite code-split per route, lazy-load React Flow + Ghostty WASM |
| Mutation feedback | < 16ms | Optimistic update on every write via TanStack Query `onMutate` |
| Live updates | < 500ms after server event | Existing `use-invalidation-socket.ts` driving `queryClient.invalidateQueries` |
| Long lists | smooth at 10k items | `@tanstack/react-virtual` for Activity, Deployments, Variables, Logs scrollback |
| Animations | locked 60fps | Use `motion/react` (existing); never animate width/height — use transform/opacity |

---

## 10. Tech additions

| Package | Purpose |
|---|---|
| `@wterm/ghostty` + `@wterm/react` | Terminal panes for log tail, exec into container, build output streaming. libghostty WASM core, lazy-loaded (~400KB) only on routes that use it. |
| `@tanstack/react-virtual` | Already implied for long lists; add explicit dep. |

No other additions. React Flow, Tailwind v4, coss UI, TanStack Router/Query, oRPC client are already present.

---

## 11. Code we keep / scrap

**Keep, audit only**
- `apps/web/src/lib/auth.ts`, `utils/orpc.ts`, `main.tsx`, `routes/__root.tsx`, `hooks/use-invalidation-socket.ts`
- `components/ui/*` (this is coss — the entire library is in-tree by design)
- `features/auth/*` source flow — restyle with coss `Form`/`Field`/`Button` to drop the indigo/red ad-hoc styling
- `routes/auth/*` — restyle, same content
- `features/project-flow/*` React Flow scaffolding — keep, but redesign all node components and add `GroupNode`, `RoutingNode`, `VolumeNode`

**Rewrite**
- `routes/_dashboard/index.tsx` — current ad-hoc Tailwind cream-card layout → coss `Card` grid with mini-canvas previews
- `routes/_dashboard/layout.tsx` — currently a bare `<Outlet/>`; becomes the workspace shell (outer rail + breadcrumb)
- `routes/_dashboard/project/layout.tsx` — currently a bare `<Outlet/>`; becomes the project shell (inner rail + breadcrumb env switcher)
- `components/header.tsx`, `mode-toggle.tsx`, `theme-provider.tsx`, `user-menu.tsx` — fold into the new shell components

**Delete**
- `routes/_dashboard/playground.tsx` (test bed for env switcher, no longer needed)
- `features/environment-switcher/` (entire folder) — replaced by a new `features/env-switcher/` that renders as a top-bar dropdown using coss `Select`. Old folder deleted; the new folder shares no code.
- `features/project-flow/components/database-resource.tsx` and `resource.tsx` get rewritten in place (functionally a delete + new file)

---

## 12. v1 / v1.1 / later scope

**v1 ship list** (everything else is excluded)
- Workspace shell + outer rail (Projects, Servers, Routing, Activity, Members, Settings)
- Project shell + inner rail (Canvas, Logs, Networking, Variables, Deployments, Settings)
- Service / database drawer with Overview, Deployments, Variables, Logs, Settings tabs (Metrics tab added in v1.1)
- ⌘K command palette
- Top-bar env switcher + workspace switcher
- Restyled auth
- WebSocket-driven live status everywhere relevant
- Dark theme only

**v1.1**
- Observability (project metrics dashboards) — adds inner-rail item back
- Volumes (workspace screen)
- Metrics tab in service drawer
- Light theme toggle

**Later**
- Templates / starter marketplace
- GitHub PR previews
- On-call alerting / pager integration
- Mobile responsive overhaul (v1 is desktop-first; mobile gets a viewable-but-not-pretty fallback)

---

## 13. Folder layout (proposed)

```
apps/web/src/
  components/
    ui/                       ← coss ui (untouched, in-tree)
    shell/                    ← workspace shell, project shell, breadcrumb, rails
  features/
    auth/                     ← restyled
    projects/                 ← workspace project list + create flow
    project-canvas/           ← rebrand of project-flow; React Flow + nodes
    project-logs/             ← Ghostty-backed log view
    project-networking/       ← Caddy fragment editor
    project-variables/
    project-deployments/
    project-settings/
    workspace-servers/
    workspace-routing/
    workspace-activity/
    workspace-members/
    workspace-settings/
    command-palette/          ← ⌘K, used everywhere
    env-switcher/             ← top-bar dropdown (replaces existing environment-switcher)
    workspace-switcher/
  hooks/                      ← cross-feature hooks (use-invalidation-socket, use-shortcut)
  lib/
  routes/
    __root.tsx
    auth/
    _dashboard/
      index.tsx               ← projects
      layout.tsx              ← workspace shell
      servers.tsx
      routing.tsx
      volumes.tsx             (v1.1)
      activity.tsx
      members.tsx
      settings.tsx
      project/
        layout.tsx            ← project shell
        $projectId/
          index.tsx           ← canvas
          observability.tsx   (v1.1)
          logs.tsx
          networking.tsx
          variables.tsx
          deployments.tsx
          settings.tsx
  utils/
  main.tsx
```

---

## 14. Testing

- **Pure logic** (canvas layout helpers, fragment diffing, virtual list selectors) — vitest unit tests.
- **Routes** — TanStack Router has built-in test utilities; one smoke test per route confirming it renders, loaders fire, and primary CTA exists.
- **Visual regression** — out of scope for v1; revisit after launch.
- **End-to-end** — manual against a local Swarm; codify in v1.1.

---

## 15. Open questions / risks

1. **GroupNode in React Flow.** Railway's grouped layout is non-trivial — drag a service into a group, persist membership, allow group resize. React Flow has a `parentNode` concept; verify it covers our needs before committing. (Risk: medium. Mitigation: prototype groups in week 1.)
2. **Ghostty WASM bundle weight.** ~400KB is fine if lazy-loaded, but every Logs route mount paying that cost is not. Confirm one-shot init across the app, not per-route.
3. **Caddy fragment diffing UX.** "Show me what my Caddy file looks like" is a power-user feature; the diff renderer needs to be readable to non-power users too. Likely uses `diff2html` or a hand-rolled coss `Card` line-diff.
4. **Mobile.** Out of scope for v1. Hard cutoff: < 1024px shows a coss `Empty` saying "otterstack is desktop-only for now."
5. **Theme switch infrastructure.** We commit to dark-first but token-var-driven. The switch must not require restyling — just `class="dark"` toggle. Verify coss tokens cover everything we use.

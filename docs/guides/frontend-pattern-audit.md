# Frontend pattern audit — TanStack DB migration & cleanup backlog

This document catalogs every place in `apps/web` that still uses the patterns we
replaced while refactoring the **API keys** feature. It is a backlog, not a
mandate — some entries are deliberate (one-shot mutations, read-only/streaming
queries) and are flagged as such.

## The reference implementation (the "after")

The API keys feature is the canonical example of the target shape. When in
doubt, copy it:

| Concern | File |
| --- | --- |
| Collection (read + `onInsert`/`onUpdate`/`onDelete`) | `apps/web/src/features/api-keys/data/api-keys.ts` |
| Page inlined into its route | `apps/web/src/routes/_app/$orgSlug/api-keys.tsx` |
| TanStack Form dialog (reset via `form.reset()`, no `useEffect`) | `apps/web/src/features/api-keys/create-key-dialog.tsx` |
| Row component mutating the collection directly | `apps/web/src/features/api-keys/api-key-row.tsx` |
| Extracted sub-components to respect `max-lines` | `apps/web/src/features/api-keys/scope-picker.tsx` |

Background on the collection pattern: `docs/guides/tanstack-db-rest-integration.md`.

---

## Pattern 1 — TanStack Query data hooks that should be TanStack DB collections

`useQuery`/`useMutation`/`useQueryClient` wrapping `orpc.*` or `authClient.*`
for **list/CRUD** data. These are the migration targets: replace the read with a
`createCollection(queryCollectionOptions(...))` consumed via `useLiveQuery`, and
move create/update/delete onto the collection's `onInsert`/`onUpdate`/`onDelete`.

### Already migrated (reference these, don't touch)

| Feature | Collection file | Exports |
| --- | --- | --- |
| api-keys | `features/api-keys/data/api-keys.ts` | `apiKeysCollection` |
| projects | `features/projects/data/project.ts` | `projectCollection` |
| environments | `features/projects/data/env.ts` | `envCollection` |
| dependencies | `features/projects/data/dependencies.ts` | `dependenciesCollection` |
| resources | `features/resources/data/resource.ts` | `resourceCollection` |
| deployments | `features/resources/data/deployments.ts` | `deploymentsCollection`, `deploymentTasksCollection` |
| service tasks | `features/resources/data/service-tasks.ts` | `serviceTasksCollection` |
| terminal targets | `features/terminal/data/targets.ts` | `terminalContainersCollection`, `terminalDatabasesCollection` |
| servers | `features/servers/data/server.ts` | `serverCollection` |
| server stats | `features/servers/data/stats.ts` | `serverNodeStatsCollection`, `serverClusterStatsCollection` |
| SQL snippets | `features/resources/components/postgres/tabs/data/data/use-sql-snippets.ts` | `sqlFolderCollection`, `sqlSnippetCollection`, `sqlPlaygroundCollection` |
| backups | `features/backups/data/{backups,schedules,destinations}.ts` | `backupsCollection`, `schedulesCollection`, `destinationsCollection` |

### High-value CRUD candidates (clean list/create/update/delete shapes)

These map cleanly onto a collection and are the best ROI:

| Feature | Files (file:line) | Data | Notes |
| --- | --- | --- | --- |
| **registries** | `features/registries/registry-dialog.tsx:12`, `registry-card.tsx:10`, `routes/_app/$orgSlug/registries.tsx:4`, `features/projects/components/settings/registry-section.tsx:7`, `features/projects/components/new-resource/steps/image.tsx:14` | `orpc.registry.list/create/update/delete` | List is read in ≥4 places — strong case for one shared `registryCollection`. |
| **notifications** | `features/notifications/notifications-page.tsx:9` | `orpc.notifications.channels.list/create/update/delete/pause`, `orpc.notifications.subscriptions.list` | Two related entities → two collections (channels + subscriptions). |
| **team** | `features/team/data/use-team.ts:9`, `members-list.tsx:9`, `invite-member-form.tsx:8`, `pending-invitations.tsx:8` | `authClient.organization.listMembers/listInvitations/removeMember/inviteMember/cancelInvitation` | Members + invitations via `authClient` (like api-keys uses `authClient.apiKey.*`). |
| **networking routes** | `features/projects/components/networking/route-access-controls.tsx:21`, `route-directives-dialog.tsx:12`, `routes/_app/$orgSlug/$projectSlug/networking.tsx:15` | `orpc.project.routes.list/create/update/delete` | Project-scoped subset collection (mirror `resourceCollection`). |
| **project variables** | `routes/_app/$orgSlug/$projectSlug/variables.tsx:14`, `features/projects/components/variables/reference-picker.tsx:22` | `orpc.project.variables.*` | Variables read in multiple places; uses `useQueries`. |
| ~~**backups**~~ | ~~`routes/_app/$orgSlug/backups.tsx:14`~~ | ~~backup CRUD~~ | ✅ **Done.** `features/backups/` — three collections (list + onInsert/onUpdate/onDelete for schedules & destinations; backups read-only with `runBackup`/`restoreBackup` actions). Route is a thin live-query consumer; dialogs use TanStack Form; types inferred from the contract (Pattern 5); sub-components split per the line budget (Pattern 2). |
| **git providers** | `routes/_app/$orgSlug/git-providers.tsx:4`, `features/git-providers/provider-card.tsx:6`, `connect-dialog.tsx:23` | `orpc.git.*` providers/installations | See also Pattern 5 (its view types). |
| **org settings / firewall / docker** | `routes/_app/$orgSlug/settings.tsx:11`, `firewall.tsx:3`, `docker.tsx:4` | `orpc.organization.*`, firewall, docker secrets | Org-scoped CRUD. |
| **audit log** | `routes/_app/$orgSlug/audit.tsx:17` | `orpc.audit.list` (paginated, `keepPreviousData`) | On-demand/paginated collection, or leave as query (see below). |

### Probably keep as plain queries (NOT collection candidates)

Streaming/live-tail, read-only specialized reads, and one-shot bootstrap
mutations don't benefit from a collection. Listed so we don't "migrate" them by
reflex:

- **Live tails / polling reads**: `features/edge-logs/components/edge-logs-view.tsx:4` (2s tail), `features/projects/components/pending-changes-bar.tsx:21` + `routes/.../graph/layout.tsx:24` (manifest diff), `features/resources/components/_shared/metrics/use-resource-metrics.ts:15` (30s metrics).
- **Read-only data viewers**: `features/resources/components/postgres/tabs/data/data/use-database.ts:12`, `features/resources/components/redis/tabs/data/data/use-redis.ts:10`.
- **One-shot mutations** (no list to keep in sync): `features/auth/components/sign-in-form.tsx`, `sign-up-form.tsx`, `create-organization-form.tsx`, `features/git-providers/connect-dialog.tsx:23`, most `*/settings/*-card.tsx` toggles, `features/projects/components/networking/protection-switch.tsx:7`, `routes/device.tsx`, `routes/accept-invite.$invitationId.tsx`.
- **Stack/manifest staging** (bespoke version-locked flow): `features/projects/components/stack/use-stack-state.ts:13`, `features/projects/hooks/use-manifest-stage.ts:18`, `features/projects/hooks/use-project-events.ts:26`.

### Direct query that should consume an existing collection

- `features/projects/components/new-resource/steps/resources.tsx:36` already uses `useLiveQuery` for servers but **also** queries `orpc.project.resource.list` directly — it should read `resourceCollection` instead.

---

## Pattern 2 — Page component separate from its single route

A `*-page.tsx` in `features/**` rendered by exactly one route file. We inlined
`api-keys-page.tsx` into its route and deleted the file. Same fix here (move the
component body into the route's `RouteComponent`):

| Page file | Sole route that renders it |
| --- | --- |
| `features/notifications/notifications-page.tsx` | `routes/_app/$orgSlug/notifications.tsx` |
| `features/logs/components/logs-page.tsx` | `routes/_app/$orgSlug/$projectSlug/logs.tsx` |
| `features/resources/components/_shared/metrics/project-metrics-page.tsx` | `routes/_app/$orgSlug/$projectSlug/metrics.tsx` |

> Note: inlining a large page may trip `eslint(max-lines` / `max-lines-per-function)`
> (250 / 150). Extract sub-components/rows into sibling files as we did with
> `scope-picker.tsx` and `api-key-row.tsx`.

---

## Pattern 3 — Manual multi-field forms that should use TanStack Form

Components managing form fields with multiple `useState` + a hand-rolled submit,
instead of `@tanstack/react-form`. Migrate to `useForm` (see
`create-key-dialog.tsx`).

| File (file:line) | Fields | Submits via |
| --- | --- | --- |
| `features/registries/registry-dialog.tsx:41` | 4 (displayName, host, username, password) | create/update mutations |
| `features/notifications/channel-dialog.tsx:53` | 6 (kind, name, target, secret, config, errors) | custom validated handler |
| `features/shell/components/environment-create-dialog.tsx:34` | 5 (name, slug, slugTouched, submitting, error) | `envCollection.insert` |
| `features/servers/components/server-create-dialog.tsx:47` (inner `JoinForm`) | 5 (role, hostname, privateIp, submitting, error) | `serverCollection.insert` |
| `features/team/components/invite-member-form.tsx:32` | 3 (email, role, sent) | invite mutation |

Already on TanStack Form (good): `create-key-dialog.tsx`, `create-project-dialog.tsx`,
auth `sign-in-form.tsx`, `sign-up-form.tsx`, `create-organization-form.tsx`.

---

## Pattern 4 — `useEffect` that resets form/dialog state on open/close

We deleted a `useEffect(..., [open])` that reset fields. Do the reset in the
`onOpenChange`/close handler (or `form.reset()`) instead. Where the effect also
**hydrates from an `existing`/`editing` prop**, TanStack Form's `defaultValues`
+ a `key` on the dialog (or `form.reset(next)`) covers it.

| File (file:line) | What it resets |
| --- | --- |
| `features/registries/registry-dialog.tsx:47` | 4 fields + hydrate-from-existing |
| `features/notifications/channel-dialog.tsx:62` | 5 fields + prefill for edit |
| `features/projects/components/networking/route-directives-dialog.tsx:51` | textarea value + error |
| `features/resources/components/_shared/variables-editor/bulk-edit-dialog.tsx:41` | bulk-edit text |

(Folding these into Pattern 3's migrations removes both at once for the form dialogs.)

---

## Pattern 5 — Hand-written view-model types duplicating a server contract

We deleted `interface ApiKeyView` and let the row type be **inferred** from the
collection's `queryFn` projection. These hand-written types re-list fields that
already exist in an oRPC contract schema — infer from the contract / collection
instead of re-declaring.

| Type (file:line) | Duplicates |
| --- | --- |
| `RegistryView` — `features/registries/shared.ts:3` | `containerRegistryViewSchema` (`packages/api/src/routers/registry/contract.ts:30`) |
| `InstallationView` — `features/git-providers/shared.ts:21` | `gitInstallationViewSchema` (`packages/api/src/routers/git/contract.ts:33`) |
| `ProviderView` — `features/git-providers/shared.ts:34` | `gitProviderViewSchema` (`packages/api/src/routers/git/contract.ts:47`) |

> Prefer inferring from the contract (e.g. `z.infer<typeof ...>` re-exported from
> the API package, or `(typeof collection.toArray)[number]` once migrated) over a
> parallel hand-maintained interface.

---

## Pattern 6 — Manual pending/loading state alongside an optimistic mutation

We removed `const [creating, setCreating] = useState(false)` — an optimistic
collection insert closes the dialog instantly and the transaction handles
pending + rollback. Drop the manual flag where the mutation is a **collection**
insert/update/delete.

| File (file:line) | State var | Guards |
| --- | --- | --- |
| `features/shell/components/environment-create-dialog.tsx:37` | `submitting` | `envCollection.insert` |
| `features/servers/components/server-create-dialog.tsx:51` | `submitting` | `serverCollection.insert` |
| `features/api-keys/api-key-row.tsx:38` | `busy` | `apiKeysCollection.update/delete` — **our own**; kept to disable the switch/button mid-flight. Revisit if we want to lean entirely on transaction state. |

Not this pattern: `features/projects/components/networking/route-access-controls.tsx:151` (`adding`) guards a **React Query** mutation, which has its own `isPending` — fix it by migrating the mutation (Pattern 1), not by deleting the flag.

---

## Pattern 7 — Redundant `= []` default on `useLiveQuery` destructuring

`useLiveQuery(...).data` is always an array; `= []` (or `= {}`) is dead code
(`typescript-eslint(no-useless-default-assignment)`). Remove the default.

| File | Line(s) |
| --- | --- |
| `features/shell/components/header-nav.tsx` | 176, 219 |
| `features/shell/components/sidebar/project-sidebar.tsx` | 113, 117 |
| `features/projects/components/new-resource/steps/resources.tsx` | 36 |
| `features/resources/components/postgres/tabs/data/data/use-sql-snippets.ts` | 97, 105, 114 |
| `features/resources/components/_shared/resource-terminal.tsx` | 55 |
| `features/terminal/components/open-terminal-dialog.tsx` | 72, 75 |
| `features/command-palette/components/command-palette.tsx` | 36 |
| `routes/_app/$orgSlug/servers.tsx` | 60, 68, 71 |
| `routes/_app/$orgSlug/$projectSlug/logs.tsx` | 31 |
| `routes/_app/$orgSlug/$projectSlug/metrics.tsx` | 19 |
| `routes/_app/$orgSlug/$projectSlug/variables.tsx` | 112 |

Already correct (no default): `routes/_app/$orgSlug/$projectSlug/layout.tsx:56,64`.

---

## Suggested order of attack

1. **Pattern 7** — mechanical, safe, repo-wide; do it in one sweep.
2. **registries** — touches Patterns 1, 3, 4, 5 in one cohesive, small feature; makes a second end-to-end reference next to api-keys.
3. **team** and **notifications** — Pattern 1 (+2 for notifications) on `authClient`/`orpc` list+CRUD.
4. **Pattern 2** page inlines (notifications, logs, metrics) — pairs naturally with their feature work.
5. **git-providers** Pattern 5 type cleanup alongside its Pattern 1 migration.

> Line numbers are starting points captured at audit time; confirm before
> editing. Keep this file updated as items are completed (strike through or
> delete rows).

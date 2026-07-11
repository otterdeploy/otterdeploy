# PR Previews + Environments + Copy-on-Write DB Branching

**Status:** Implemented (superseded in one respect — see below) · zfs COW (P3), caps/idle-GC and job-queue branching still open
**Owner:** —
**Scope:** Per-PR ephemeral preview deployments, copy-on-write Postgres branching, and GitHub write-back (the PR bot).

> **⚠ Model correction (2026-07-08), supersedes this doc where they conflict:**
> **a preview is NOT an environment.** Previews are a first-class `preview` table
> bound to (project, repo, PR#), scoping their deployments/routes/DB branches via
> `previewId` columns — the `environment` table holds only user-created contexts
> (Development/Staging/Production) and carries no preview provenance. DB branching
> is **opt-in per database** (`databaseResource.previewBranching`, default off);
> an unbranched database is shared with the base via the resolver's fallback, so
> a PR costs one container + one route + one row by default. In the UI, previews
> render as satellite cards attached to the service node on the project graph
> (`project.previews.list` → `preview-satellites.ts`), never in environment
> surfaces. Read this doc's environment-based sections as historical design
> background, not as the shipped model.

This is the Vercel-for-Git experience, self-hosted: open a PR → a preview spins up (ephemeral compute + optionally *branched* databases), the commit gets a status check, the PR gets a sticky comment with the preview URL; close the PR → everything is torn down.

---

## 0. Why these three ship together

They are one feature with three layers. You cannot build previews without an environment dimension in env-resolution, and a preview is useless if its `DATABASE_URL` still points at production. The load-bearing insight:

> **Env refs are already late-bound by resource *name*, not id.** A service's `DATABASE_URL = ${{postgres.DATABASE_URL}}` resolves at deploy time by looking up "the database resource named `postgres` in this project" (`packages/api/src/lib/variables/resolver.ts`). If we make that lookup **environment-aware**, then a preview environment that owns a *branched* database resource also named `postgres` causes the **same manifest** to resolve `DATABASE_URL` to the branch — with zero user-authored env changes. Previews are the production manifest, re-resolved against a different environment scope.

So the three layers:

1. **Environments** — make `environment` first-class and env-scoping real in resolution.
2. **DB branching** — give a preview environment its own COW-cloned database resources.
3. **PR previews + bot** — the webhook lifecycle that creates/destroys preview environments and reports back to GitHub.

---

## 1. Current state (verified against code)

| Area | Today | File |
| --- | --- | --- |
| `environment` table | Exists, but **project→env is 1:1** via scalar `project.environmentId`. `environment.projectId` FK is already one-to-many-capable. | `packages/db/src/schema/project.ts:166`, `:75` |
| `projectEnvVar` | Already keyed `(projectId, environmentId, key)` — the good precedent. | `project.ts:705` |
| `serviceEnvVar` | Has nullable `environmentId` but it's **ignored** by setters and the resolver (unique index is `(serviceResourceId, key)`). Schema comments call this the planned "step 7". | `project.ts:663` |
| `projectEnvSubscription` | **Dead code** — no reads. Ignore/repurpose. | `project.ts:741` |
| Env resolver | `resolveServiceEnv(projectId, serviceResourceId)` hard-pins env to `project.environmentId`. `${{...}}` refs resolve resource by name, env-agnostic. | `resolver.ts:40`, `:160`; `routers/service/queries/env.ts:89` (`getResourceByProjectAndName`) |
| DB connection injection | Computed export: `${{db.DATABASE_URL}}` → `databaseResource.internalConnectionString` column. | `lib/variables/exporters.ts:27`, `resolver.ts:185` |
| DB volumes | Plain Docker `local` named volume, **auto-created on mount**, name `otterdeploy-pgdata-<proj>-<res>` (recomputed, not stored). PGDATA `/var/lib/postgresql/data`, image pinned `postgres:17-alpine`. | `runtime/docker-driver-db.ts:47`, `routers/project/view-helpers.ts:84`, `swarm/database-engines/postgres.ts:14`, `swarm/constants.ts:17` |
| COW / snapshot | **None anywhere.** Only "copy a DB" primitive is logical `pg_dump --format=custom` over `docker exec`. | `backups/engine-helpers.ts:26`, `backups/exec.ts` |
| DB teardown | Removes container only — **volume is orphaned** (never deleted). | `routers/project/resources.ts:139`, `queries/resource.ts:84` |
| Runtime driver seam | `RuntimeDriver` interface, `provisionDatabase/updateDatabase/destroyDatabase`. | `runtime/types.ts:33` |
| GitHub webhook | Generic edge; `push`/`installation`/`installation_repositories` handled. `pull_request` **subscribed in manifest but falls through to `ignored`**. No write-back (no status/checks/comments). | `git/webhook-handler.ts:38`, `git/handle-push.ts`, `git/github-app.ts` |
| Zero-downtime | Swarm driver already does `Order: "start-first"` rolling update; docker driver recreates (blip). | `swarm/internals.ts:139` |

**Unique-index landmine:** `databaseResource` has global unique indexes on `databaseName`, `username`, `publicHostname`, `internalHostname` (`project.ts:284`). A COW clone keeps the source's `databaseName`/`username` (Postgres ignores `POSTGRES_*` env on a non-empty PGDATA), so these must be relaxed — see §4.4.

---

## 2. Concepts & data model

### 2.1 Environment kinds

`environment` gains a `kind`:

- **`persistent`** — long-lived, operator-managed. Every project has one default `production` env (this is what `project.environmentId` points at today). `staging` etc. can be added later; out of scope but the model must not preclude it.
- **`preview`** — ephemeral, one per open PR, machine-managed, auto-torn-down on PR close.

A **preview environment inherits from a base** (`baseEnvironmentId`, normally the project's production env). Inheritance is **by reference**, so a change to a production variable propagates to every open preview automatically unless the preview overrides it. This is the "keep envs in sync" requirement.

### 2.2 What a preview environment owns

A preview is **ephemeral compute + branched state**, mirroring Vercel(compute)+Neon(DB):

- **Ephemeral service deployments** — each git-sourced service resource is deployed again from the PR head SHA, as a *separate container* with an env-scoped name and a preview domain. **No duplicate `resource` row** — same service definition, env-scoped runtime instance.
- **Branched databases** — each Postgres resource is COW-branched into a *new* `databaseResource` row scoped to the preview env (branches need distinct identity/volume, and the name-based ref lookup must find them). Opt-in per project (default: branch all Postgres; see open questions).
- **An env scope** — inherits base env vars, plus **system-managed overrides** the platform computes: `DATABASE_URL`/`PG*` → the branch, and public-URL vars → the preview domains. Users never edit these.

### 2.3 Layered env resolution (highest priority wins)

1. **System-managed per-environment overrides** — computed (branch DB conn string via re-resolved refs, preview domains). Not user-editable.
2. **Environment-specific user vars** — `projectEnvVar`/`serviceEnvVar` rows with `environmentId = <preview>`.
3. **Inherited base-environment vars** — the same tables with `environmentId = <base>`.
4. **Service defaults** — service manifest defaults.

In practice layer 1 falls out of layers 2–4 *for free* because the DB ref re-resolves to the branch (§0). Explicit system overrides are only needed for values that aren't already refs (e.g. a hardcoded public URL) — treat those as a follow-up; the ref-based path covers the common case.

---

> **Conventions (apply throughout this feature):**
> - **Zod-first types.** Define every value set / spec as a `z.enum` / `z.object` schema and derive the TS type with `z.infer<typeof …>` — one source of truth gives a runtime validator *and* the static type. Applies to branch strategies/specs, the `SnapshotDriver` shape, env config, and webhook-payload parsing. Never hand-write a `type` that duplicates a schema.
> - **DB enums are pg enums.** Fixed value-set columns use `pgEnum(...)`, not free `text()`.

## 3. Schema changes

All in `packages/db/src/schema/project.ts` (+ `git.ts` FK). Needs `bun db:push`.

### 3.1 `environment`

```ts
// add:
kind: environmentKindEnum("kind").notNull().default("persistent"), // 'persistent' | 'preview'
state: environmentStateEnum("state").notNull().default("active"),  // 'active' | 'closed'
baseEnvironmentId: text("base_environment_id").$type<EnvId>()
  .references(() => environment.id, { onDelete: "set null" }),      // inherit-from
// preview provenance (all nullable; only set when kind='preview'):
gitRepoId: text("git_repo_id").$type<GitRepoId>()
  .references(() => gitRepo.id, { onDelete: "cascade" }),
gitRef: text("git_ref"),                     // PR head branch
pullRequestNumber: integer("pull_request_number"),
pullRequestNodeId: text("pull_request_node_id"),
headSha: text("head_sha"),
autoTeardownAt: timestamp("auto_teardown_at"), // idle GC (nullable = never)
// index: uniqueIndex on (projectId, pullRequestNumber) — a PR has at most one preview env
```

`project.environmentId` stays as "the default/production env" pointer — no breaking change. Project→env is already one-to-many via `environment.projectId`.

### 3.2 `resource` — environment scoping for branches

```ts
// add:
environmentId: text("environment_id").$type<EnvId>()
  .references(() => environment.id, { onDelete: "cascade" }),   // NULL = base (all envs); set = env-specific (a branch)
branchedFromResourceId: text("branched_from_resource_id").$type<ResourceId>()
  .references(() => resource.id, { onDelete: "set null" }),     // provenance
```

Resource lookup becomes: *env-specific row wins, else the base (NULL) row* — see §5.1.

### 3.3 `databaseResource` — branch bookkeeping

```ts
// module-level enum (reused by the SnapshotDriver zod schema in §4.1):
export const branchStrategyEnum = pgEnum("branch_strategy", ["zfs", "copy"]);

// add to databaseResource:
branchStrategy: branchStrategyEnum("branch_strategy"),  // null = base (unbranched)
branchSnapshotRef: text("branch_snapshot_ref"), // zfs snapshot name — needed for teardown
legacyVolumeName: text("legacy_volume_name"),   // pre-migration Docker `local` volume name; NULL once on the managed path
```

**Volume identity → the on-disk path keyed by `resourceId`, NOT the Docker volume name.** This is the canonical scheme going forward (matches `resourceDir`/`backupDir` in `data-folder.md` — grouped by project, keyed by stable id, rename-safe). Managed volumes live at `${DATA_ROOT}/volumes/<projectId>/<resourceId>` (see §4.3); the Docker/compose volume *name* stops being the identity. A branch is a *new* `databaseResource` row → its own `resourceId` → its own dir automatically (no env-suffix hack). `legacyVolumeName` is only set on rows whose data still sits in a Docker-managed `local` volume (`/var/lib/docker/volumes/<name>`) pending migration — used to find the old bytes, then cleared.

### 3.4 `deployment` — environment scoping

```ts
// add:
environmentId: text("environment_id").$type<EnvId>()
  .references(() => environment.id, { onDelete: "cascade" }),  // default backfill = production env
```

### 3.5 `serviceEnvVar` — finish "step 7"

Backfill `environmentId = <project production env>` for existing rows, make it `NOT NULL`, and change the unique index to `(serviceResourceId, environmentId, key)`. Setters (`routers/service/queries/env.ts`) must thread `environmentId`.

### 3.6 Relax `databaseResource` unique indexes

Change `databaseName`, `username`, `publicHostname` from **global unique** to **either non-unique or `(environmentId, X)` composite**. Rationale: a COW branch reuses the source's `databaseName`/`username`. Keep `internalHostname` distinct per branch (it's the network alias — give branches `<res>-pr<N>.<proj>.internal`). Recommendation: drop global unique on `databaseName`/`username` (they only need to be unique *within a container*, which is guaranteed), keep `internalHostname` unique.

---

## 4. Copy-on-write DB branching

The headline requirement: **branch Postgres per PR without copying data or doubling disk.** True COW needs a filesystem that supports it. Introduce a driver abstraction (consistent with the existing `RuntimeDriver` pattern) with real COW strategies and an honest copy fallback.

### 4.1 `SnapshotDriver` abstraction

New: `packages/api/src/runtime/snapshot/types.ts` — **zod-first** (schema is the source of truth; types are inferred; the `pgEnum` in §3.3 and these share the same value set):

```ts
import { z } from "zod";
import { databaseEngineSchema } from "...";   // existing engine schema

// Strategy a branch was actually materialized with (matches branchStrategyEnum in §3.3).
export const branchStrategySchema = z.enum(["zfs", "copy"]);
export type BranchStrategy = z.infer<typeof branchStrategySchema>;

// Operator setting (`auto` = probe zfs, else copy). Used by env config (§9).
export const dbBranchStrategySettingSchema = z.enum(["auto", "zfs", "copy"]);
export type DbBranchStrategySetting = z.infer<typeof dbBranchStrategySettingSchema>;

export const branchInputSchema = z.object({
  sourceVolume: z.string(),
  targetVolume: z.string(),
  engine: databaseEngineSchema,
});
export type BranchInput = z.infer<typeof branchInputSchema>;

export const branchResultSchema = z.object({ snapshotRef: z.string().nullable() });
export type BranchResult = z.infer<typeof branchResultSchema>;

export interface SnapshotDriver {
  readonly kind: BranchStrategy;
  /** Materialize targetVolume as a branch of sourceVolume. Returns a ref for teardown. */
  branch(input: BranchInput, log?: RequestLogger): Promise<BranchResult>;
  /** Remove the branch volume (+ snapshot) on teardown. */
  destroy(input: { targetVolume: string; snapshotRef: string | null }, log?: RequestLogger): Promise<void>;
  /** Boot-time probe: is this strategy usable on this host? */
  probe(): Promise<boolean>;
}
```

Selected by `DB_BRANCH_STRATEGY` env (`auto` default → probe `zfs`, else `copy`). Only two drivers exist: `zfs` (the COW path the installer provisions, §13.1) and `copy` (the fallback when ZFS provisioning failed).

### 4.2 Strategies (two, deliberately)

- **`zfs` (the COW path — true COW, instant, thin):** `zfs snapshot pool/<vol>@pr<N>` then `zfs clone` → new dataset. Requires DB volumes to live on a managed ZFS dataset (§4.3), which the installer provisions (§13.1), so this is the default on any properly-installed host.
- **`copy` (fallback, **doubles disk**, honest):** logical `pg_dump --format=custom | pg_restore` into a **fresh** DB (reuse the existing docker-exec transport in `backups/`). The compatibility floor for hosts where ZFS provisioning failed — it always works but violates the no-double-space goal, so `log()` a warning when it's selected.

> **Why only these two** (not btrfs/reflink): because the installer auto-provisions ZFS (file-backed pool even on single-disk hosts, §13.1), ZFS is effectively always available as the COW path. btrfs/reflink only covered "operator already runs a different COW filesystem" — a middle ground that would double the driver + test surface for a case the installer removes. Keep the set minimal; revisit only if a real host can't run ZFS.

**Consistency (Postgres):** a ZFS snapshot of a live PGDATA is *crash-consistent* — Postgres WAL-replays on the branch's first boot exactly as it would after power loss. Run `docker exec <src> psql -c CHECKPOINT` immediately before snapshotting to shrink replay. No source downtime. For `copy`, `pg_dump` is logically consistent by construction.

### 4.3 Volume placement fork

- **`zfs`** requires the platform to **own the filesystem** under the data dir. Provision DB data as a **bind mount under the existing `DATA_ROOT` tree**, keyed by `resourceId` (the canonical identity — §3.3). Add to `packages/shared/src/paths.ts` (alongside `resourceDir`/`buildDir`/`backupDir`):
>     ```ts
>     export const volumeDir = (projectId: ProjectId, resourceId: ResourceId): string =>
>       `${DATA_ROOT}/volumes/${projectId}/${resourceId}`;
>     // compose stacks: one member volume per subdir
>     export const composeVolumeDir = (projectId, resourceId, member: string): string =>
>       `${DATA_ROOT}/volumes/${projectId}/${resourceId}/${member}`;
>     ```
>   so DB volumes land at **`/data/otterdeploy/volumes/<projectId>/<resourceId>`**. The ZFS dataset is mounted at `${DATA_ROOT}/volumes`. Bounded change in `runtime/docker-driver-db.ts` / `swarm/database-internals.ts` (swap the `Mounts` entry from `Type: "volume"` to a bind on `volumeDir(...)`).
- **`copy`** keeps Docker named volumes (branch = fresh volume + `pg_restore` via a helper container).

**No new root env var** — everything derives from the existing `DATA_ROOT` (`OTTERDEPLOY_DATA_DIR`, default `/data/otterdeploy`, per `@otterdeploy/shared/paths` + `docs/designs/data-folder.md`). All otterdeploy host artifacts stay under that one tree. Gate the placement fork behind the boot-time `probe()` so a host without ZFS keeps working via `copy`.

> **⚠️ Sub-task — retire the TWO legacy volume-naming schemes onto the canonical `resourceId` path.** DB data volumes are created under *two* different Docker names today; **the canonical scheme going forward is neither of them** — it's the `resourceId`-keyed host path (`volumeDir`, above). The legacy names only matter for *finding* existing bytes to migrate:
> - **Plain-DB path (legacy):** `otterdeploy-pgdata-<projectSlug>-<resourceSlug>` (`buildVolumeName`, `routers/project/view-helpers.ts:84`), Docker-managed `local` volume → `/var/lib/docker/volumes/<name>/_data`.
> - **Compose-stack path (legacy):** docker-compose default `<composeProject>_<member>` (e.g. `kltb5z7app6nkh165dcjh8l0_clickhouse-data`), also Docker-managed `local`.
>
> The implementer must: (1) apply the bind-mount placement (`Type:"volume"` → bind on `volumeDir(...)`/`composeVolumeDir(...)`) to **both** the plain-DB provisioning (`runtime/docker-driver-db.ts`) **and** the compose provisioning (`swarm/compose.ts` / `routers/compose/*`) so new volumes are born on the managed path. (2) Resolve the on-disk path **only** from `(projectId, resourceId)` — never re-derive `buildVolumeName` (the compose scheme won't match it anyway). (3) For rows created before this change, store the old Docker name in `legacyVolumeName` (§3.3) so a **one-time migration** can copy `/var/lib/docker/volumes/<legacyVolumeName>/_data` → `volumeDir(...)`, then clear the field. Until a resource is migrated, it's `copy`-only (not ZFS-clonable) — `log()` that fallback so it's visible, and surface "redeploy to enable branching" rather than silently degrading.

### 4.4 Credential handling — two paths (critical)

- **COW clone** (`zfs`): the branched Postgres boots on a non-empty PGDATA, so it **keeps the source's user/password/dbname** (`POSTGRES_*` env is ignored). The branch's `databaseResource` row must therefore **record the source creds verbatim**; only `internalHostname`, container name, `resourceId` (→ its own `volumeDir` path), and `environmentId` differ. This is *why* §3.6 relaxes the unique indexes.
- **Logical copy** (`copy`): the branch is a fresh `initdb` with **new creds** (like any new DB), then `pg_restore` loads the data. No unique-index collision on this path.

Either way the resolver just reads whatever creds the branch row stores and builds `internalConnectionString` — it doesn't care which path produced them.

### 4.5 Runtime driver additions

Extend `RuntimeDriver` (`runtime/types.ts`):

```ts
branchDatabase(input: BranchDatabaseSpec, log?): Promise<DatabaseStatus>;
destroyDatabaseBranch(input: { serviceName; projectId; resourceId; snapshotRef: string|null }, log?): Promise<void>; // resolves the volume via volumeDir(projectId, resourceId)
```

`branchDatabase` = `SnapshotDriver.branch(...)` to materialize the volume, then the existing `provisionDatabase` path with the branch's spec (new hostname/volume/container). `destroyDatabaseBranch` removes container **and** volume **and** snapshot (unlike the normal orphan-the-volume teardown). Implement in `dockerDriver` first (default runtime); `swarmDriver` after.

---

## 5. Environment-aware env resolution

### 5.1 Resolver changes (`packages/api/src/lib/variables/`)

- `resolveServiceEnv(projectId, serviceResourceId, environmentId)` — thread `environmentId` into `ResolveContext`.
- Replace `getResourceByProjectAndName(projectId, name)` with `resolveResourceForEnv(projectId, environmentId, name)`:
  `WHERE projectId=? AND name=? AND (environmentId=? OR environmentId IS NULL) ORDER BY environmentId NULLS LAST LIMIT 1` — the env-specific branch wins, else the base resource.
- `loadScopeExports` (`resolver.ts:152`): use the passed `environmentId` instead of `project.environmentId`.
- `loadProjectEnvBag` / new `resolveEnvBag(projectId, environmentId)`: merge **base env bag** (from `baseEnvironmentId`) under the **preview overrides** → inheritance.
- `listServiceEnvVars`: filter by `environmentId` with base-env fallback (union: base rows overlaid by env-specific rows).

### 5.2 Call-site changes

Everywhere `resolveServiceEnv` / `getServiceRecord` is called at deploy time must pass the deployment's `environmentId`:
`routers/service/redeploy.ts:50,118`, `routers/service/deploy-hook.ts:38`, and the compose path (`routers/compose/deploy.ts`). Default to the project's production env when unset (back-compat).

### 5.3 API + UI

- Thread `environmentId` through `service.env.*` setters (currently missing) and keep `project.envVar.*` (already env-scoped).
- Env router (`routers/env/`) gains `update` + a preview-env listing.
- **Variables UI** (`apps/web/src/routes/_app/$orgSlug/$projectSlug/variables.tsx` + `-components/`): add an environment selector (Production / preview envs), show inherited-vs-overridden state (a value inherited from base renders muted with an "override" affordance). Reuse the existing `variables-sync.tsx` for pull-to-local. This is the "envs in sync" surface.

---

## 6. GitHub write-back — the PR bot

No new App permissions needed — the manifest already requests `pull_requests: write` and `checks: write` (`git/manifest.ts:104`), and already subscribes `pull_request`. Existing installations receive these events today (currently ignored), so **no re-consent**.

### 6.1 Write helpers (`packages/api/src/git/github-app.ts`)

Add, using the existing installation-token minting:

- `createCommitStatus({ installationId, repo, sha, state, targetUrl, context, description })` → `POST /repos/{owner}/{repo}/statuses/{sha}`. `state ∈ pending|success|failure|error`, `context = "otterdeploy/preview"`.
- `upsertCheckRun(...)` (optional, richer than status) → `POST/PATCH /repos/{owner}/{repo}/check-runs`.
- `upsertPrComment({ installationId, repo, prNumber, body, marker })` — list PR comments, find one containing the hidden marker `<!-- otterdeploy-preview -->`, `PATCH` if found else `POST /issues/{number}/comments`. Body = a sticky table: status, preview URL(s), branched DB, build logs link, commit SHA.

### 6.2 Wiring to deployment lifecycle

The build pipeline already emits status transitions (`deploy.started`, mark-building/running/failed in `apps/builder/src/pipeline.ts`). Add a `reportPreviewStatus(deployment)` subscriber that fires **only when `deployment.environmentId` is a preview env**, mapping:

| Deployment state | Commit status | PR comment |
| --- | --- | --- |
| queued/building | `pending` | "Building preview…" |
| running | `success` + `targetUrl` = preview URL | preview URL + branched-DB note |
| failed | `failure` | error + logs link |

Post the comment once per PR (sticky upsert), update the status per deploy.

---

## 7. PR webhook lifecycle

### 7.1 Dispatch (`packages/api/src/git/webhook-handler.ts:38`)

Add `case "pull_request": return handlePullRequest(...)`.

### 7.2 `packages/api/src/git/handle-pull-request.ts` (template: `handle-push.ts`)

- **`opened` / `reopened` / `synchronize`:**
  1. Resolve `gitRepo` by `providerRepoId`; find project(s) bound to it. Guard on a per-project "preview enabled" flag + `PREVIEW_MAX_PER_PROJECT`.
  2. Upsert the preview `environment` for `(project, prNumber)` (`kind=preview`, `baseEnvironmentId = project.environmentId`, `gitRef`, `headSha`).
  3. For each Postgres resource: if the branch doesn't exist for this env, `branchDatabase(...)` (§4) and insert the branch `databaseResource` row (env-scoped).
  4. Insert `pending` deployment rows (env-scoped) for git-sourced services, emit `deploy.started`, `triggerDeploy(...)` at head SHA. Build/runtime resolve env against the preview `environmentId` → services get preview names/domains and the branched `DATABASE_URL` for free.
  5. `reportPreviewStatus` → `pending` status + sticky comment.
- **`synchronize`** (new commits): same as above but reuse the existing preview env + **reuse the existing branch** (do not re-branch — the DB persists across pushes to the PR; re-branch only on explicit request). Redeploy services at the new SHA.
- **`closed` (merged or not):** teardown (§8).

### 7.3 Build pipeline / runtime (`apps/builder`, `runtime`)

- `deploy.triggered` job payload + `deployment` already carry ids; add `environmentId` so `build-one` resolves env correctly.
- Runtime service name + domain become env-scoped: `serviceName = <svc>-<envSlug>` for previews (keep base name for production). Docker/Swarm drivers already key on `serviceName`, so distinct containers fall out.

### 7.4 Domains (`packages/api/src/routers/service/expose.ts`)

Preview generated host scheme: `<svc>-pr<N>--<project>.<PREVIEW_BASE_DOMAIN>` (or reuse the org/project domain chain with a preview suffix). `expose.ts` already mints generated hosts + reconciles Caddy — add the preview-suffix branch. Preview routes are `source=generated`, ephemeral, removed on teardown.

---

## 8. Teardown & GC

On `pull_request.closed` (and on a boot reconcile that reaps orphans):

1. Destroy preview service containers (`runtime().destroy` per env-scoped serviceName).
2. `destroyDatabaseBranch` per branch → **removes container + volume + snapshot** (branches are NOT orphaned, unlike normal DB teardown).
3. Remove preview `proxy_route`s + Caddy reconcile.
4. Delete env-scoped `deployment` / `databaseResource` / `serviceEnvVar` rows (FK cascade from `environment`).
5. Mark `environment.state = closed` (or hard-delete), post the final PR comment ("Preview torn down").

**Idle GC:** a scheduled job tears down previews past `autoTeardownAt` (`PREVIEW_IDLE_TEARDOWN_HOURS`, default e.g. 72h) even if the PR stays open, to bound disk. `log()` what was reaped (no silent caps).

---

## 9. Env config (`packages/env/src/server.ts`)

```ts
PREVIEW_ENABLED: z.stringbool().default(true),
PREVIEW_BASE_DOMAIN: z.string().optional(),          // falls back to org/project domain chain
DB_BRANCH_STRATEGY: dbBranchStrategySettingSchema.default("auto"), // z.enum(["auto","zfs","copy"]) — §4.1
PREVIEW_MAX_PER_PROJECT: z.coerce.number().default(10),
PREVIEW_IDLE_TEARDOWN_HOURS: z.coerce.number().default(72),
```

**No `DB_VOLUME_ROOT`** — DB branch volumes derive from the existing `DATA_ROOT` (`${DATA_ROOT}/volumes/...`, §4.3). Don't add a second root env var; the whole platform already consolidates under `OTTERDEPLOY_DATA_DIR` (default `/data/otterdeploy`). Follow the existing `createEnv` shape; `.optional()`/`.default()` per convention. No GitHub creds here — those stay encrypted on `git_provider`.

---

## 10. Phased task breakdown (implementable, in order)

Each phase is independently mergeable behind the fact that previews aren't triggered until Phase P5 wires the webhook.

### P0 — Environment model + env-aware resolution (no previews yet)
- Schema §3.1 (`environment.kind/state/base` + preview cols), §3.4 (`deployment.environmentId`), §3.5 (finish serviceEnvVar step-7), §3.2 (`resource.environmentId`). `bun db:push`.
- Resolver §5.1–5.2: thread `environmentId`, `resolveResourceForEnv`, inheritance bag.
- Backfill: every existing project gets a `production` env (most already have one via `project.environmentId`); backfill `deployment.environmentId` + `serviceEnvVar.environmentId` to it.
- **Acceptance:** production deploys behave identically (resolve against the production env); a hand-created second env resolves its own vars with base inheritance. Verify by resolving a service's env under two env ids.

### P1 — GitHub write-back helpers (usable standalone)
- §6.1 status + comment helpers in `github-app.ts`; unit-test signature/token path.
- **Acceptance:** a manual call posts a commit status + sticky PR comment on a test repo.

### P2 — SnapshotDriver + `copy` strategy (branching works, not yet thin)
- §4.1 abstraction, §4.2 `copy` via existing `backups/` dump+restore, §4.5 `branchDatabase`/`destroyDatabaseBranch` on `dockerDriver`.
- §3.3 + §3.6 schema (branch bookkeeping + relaxed indexes).
- **Acceptance:** `branchDatabase` produces a working second Postgres with the source's data; teardown removes it cleanly. (Disk doubles — expected for `copy`; logged.)

### P3 — COW strategies (the real goal: thin, instant)
- §4.3 managed volume placement under `${DATA_ROOT}/volumes/<projectId>/<resourceId>` (new `volumeDir`/`composeVolumeDir` helpers in `shared/paths.ts`); §4.2 `zfs` driver + `probe()`; §4.4 COW credential path.
- **§4.3 sub-task:** retire the two legacy Docker volume names (plain-DB `otterdeploy-pgdata-…` + compose `<project>_<member>`) onto the canonical `resourceId`-keyed path — apply the bind-mount placement to **both** the DB and compose provisioning paths, resolve the on-disk path from `(projectId, resourceId)` only (never `buildVolumeName`), and migrate legacy volumes off `/var/lib/docker` via `legacyVolumeName` (one-time copy + `copy`-only/"redeploy to enable branching" with a log until migrated).
- **Acceptance:** on a ZFS host, branching a multi-GB DB is ~instant and adds ~0 disk until divergence; `zfs list` confirms thin.

### P4 — Preview compute (env-scoped service deploys + domains)
- §7.3 env-scoped serviceName/image; §7.4 preview domains in `expose.ts`; build pipeline `environmentId`.
- **Acceptance:** manually creating a preview env + triggering a deploy yields a running preview container on a preview URL, with `DATABASE_URL` pointing at a branch (verify inside the container).

### P5 — PR webhook lifecycle (ties it together)
- §7.1 dispatch, §7.2 `handle-pull-request.ts`, §6.2 lifecycle→GitHub wiring.
- **Acceptance:** open a PR on a connected repo → preview env + branch + deploy + status + comment; push → redeploy same env; close → full teardown. End-to-end.

### P6 — GC, limits, UI polish
- §8 idle GC job + boot reconcile; §5.3 Variables UI env selector + inherited/override display; per-project preview-enabled toggle; §6 check-runs upgrade.
- **Acceptance:** idle previews reaped; UI shows per-env vars with inheritance; limits enforced.

---

## 11. Decisions (resolved 2026-07-03)

1. **Branch-all vs opt-in DBs → DECIDED: branch-all when the COW (`zfs`) strategy is active.** On PR open, auto-branch every Postgres in the project when `probe()` selected `zfs` (thin, ~free). When only `copy` is available, fall back to per-resource opt-in (a `branchOnPreview` flag on the resource) so nobody accidentally doubles disk on a huge DB. Implementers: the branch-all loop in `handle-pull-request.ts` (§7.2 step 3) gates on `activeStrategy.kind === "zfs" || resource.branchOnPreview`.
2. **COW substrate → DECIDED: auto-provision ZFS in the installer.** ZFS is the primary/default substrate; the installer creates and manages a ZFS pool (or a file-backed pool for single-disk hosts) so thin branching works out of the box. The pool's dataset is mounted at `${DATA_ROOT}/volumes` (i.e. `/data/otterdeploy/volumes`) — no separate root. `copy` remains the fallback only when the installer couldn't establish a COW-capable filesystem (probed at boot). This adds an **installer task to P3** — see §13.1.
3. **Seed/anonymization.** Branch DBs are raw clones for v1 (no masking). Revisit if PII-in-previews becomes a concern; `copy`+transform is the natural hook. *(Still open — not blocking.)*
4. **Non-Postgres engines.** Out of scope for v1 (Postgres first). Previews share production for Redis/Mongo/etc. via inherited env, or skip them. *(Default: share prod. Still open if isolation is needed.)*
5. **Production zero-downtime → DECIDED: build blue-green into the docker driver.** Not lean on Swarm — implement Caddy-layer blue-green in the plain-docker `update()` path so the default runtime gets zero-downtime deploys with no orchestrator dependency. Full sub-design in §13.2. This is a **separable workstream** from previews but shares the runtime seam, so it's tracked here.

## 13. Adjacent workstreams (decided, separable from the preview lifecycle)

### 13.1 Installer ZFS provisioning (feeds P3)

- Installer detects host capability: real block device → `zpool create otterdeploy <dev>`; single-disk/dev → file-backed pool (`truncate` a sparse file → `zpool create` on it) so COW still works, with a documented perf caveat.
- Create the dataset that backs the volumes tree (e.g. `otterdeploy/volumes`) and mount it at `${DATA_ROOT}/volumes` — the same `/data/otterdeploy` tree as builds/backups/resources. No new root path or env var.
- Boot-time `SnapshotDriver.probe()` confirms the pool is live and selects `zfs`; if provisioning failed, fall back to `copy` and surface a warning on the Platform page (reuse the self-updater/system router surface pattern).
- **Acceptance:** fresh install on a ZFS-capable host → `zfs list` shows the volumes dataset; branching is thin. Fresh install on a locked-down host → `copy` selected, feature still works, warning shown.

### 13.2 Blue-green in the plain-docker runtime driver

**Goal:** replace the remove-then-recreate blip in `packages/api/src/runtime/docker-driver.ts:92` (`update()`) with a start-first swap at the Caddy layer, since Caddy already joins each project's bridge network and routes to containers by name (`runtime/docker-driver-helpers.ts`, `connectCaddyToNetwork`).

**New `update()` flow (stateless services with a route + healthcheck only):**
1. Create the new container under a **temp alias** (`<svc>-<color>` / `<svc>-<shortSha>`), leave the old one running.
2. Wait for health — Docker `Healthcheck` if defined, else a TCP/HTTP probe on the service port (add a probe helper to `docker-driver-helpers.ts`).
3. Repoint the service's `proxy_route.upstreamHost` at the new container's alias and `reconcile(log)` — Caddy's admin-API load is graceful, so in-flight requests drain.
4. Remove the old container; promote the new alias to canonical (or persist active "color" so the next deploy swaps back).

**Guardrails:**
- Only for services that (a) have an exposed route and (b) define a healthcheck (or accept the TCP probe). Everything else keeps recreate.
- **Stateful containers (databases) MUST keep recreate** — a single data volume can't be dual-mounted; no blue-green for DBs.
- Track the active color per service (a `deployment`/`serviceResource` column, or derive from the running container's alias) so `update()` is idempotent and rollback-safe.

**Phasing:** independent of P0–P6. Can land any time; suggested as its own PR after P0 (shares no code with previews beyond the driver file). **Acceptance:** redeploying a routed service serves 100% of requests with no connection error across the cutover (drive it with a tight `curl` loop / the `verify` skill).

---

## 12. File-touch index (quick reference for implementers)

- Schema: `packages/db/src/schema/project.ts`, `git.ts`; relations in `packages/db/src/relations/infra.ts`.
- Resolver: `packages/api/src/lib/variables/{resolver,exporters,parser}.ts`, `routers/service/queries/env.ts`.
- Runtime/branching: `packages/api/src/runtime/{types,docker-driver,docker-driver-db,swarm-driver}.ts`, new `runtime/snapshot/`, `swarm/database*.ts`, `routers/project/view-helpers.ts` (`buildVolumeName`).
- Backups reuse: `packages/api/src/backups/{engine,engine-helpers,exec}.ts`.
- GitHub: `packages/api/src/git/{github-app,webhook-handler}.ts`, new `handle-pull-request.ts`; edge unchanged (`apps/server/src/handlers/github/webhook.ts`).
- Build/deploy: `apps/builder/src/{pipeline,build-one}.ts`, `packages/api/src/routers/service/{redeploy,deploy-hook,expose,spec}.ts`, `packages/jobs/src/jobs/deploy.ts`.
- Env config: `packages/env/src/server.ts`.
- UI: `apps/web/src/routes/_app/$orgSlug/$projectSlug/variables.tsx` + `-components/`, `apps/web/src/features/resources/components/*/tabs/variables/`.
</content>
</invoke>

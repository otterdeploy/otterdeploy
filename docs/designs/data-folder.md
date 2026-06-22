# Host data folder — `/data/otterdeploy`

Status: **built.** All five phases are done — foundation, builds, backups
staging, DR escape hatch, and the orphan sweep. Owner: platform.

A single, predictable host directory for the artifacts the platform *generates* —
build clones, backup dumps, a disaster-recovery escape hatch, db init material —
keyed by `resourceId`, with a guarded teardown. The path helper lives in
`packages/shared/src/paths.ts` (`DATA_ROOT`, default `/data/otterdeploy`, override
`OTTERDEPLOY_DATA_DIR`) and the guarded `fs` ops in `packages/api/src/lib/data-dir.ts`.
The builder clones to `<DATA_ROOT>/builds/<deploymentId>` (falling back to an
ephemeral `mkdtemp` when the folder isn't writable), and a layer cache lives under
`<DATA_ROOT>/buildx-cache/`. Everything else is still Postgres + the Docker/Swarm
API. This doc says exactly what does (and does **not**) belong in the folder.

## Why — and why it's NOT load-bearing for us

Both competitors render generated files to a host folder and run Docker against
those files, so the folder *is* their deploy mechanism:

- **Coolify** → `/data/coolify/{applications,services,databases}/<uuid>/` holds a
  generated `docker-compose.yml` per resource; deploy is
  `docker compose -f .../<uuid>/docker-compose.yml up -d`. (`research/coolify`,
  `bootstrap/helpers/shared.php` `base_configuration_dir()`.)
- **Dokploy** → `/etc/dokploy/{applications,compose,...}/<appName>/` holds the
  clone + rendered compose + Traefik config. (`research/dokploy`,
  `packages/server/src/constants/index.ts` `paths()`.)

We deploy through the **`runtime()` driver** (`packages/api/src/runtime/`) by
building a spec and calling `provision/update/destroy` against the Docker/Swarm
API directly — compose stacks store their `composeContent` in the DB row and are
parsed **in-memory** at deploy. The manifest (jsonb) + resource rows are the
source of truth.

So for us the folder is an **ops/convenience layer, not the deploy path.** It
must stay optional: losing it never breaks a deploy, it just removes a
convenience. That framing drives every decision below.

What genuinely benefits from a host folder:

- **Debuggable builds.** A failed build's clone currently vanishes into a random
  tmp dir; a predictable `builds/<deploymentId>` is inspectable and cap-able, and
  opens the door to build caching.
- **Backups landing zone.** Dumps need somewhere to stage before off-cluster
  upload (`packages/api/src/backups`).
- **Disaster-recovery escape hatch.** A rendered `compose.yml` + `otterdeploy.json`
  per project you can run by hand if the control plane is gone.
- **Orphan-sweep safety net.** A self-describing tree the platform can reconcile
  against the DB — the failure mode Dokploy has (it swallows cleanup errors, so
  orphaned dirs linger forever).

## Layout

Keyed by **`resourceId`**, deliberately. The graph node id is `${kind}:${name}`,
but the DB id is the stable `resourceId` — keying folders by it survives renames
and can't collide, sidestepping Dokploy's `appName`-churn and matching Coolify's
stable-uuid approach.

```
/data/otterdeploy/                         # OTTERDEPLOY_DATA_DIR overrides the root
├── projects/<projectId>/
│   ├── otterdeploy.json         # exported manifest snapshot (DR / audit)
│   └── compose.yml              # rendered escape hatch (manifest.export output)
├── resources/<resourceId>/
│   ├── meta.json                # { kind, name, projectId } — self-describing → orphan sweep
│   ├── ssl/                     # db TLS material, if any
│   └── init/                    # db init-script seed (cf. Coolify's docker-entrypoint-initdb.d)
├── builds/<deploymentId>/       # build clone + context (replaces the ephemeral tmpdir)
├── backups/<resourceId>/<ts>.dump
├── caddy/                       # reconciled Caddyfile + per-project snippets
└── ssh/                         # deploy keys (future remote/multi-node), 0700
```

## One paths helper

The path lives in exactly one place — mirror Coolify's `base_configuration_dir()`:

```ts
// packages/api/src/lib/paths.ts
export const DATA_ROOT = process.env.OTTERDEPLOY_DATA_DIR ?? "/data/otterdeploy";
export const resourceDir = (id: ResourceId)    => join(DATA_ROOT, "resources", id);
export const buildDir    = (dep: DeploymentId) => join(DATA_ROOT, "builds", dep);
export const backupDir   = (id: ResourceId)    => join(DATA_ROOT, "backups", id);
export const projectDir  = (id: ProjectId)     => join(DATA_ROOT, "projects", id);
```

## Lifecycle + guarded cleanup

Steal Coolify's cheap insurance: never `rm -rf` a path unless it resolves
**inside** `DATA_ROOT` *and* ends with the id it claims to be.

```ts
export async function removeResourceDir(id: ResourceId): Promise<void> {
  const dir = resolve(resourceDir(id));
  if (!dir.startsWith(resolve(DATA_ROOT) + sep) || !dir.endsWith(id)) return;
  await rm(dir, { recursive: true, force: true });
}
```

- **Create** — lazy `mkdir` on first write, not upfront.
- **Write** — builder → `builds/<deploymentId>`; backups → `backupDir(id)`;
  `manifest.export` → `projectDir(id)`.
- **Deploy** — *unchanged.* The `runtime()` driver still drives the Docker/Swarm
  API; the folder only holds artifacts.
- **Delete** — call `removeResourceDir(id)` from the paths that already tear
  resources down: `deleteResourceById`, the compose `delete` handler (right next
  to the project-var cleanup), the postgres delete, and the reconciler's delete
  phase.
- **Orphan sweep** — a periodic job lists `resources/*` (+ `builds/*` past a TTL)
  and removes any dir whose id is absent from the DB. `meta.json` makes the sweep
  self-describing and is the answer to "what if a delete crashed mid-teardown."

## Touchpoints

| Where | Change |
|---|---|
| `apps/builder/src/clone.ts` | `mkdtemp(tmpdir())` → `buildDir(deploymentId)` (predictable, debuggable, cleanable; enables build cache later) |
| `packages/api/src/backups` | stage dumps under `backupDir(id)` before off-cluster upload |
| `compose/index.ts` delete · `deleteResourceById` · postgres delete · reconciler delete | `await removeResourceDir(id)` |
| `manifest.export` | optionally persist snapshot + rendered compose to `projectDir` |
| Caddy reconcile | write under `DATA_ROOT/caddy` |

## Multi-node

The folder lives on the **control plane**. Per-node artifacts (volumes) stay
Docker-managed and are not mirrored here. When remote swarm nodes land, run
build/cleanup against the node through the `runtime()` driver (the same way
Coolify runs `rm -rf` over SSH), still keyed by `resourceId`.

## Security

Build clones and `ssh/` can contain `.env` files and keys, so the tree is
secret-bearing. Create `DATA_ROOT` `0700`, owned by the control-plane user (the
same posture as the CLI's `~/.config/otterdeploy/config.json`), and keep it out
of any world-readable mount or backup that isn't itself encrypted.

## Phases

1. ✅ **Foundation** — `paths.ts` helper + guarded `removeResourceDir` /
   `removeProjectDir` (`lib/data-dir.ts`), wired into the delete paths
   (`compose/index.ts`, `queries/resource.ts`, `deleteProject`). No-op when the
   folder isn't writable.
2. ✅ **Builds** — builder clones to `buildDir(deploymentId)` with a `mkdtemp`
   fallback (`clone.ts`); `pruneStaleBuilds` TTL sweep (`build-workdir.ts`);
   layer cache under `buildx-cache/` (`buildx.ts`).
3. ✅ **Backups** — the engine stages each archive to `backupDir(resourceId)`
   before the (possibly off-cluster) upload (`backups/engine.ts` +
   `stageBackupArchive`); the staged copy is dropped on a successful upload and
   left behind on failure for inspection/retry (the sweep reclaims stale ones).
4. ✅ **DR escape hatch** — on every successful `applyManifest`,
   `writeProjectEscapeHatch` (`lib/escape-hatch.ts`) renders the project's current
   rows to `projects/<projectId>/compose.yml` + `otterdeploy.json` (best-effort,
   `0600`, never blocks the apply); `removeProjectDir` drops it on project delete.
   **DR/audit only — never `up`'d by the platform.**
5. ✅ **Orphan sweep** — `lib/data-folder-sweep.ts` reconciles `resources/*`,
   `projects/*`, and `backups/*` against the DB on a control-plane tick
   (`startDataFolderSweep`, started from the server bootstrap): a dir whose id is
   absent from the DB is reclaimed via the same guarded removers, and staged
   backup archives past a TTL are swept. `builds/*` stays with the builder's own
   `pruneStaleBuilds`. Best-effort + `unref`'d, like the backup scheduler.

## Deferred / non-goals

- **Per-resource rendered compose as the deploy mechanism** — we deploy via the
  runtime API; the rendered `compose.yml` is DR/audit-only, never `up`'d by the
  platform.
- **Mirroring the folder to worker nodes** — control-plane-local until remote
  multi-node build/exec lands.
- **Encryption at rest** — the folder relies on filesystem perms today, same as
  DB-stored secrets; an encrypted-at-rest pass is a separate effort.

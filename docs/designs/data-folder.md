# Host data folder — `/data/otterdeploy`

Status: **built.** Owner: platform. The path helpers live in
`packages/shared/src/paths.ts` (`DATA_ROOT`, default `/data/otterdeploy`,
override `OTTERDEPLOY_DATA_DIR`) — that file is the authority on the layout —
and the guarded `fs` ops (create / guarded remove / availability check) live in
`packages/api/src/lib/data-dir.ts`.

One host directory holds everything the platform keeps on disk: its own install
source and config, tenant artifacts (backups, escape hatches, db init material,
managed data volumes), build scratch, and regenerable caches. The tree is
organized so that the **first path segment answers "can I delete this?"** and
the tenant subtree **mirrors the DB hierarchy**, keyed by stable ids.

## Why — and why most of it is NOT load-bearing for us

Both competitors render generated files to a host folder and run Docker against
those files, so the folder *is* their deploy mechanism:

- **Coolify** → `/data/coolify/{applications,services,databases}/<uuid>/` holds a
  generated `docker-compose.yml` per resource; deploy is
  `docker compose -f .../<uuid>/docker-compose.yml up -d`. (`research/coolify`.)
- **Dokploy** → `/etc/dokploy/{applications,compose,...}/<appName>/` holds the
  clone + rendered compose + Traefik config. (`research/dokploy`.)

We deploy through the **`runtime()` driver** (`packages/api/src/runtime/`) by
building a spec and calling `provision/update/destroy` against the Docker/Swarm
API directly — compose stacks store their `composeContent` in the DB row and are
parsed **in-memory** at deploy. The manifest (jsonb) + resource rows are the
source of truth. So for us, most of the folder is an **ops/convenience layer,
not the deploy path**: debuggable builds, a backups landing zone, a
disaster-recovery escape hatch, and a self-describing tree the orphan sweep can
reconcile against the DB.

The exceptions — the parts that ARE load-bearing — all live under one subtree,
`platform/`, which is exactly why the top level is split by lifecycle rather
than by artifact kind.

## Layout: top level = lifecycle, tenant tree = the DB hierarchy

Two organizing principles, one per depth:

1. **The top level separates by owner and lifecycle.** Four dirs, four answers
   to "can I delete this?": `platform/` never (it IS the platform), `orgs/`
   only per the DB (tenant data), `work/` freely past a TTL (build scratch),
   `cache/` always (regenerable).
2. **The tenant tree mirrors the DB**: org → project → environment → resource,
   each level keyed by its stable id (never a name), so the tree is rename-safe
   and collision-free — sidestepping Dokploy's `appName`-churn, matching
   Coolify's stable-uuid approach — and every DB row's on-disk footprint is one
   subtree.

```
/data/otterdeploy/                       # OTTERDEPLOY_DATA_DIR overrides the root
├── platform/                            # THE PLATFORM — load-bearing, 0700, never swept
│   ├── source/                          #   compose.yml + override + .env — the install root
│   │                                    #   (OTTERDEPLOY_INSTALL_DIR default; config + master secrets)
│   ├── backups/<ts>-<reason>/           #   self-update safety sets, one dir per event:
│   │                                    #   control-plane.dump + env.bak + override.bak
│   ├── caddy/                           #   reconciled Caddyfile (bind-mounted into the caddy container)
│   ├── geoip/                           #   asn.mmdb, dbip-country.mmdb (managed downloads)
│   ├── branch-pool.img                  #   loopback image backing the DB branch pool on non-ZFS hosts
│   └── update-status.json               #   in-flight self-update snapshot (survives container recreate)
├── orgs/<orgId>/                        # ALL tenant data — nothing tenant-owned lives outside it
│   ├── backups/<scope>/                 #   durable rustic repos, one per scope (restorable history)
│   └── projects/<projectId>/
│       ├── escape-hatch/                #   otterdeploy.json + rendered compose.yml (DR/audit only)
│       └── envs/<envId|main>/           #   `main` = the NULL environment_id (main) environment
│           └── resources/<resourceId>/  #   one resource, one home
│               ├── meta.json            #     self-describing → orphan sweep
│               ├── ssl/                 #     db TLS material, if any
│               ├── init/                #     db init-script seed
│               ├── volumes/[<member>/]  #     managed DB data volume(s); compose fans out per member
│               └── backup-staging/      #     per-run dump scratch, TTL-swept
├── work/                                # ephemeral build scratch — a crash here loses nothing durable
│   ├── builds/<projectId>/<deploymentId>/     # per-build clone + context
│   └── sources/<projectId>/<deploymentId>.tar.gz  # uploaded source tarballs (CLI deploys)
└── cache/                               # regenerable — always safe to wipe entirely
    └── buildx/                          # BuildKit layer cache
```

Notes on the shape:

- **`envs/main`** encodes the DB convention that a resource row with a NULL
  `environment_id` belongs to the project's main environment — the `main`
  segment stands in for the missing id (`envSegment` in `paths.ts`).
- **One resource, one home.** Everything a resource owns — metadata, TLS, init
  scripts, its managed data volume, its backup staging — lives under its single
  `resources/<resourceId>/` dir. "Everything for resource X" is one `ls`;
  deleting the resource is one guarded subtree removal.
- **Managed volumes are resource-homed** (`volumes/` under the resource, keyed
  by the stable `resourceId`, not the Docker volume name). A DB branch is a new
  resource row → its own dir automatically. On a ZFS host these are managed
  datasets so branches are thin clones (see `docs/designs/pr-previews.md` §4.3,
  `docs/designs/db-branching.md`).
- **`work/` stays project-keyed, not org-keyed**, on purpose: it's the
  high-churn build hot loop and the shallow path keeps it simple. Nothing under
  it survives a build's useful life.

## Three directories called "backups", three meanings

The word appears three times in the tree and means a different thing each time
— deliberately, because the three have different owners and lifecycles:

| Path | What it is | Lifecycle |
|---|---|---|
| `platform/backups/<ts>-<reason>/` | **Self-update safety sets**: control-plane `pg_dump` + `.env` + compose override, grouped per event so a set is restored or discarded as a unit | Kept by the self-updater; never swept |
| `orgs/<orgId>/backups/<scope>/` | **Durable tenant backup repos** (rustic), one repo per scope — restorable history | Durable; removed only with the org |
| `.../resources/<resourceId>/backup-staging/` | **Per-run dump scratch** staged before off-cluster upload | Written and cleared per run; TTL-swept |

Restorable history never lives under a path whose contents look disposable —
that's why the durable repos sit at the org level while the per-run dumps sit
inside the resource's own scratch dir.

## One paths helper

Every path derives from `packages/shared/src/paths.ts` — pure path derivation,
no `fs`, safe to import from any layer (builder, api). Tenant paths take a
`ResourceRef` (`organizationId`, `projectId`, `environmentId | null`,
`resourceId`); `environmentId: null` lands under `envs/main/`. Never construct
a data-folder path by hand.

## Lifecycle + guarded cleanup

Cheap insurance stolen from Coolify: never `rm -rf` a path unless it resolves
**inside** `DATA_ROOT` *and* ends with the id it claims to be
(`packages/api/src/lib/data-dir.ts`).

- **Create** — lazy `mkdir` on first write, not upfront. The installer creates
  only the root and `platform/` (both `0700`).
- **Write** — builder → `work/builds/...`; backup engine stages to the
  resource's `backup-staging/`; `manifest.export` → the project's
  `escape-hatch/`; Caddy reconcile → `platform/caddy/`.
- **Deploy** — *unchanged.* The `runtime()` driver drives the Docker/Swarm API;
  the folder only holds artifacts (plus the managed volume bind mounts).
- **Delete** — the resource/project/org delete paths remove the matching
  subtree via the guarded removers. Deleting an org is one subtree.
- **Sweep** — see below.

## The orphan sweep

`lib/data-folder-sweep.ts`, on a control-plane tick: **each tenant level
reconciles against its DB table** — orgs against `organization`, projects
against `project`, environments against `environment` (with `main` always
valid), resources against the resource tables — removing any dir whose id no
longer exists, all through the same guarded removers. A missing parent reclaims
the whole subtree in one step. `meta.json` keeps resource dirs self-describing
(the answer to "what if a delete crashed mid-teardown").

Scratch is TTL-based rather than DB-reconciled: stale `backup-staging/`
contents and orphaned `work/sources/` tarballs are swept past a TTL;
`work/builds/` stays with the builder's own `pruneStaleBuilds`.

The sweep **never touches `platform/` or `cache/`**: `platform/` is
load-bearing and has no DB table to reconcile against; `cache/` is harmless by
construction (regenerable), and wiping it is a disk-reclaim action, not
hygiene.

## Multi-node

The folder lives on the **control plane**. Per-node artifacts stay
Docker-managed and are not mirrored here. When remote swarm nodes land, run
build/cleanup against the node through the `runtime()` driver (the same way
Coolify runs `rm -rf` over SSH), still keyed by the same stable ids.

## Security

The tree is secret-bearing: `platform/source/` holds the master secrets,
build clones can contain `.env` files, dumps hold tenant data. `DATA_ROOT` and
`platform/` are created `0700`, owned by the control-plane user (the same
posture as the CLI's `~/.config/otterdeploy/config.json`). Bind-mount scope is
deliberately narrow where it matters: `caddy` mounts only `platform/caddy/`,
build helper containers mount only `cache/buildx/` — nothing untrusted gets
`platform/source/`.

## Deferred / non-goals

- **Per-resource rendered compose as the deploy mechanism** — we deploy via the
  runtime API; the rendered `escape-hatch/compose.yml` is DR/audit-only, never
  `up`'d by the platform.
- **Mirroring the folder to worker nodes** — control-plane-local until remote
  multi-node build/exec lands.
- **Encryption at rest** — the folder relies on filesystem perms today, same as
  DB-stored secrets; an encrypted-at-rest pass is a separate effort.

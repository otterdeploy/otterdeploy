# Preview environments & copy-on-write databases

Status: **design.** Foundation (previews-as-resources, per-PR compute, logical
`copy` DB tier) is **built**; this doc specifies the two additions that make a
preview a faithful, cheap replica of production: **(1) one shared `Preview`
environment** for config divergence, and **(2) instant ZFS copy-on-write
Postgres branches**, one per PR.

Supersedes the data-model sections of [`db-branching.md`](./db-branching.md) (which
still says a branch lives *under* an environment — that model was removed in
`3678b0f3`, "previews are resources, not environments"). Research backing:
[`neon-cow-branching-research.md`](./neon-cow-branching-research.md). Builds on
the shipped preview lifecycle in [`pr-previews.md`](./pr-previews.md), the host
data folder ([`data-folder.md`](./data-folder.md)), and the backup engine
([`backups.md`](./backups.md)).

Target host: **a single ZFS-capable node.** Multi-node CoW (clone can't migrate)
is out of scope; non-ZFS nodes keep the logical `copy` fallback.

---

## 1. The model — one sentence

**A preview is one PR's ephemeral copy of production**, built from the PR head
SHA and scoped by `previewId` — *not* an environment. Each PR gets its own
compute (already built) and its own copy-on-write Postgres branch (this doc),
while resolving env vars against **one shared `Preview` environment**.

```
ONE  Preview environment  (per project, a single row — NOT one per PR)
 └── N  preview instances  (one per open PR, keyed to project + repo + PR#)
        ├── compute   — its own `-pr-N` container(s) at head SHA         [built]
        ├── database  — its own CoW Postgres branch per referenced DB    [this doc]
        ├── config    — env vars resolved against the Preview env        [this doc]
        └── URL       — svc-prN.<base> via a preview Caddy route          [built]
```

This is the deliberate middle path between the two rejected extremes:

- **Not** "preview = full environment" (the pre-`3678b0f3` model). That branched
  *every* DB per PR (disk blowup), let preview pre/post-deploy hooks run against
  **production** DBs, leaked phantom preview rows into the environment UI, and
  hit cross-repo teardown collisions. We keep previews as `previewId`-scoped
  resources so all four stay fixed **by construction**.
- **Not** today's "preview shares production verbatim." A preview borrows prod's
  env vars and prod's databases; there is no safe place for preview-only config,
  and an un-branched DB means preview code writes prod data.

The fix is small and additive: **one** extra environment row (config divergence)
+ **per-PR CoW DB** (data isolation). No per-PR environment explosion.

---

## 2. The `Preview` environment (config divergence)

Today previews resolve env vars against the project's production environment
verbatim (`resolver.ts` `loadScopeExports`: *"Previews read the same bag (they
are not environments)"*). Add exactly one project-scoped environment named
`Preview` that previews resolve against instead.

- **One row per project**, created lazily on first preview (or with the project).
  It is a normal `environment` row — it shows in the environment switcher like
  `Development`/`Production`, so operators can set preview-only vars (test API
  keys, feature flags, `NODE_ENV=preview`) in one place.
- **Resolution order for a preview deployment** (extends `resolver.ts`):
  `system overrides` › `serviceEnvVar{previewId}` (per-PR override) ›
  `projectEnvVar{Preview env}` › `serviceEnvVar{Preview env}` › service defaults.
  Production's bag is **not** consulted for a preview — the Preview env is the
  base. (A "inherit unset keys from Production" toggle is a later refinement, not
  v1: explicit beats magic, and inheritance-by-reference is what made the old
  model dangerous.)
- **Not one-per-PR.** The per-PR dimension is the deployment + the branched DB,
  never an environment row. This is the property that keeps the environment
  namespace clean and dodges the `3678b0f3` traps.

`projectEnvVar` is already keyed `(projectId, environmentId, key)` and
`serviceEnvVar.environmentId` already exists — so this is a resolver change plus
seeding one row, not new schema.

---

## 3. The CoW primitive (single node)

A branchable Postgres keeps its data directory on **its own ZFS dataset**,
**bind-mounted** into the container. Docker never uses the ZFS storage driver —
it bind-mounts a directory; ZFS provides copy-on-write underneath. A branch is
four steps:

```
docker exec <src> psql -c 'CHECKPOINT;'                 # clean, fast recovery
zfs snapshot  otter/pg/<resourceId>@pr<N>               # instant, read-only
zfs clone     otter/pg/<resourceId>@pr<N> otter/pg/<branchId>   # instant, CoW, RW
# run a normal Postgres container, bind-mounting /otter/pg/<branchId>
#   at /var/lib/postgresql/data
```

The clone shares every unchanged block with the parent and only allocates blocks
it writes: **50 PRs off a 1 TB DB cost ≈ 1 TB + Σ(divergence), not 50 TB.** The
new container boots the clone via **standard Postgres crash recovery** — a ZFS
snapshot of a live PGDATA is crash-consistent, exactly like a power-loss restart;
the `CHECKPOINT` just shortens replay.

Why ZFS and not Neon-style page branching: the [Neon research](./neon-cow-branching-research.md)
concludes the three things Neon's architecture uniquely buys — branch-from-any-WAL,
scale-to-zero, cross-node — are precisely the three a preview DB doesn't need.
ZFS snapshot+clone gets ~99% of the value for ~1% of the effort, on stock Postgres.

### Dataset layout

```
otter                                # the pool (file-backed image is fine)
└── otter/pg/
    ├── <resourceId>                  # a branchable source DB   (recordsize=16k, atime=off, logbias=throughput)
    │   └── @pr<N>                    # read-only snapshot, one per PR branch
    └── <branchId>                    # writable CoW clone → one preview branch container
```

The pool is mounted at `${DATA_ROOT}/volumes`, so a dataset per branchable DB
lands at `${DATA_ROOT}/volumes/<projectId>/<resourceId>` — the existing
`volumeDir()` path (`packages/shared/src/paths.ts`), keyed by the stable
`resourceId`. A branch is a new resource → its own `volumeDir` for free, no
collision.

---

## 4. Prerequisite — PGDATA must live on a ZFS dataset

**This is the load-bearing, easy-to-miss task.** Today managed DB data lives in
**Docker named volumes** (`/var/lib/docker/volumes/<name>/_data`), not under
`DATA_ROOT` — see `databaseResource.legacyVolumeName` ("rows whose bytes still
live in `/var/lib/docker/volumes/<name>`"). **You cannot `zfs clone` a named
volume.** So before any CoW works:

1. Provision new DB volumes as **bind mounts** under
   `${DATA_ROOT}/volumes/<projectId>/<resourceId>` (which sits on the pool),
   instead of Docker named volumes. Touches `docker-driver-db.ts` (currently
   `Type: "volume"`) and the swarm equivalent (`database-internals.ts`).
2. **One-time migration** of existing DBs off named volumes onto the managed
   path (copy bytes, repoint the mount, clear `legacyVolumeName`). Until
   migrated, a resource is **`copy`-only, not ZFS-clonable** — mark it so.

A DB is only ZFS-branchable once its bytes sit on a dataset under the pool.

---

## 5. Data model

The `preview` table and `previewId` scoping already exist. The branch columns on
`databaseResource` are already partly scaffolded — finish them:

- `branchStrategy` (`pgEnum ["zfs","copy"]`) — which tier produced this branch. **exists.**
- `branchedFromResourceId` (self-FK → source resource). **exists** (set by `branchOne`).
- `branchSnapshotRef` (text, nullable) — the `otter/pg/<resourceId>@pr<N>` snapshot for teardown; NULL on `copy`. **exists.**
- `legacyVolumeName` (text, nullable) — pre-migration named volume; NULL once on `volumeDir`. **exists.**
- `previewBranching` (bool, default **false**) — per-DB opt-in. **exists.** On a
  ZFS host, default-on is safe (branches are cheap); keep opt-in only where the
  host is `copy`-only. Decide by `resolveSnapshotDriver().kind`.
- add `expiresAt` (timestamptz, nullable) — branch TTL for GC (see §7). *new.*

⚠️ **Relax the global unique indexes** on `databaseResource.databaseName` /
`username` / `internalHostname`. A CoW clone boots on a **non-empty PGDATA**, so
Postgres ignores `POSTGRES_*` and the branch keeps the **source's** db/user/pass
— two branches of one DB share `databaseName`/`username` and collide under a
global unique. Scope them the same way the `previewId` partial-unique indexes
already scope resource names.

---

## 6. Runtime resolution (unchanged mechanics, new targets)

```
browser ─► Caddy @ svc-prN.<base>  (preview proxy_route, previewId)
        ─► svc-prN container  (deployment previewId=<PR>, head SHA)
             env  ─► Preview environment  (§2)
             ${{postgres.DATABASE_URL}} ─► resolveResourceForPreview():
                   WHERE name='postgres' AND (previewId=<PR> OR previewId IS NULL)
                   ORDER BY previewId NULLS LAST      ← branch wins, else base
             ─► branch Postgres (PR's CoW clone)      ← prod never touched
```

The re-resolution is **already how it works** (`service/queries/env.ts`
`resolveResourceForPreview`). CoW just changes what the branch row points at
(a clone instead of a `pg_restore`d fresh DB). Un-branched DBs and non-Postgres
engines fall through to the base row (shared) — unchanged.

---

## 7. Lifecycle

Driven by the existing `pull_request` webhook path
(`handle-pull-request.ts` → `deployPreviews`/`closePreviews`).

- **PR opened / reopened** — `ensurePreview` (built) → for each referenced,
  branch-eligible Postgres: `zfs snapshot` + `zfs clone` + boot branch container
  with **source creds recorded verbatim** on the branch row; set
  `branchSnapshotRef`, `expiresAt`. Deploy compute at head SHA.
- **PR synchronize (new commits)** — **reuse the existing branch** (do not
  re-branch; the DB persists across pushes so migrations/data survive). Redeploy
  compute at the new SHA. Bump `expiresAt`.
- **PR closed / merged** — `teardownPreview` (built): remove `-pr-N` containers,
  `destroyDatabaseBranch` → `zfs destroy otter/pg/<branchId>` + `zfs destroy
  …@pr<N>` (frees shared blocks), remove preview routes + Caddy reconcile, delete
  preview-scoped rows.
- **Idle / TTL GC (mandatory)** — the reaper already tears down previews past
  `autoTeardownAt`; extend it to enforce **branch `expiresAt`** too. A `zfs
  clone` **pins its origin snapshot**, so a forgotten branch is a permanent disk
  leak, and a **full pool suspends ZFS → every branch DB hangs at once.** TTL is
  not optional.

---

## 8. Pool operations & safety (mostly built)

`packages/api/src/system-health/branch-pool.ts` already manages a file-backed
pool via a privileged `nsenter -t 1` host helper (`host-run.ts`):
`getBranchPoolHealth`, `trimBranchPool` (`zpool trim` + `autotrim=on`),
`growBranchPool` (`truncate -s +N` + `zpool online -e`), and the pre-branch
`checkBranchHeadroom` (returns **507** when host free disk is below reserve — an
honest refusal beats a half-restored branch or a suspended pool). What's missing
is only **pool creation** in the installer and the actual snapshot/clone driver.

Three hazards the design already accounts for:
1. **Sparse files only grow** → `autotrim=on` + on-demand `zpool trim` reclaim
   freed blocks back to the host fs.
2. **Never size past the disk** → ENOSPC makes ZFS suspend the pool; the
   installer sizes from reality (¼ of free at `$DATA_DIR`, cap 40G, 5G floor),
   and grows only within a 2G host reserve.
3. **Shrinking is impossible** → start small, `zpool online -e` to grow live.

Surface pool fill + image physical-vs-apparent size on the Server-health card;
a grow suggestion past ~70% with host headroom; `host.pressure` for
unhealthy/suspended pools.

---

## 9. Fallback — the logical `copy` tier (built, universal)

Where there's no ZFS pool (a non-ZFS node, or a pre-migration `legacyVolumeName`
DB), branching falls back to the **logical** tier that ships today:
`pg_dump --format=custom` → `pg_restore` into a fresh `databaseResource`
(`preview-db.ts` → `docker-driver-branch.ts` → `backups/copy.ts`). **Identical
UI, identical rows** — only `branchStrategy` differs (`zfs` vs `copy`). It
doubles disk and takes minutes, but needs zero host setup, and it's the same
primitive that powers "copy prod verbatim." A `copy` branch gets **fresh** creds
(a fresh `initdb`), unlike a clone.

---

## 10. Consistency & credentials

- **Consistency** — `CHECKPOINT` (or `pg_backup_start`/`_stop`) immediately
  before `zfs snapshot`. Keep PGDATA on a **single** dataset (no per-DB
  tablespaces on separate datasets) so one `zfs snapshot` is atomic.
- **Credentials** — a **clone keeps the source's creds** (record them verbatim on
  the branch row; §5); a **`copy`** branch gets new creds. Each is generated
  deterministically from the id like the source (`postgres/credentials.ts`), so a
  leaked branch DSN never exposes prod.
- ⚠️ **Encrypt `databaseResource.password` first.** It's plaintext at rest today;
  branching multiplies credential copies. This is a hard prerequisite (see the
  plan, Phase 0).

---

## 11. Non-goals

- Neon-grade scale-to-zero, storage/compute separation, branch-from-any-WAL.
- Cross-node CoW clones (single-node by nature; pinned).
- Branching engines other than Postgres (v1 is Postgres-only; the dataset
  mechanism generalizes later).
- Data masking / anonymization of branch data (raw clones for v1).
- Reverting previews to environments (`3678b0f3` stands; this doc keeps
  previews-as-resources and adds exactly one shared `Preview` env).

---

## 12. Touchpoints

| Where | Change |
|---|---|
| `docker-driver-db.ts`, `swarm/database-internals.ts` | DB volumes as `volumeDir` bind mounts (not named volumes) — the ZFS prerequisite |
| one-time migration script | move existing DB bytes off named volumes; clear `legacyVolumeName` |
| `scripts/install.sh` | detect / auto-provision the file-backed ZFS pool; write `BRANCH_ZFS_POOL` |
| `runtime/snapshot/{index,zfs}.ts` | implement the `zfs` `SnapshotDriver` (`branch`/`destroy`/`probe`); currently always falls back to `copy` |
| `runtime/docker-driver-branch.ts` | replace the `strategy !== "copy"` 501 with the real snapshot/clone path; keep source creds on the branch row |
| `packages/db/src/schema/project.ts` | add `expiresAt`; relax `databaseName`/`username`/`internalHostname` unique indexes; default `previewBranching` on where ZFS |
| `resolver.ts`, `env/` router | seed one `Preview` environment; resolve preview env vars against it |
| `preview-reaper.ts` | enforce branch `expiresAt` (TTL GC) alongside preview idle GC |
| `apps/web` | Preview-env variables surface; branch/pool-capacity meter on Server-health; per-DB branching toggle |

See [`preview-cow-databases-plan.md`](./preview-cow-databases-plan.md) for the
ordered build checklist.

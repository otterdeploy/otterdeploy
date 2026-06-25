# Database branching — preview & copy-prod environments

Status: **design.** Not built. Owner: platform. Builds on the `runtime()` driver
(`docs/designs/runtime.md`), the backup engine (`docs/designs/backups.md`), the
host data folder (`docs/designs/data-folder.md`), and the dormant `environment`
table (`packages/db/src/schema/project.ts`).

Neon-style **preview databases** for a self-hosted PaaS: spin up a writable copy
of a production Postgres for a branch/PR/staging env in seconds, and refresh it
from the source on a schedule. Two engines under one button — a **logical copy**
that works on every install, and an **instant copy-on-write (CoW) clone** on
hosts with a ZFS pool. Neither Coolify nor Dokploy ships anything like this; it
is the marquee differentiator, not a checkbox.

## Why — and the honest scope

Users ask for two different things and conflate them:

1. **"Copy prod verbatim at certain times"** — a real, independent copy of the
   prod data, refreshable on a schedule (nightly staging that mirrors prod).
2. **"Preview / branch databases"** — an ephemeral, cheap, instant copy per
   PR/env that diverges from the parent.

These have very different cost, so we ship them as **two tiers of the same
feature**. The platform picks the best engine the host can support; the UX —
"Create branch from `<source>`" — is identical.

| Tier | Engine | Branch cost | Host requirement |
|---|---|---|---|
| **Logical copy** (default, universal) | `pg_dump` → restore into a new `database_resource` | full copy, minutes | none — runs on any install |
| **CoW clone** (instant) | `zfs snapshot` + `zfs clone` of the data dir, mounted into a new container | seconds, space-shared | a ZFS pool (auto-provisioned by the installer, even file-backed) |

**We are NOT rebuilding Neon.** No scale-to-zero, no storage/compute separation,
no branch-from-any-WAL-point. This is **snapshot-based branching of a normal
Postgres** — sold as "preview / branch databases," not "serverless Postgres."
Claiming Neon-parity invites a comparison we lose; the honest pitch ("a real
copy of prod for every PR, on your own box, no per-branch cloud bill") wins on
its own.

### Why this fits us cheaply

- The **logical tier is ~free to build** — `executeBackup()`
  (`packages/api/src/backups/engine.ts`) already does `pg_dump --format=custom`
  over `docker exec`; a branch is that dump restored into a freshly provisioned
  `database_resource`. The missing half is **restore**, which we need anyway.
- The **CoW tier is a thin driver extension** — the `RuntimeDriver`
  (`packages/api/src/runtime/types.ts`) already owns
  `provisionDatabase`/`destroyDatabase`; branching adds a `branchDatabase` that
  snapshots a dataset and provisions a container on the clone. The control plane
  shells out to `zfs`/`zpool` exactly like it already shells out to `railpack`
  and `cscli`.
- The **`environment` table already exists** (dormant, "Phase 6+") — it is the
  natural home for a branch with zero new top-level modeling.

## Architecture

### The CoW primitive

A branchable Postgres keeps its data directory on its **own ZFS dataset**, which
is **bind-mounted** into the container. Docker never needs the ZFS storage
driver — it just bind-mounts a directory; ZFS provides CoW underneath. A branch
is four commands:

```
zfs snapshot  otter/pg/<resourceId>@<branchId>          # instant, read-only
zfs clone     otter/pg/<resourceId>@<branchId> otter/pg/<branchId>   # instant, CoW, writable
# provision a normal Postgres container, bind-mounting /otter/pg/<branchId>
#   at /var/lib/postgresql/data, with the branch's own generated credentials
```

The clone shares every unchanged block with the parent and only allocates blocks
it writes — so 50 branches of a 1 TB DB cost ~1 TB + divergence, not 50 TB. The
new container boots the clone via **normal Postgres crash recovery** (a ZFS
snapshot of a live PGDATA is crash-consistent — exactly like a power-loss
restart, which Postgres always recovers from). Optionally `CHECKPOINT;` (or
`pg_backup_start()`/`pg_backup_stop()`) immediately before the snapshot for a
faster, cleaner recovery.

### Dataset layout

One ZFS pool, one dataset per branchable database, tuned for Postgres:

```
otter                                  # the pool (real vdev in prod, file-backed otherwise)
└── otter/pg/
    ├── <resourceId>                   # a branchable source DB's data dir   (recordsize=16k, atime=off)
    │   └── @<branchId>                # read-only snapshot taken per branch / per scheduled refresh
    └── <branchId>                     # a writable CoW clone → one branch container
```

`recordsize=16k`, `atime=off`, `logbias=throughput` on `otter/pg/*` — the
default 128k recordsize hurts Postgres.

### Zero-hardware substrate (the thing that makes it sellable)

ZFS does **not** need a spare disk. The installer (`scripts/install.sh`) can
build a pool from a file on the existing root fs:

```
truncate -s <size> /data/otterdeploy/branch-pool.img
zpool create otter /data/otterdeploy/branch-pool.img
```

Performance is lower than a real vdev but irrelevant for preview/staging DBs (no
prod traffic). This collapses the prerequisite from "provision storage hardware"
to "is the `zfs` kernel module present" — one `apt install zfsutils-linux` on
Ubuntu, which the installer does automatically (same posture as bundling the
Caddy image and CrowdSec agent: **bundle-and-toggle beats manual setup**). Power
users point the pool at an attached data disk for production-grade speed.
**Manual ZFS = dead feature. Auto-provisioned ZFS + logical fallback = the thing
Coolify can't match.**

## Data model

Activate the dormant `environment` table and add branch lineage to
`database_resource` (`packages/db/src/schema/project.ts`):

- `environment` — one row per env/branch under a project. `kind: production |
  branch`. A `production` env is the default; `branch` envs are created here.
- `database_resource` gains:
  - `branchOf` (FK → source `database_resource`, nullable) — null = a source DB.
  - `environmentId` (FK → environment).
  - `branchEngine: logical | zfs` — which tier produced it.
  - `zfsDataset` (nullable) — the clone's dataset, for teardown.
  - `expiresAt` (nullable) — TTL for auto-GC (see Lifecycle).
  - `refreshPolicy` (jsonb, nullable) — cron + source snapshot selector, reusing
    `backup_schedule` semantics.

A branch is never a free-floating container: it is always
`(environment, database_resource[branchOf=source])`, so the orphan sweep and the
existing resource teardown paths already see it.

## Lifecycle

- **Mark a DB branchable** — on a ZFS host, migrate (or provision) its data dir
  onto `otter/pg/<resourceId>`. On a non-ZFS host this is a no-op; the DB is
  still branchable via the logical tier.
- **Create branch** (`branchDatabase`):
  - *ZFS tier* → `zfs snapshot` + `zfs clone` + provision a container on the
    clone with fresh credentials; write the `environment` + `database_resource`
    rows. Seconds.
  - *Logical tier* → `executeBackup(source)` to a staged dump under
    `backupDir()`, provision a fresh `database_resource`, restore the dump into
    it. Minutes. **Identical UI, identical rows** — only `branchEngine` differs.
- **Refresh from source** ("copy prod verbatim") — reuse the **backup scheduler**
  (`packages/api/src/backups/scheduler.ts`, BullMQ cron). ZFS tier = take a new
  source snapshot and re-clone (or roll the branch to it); logical tier = re-run
  dump→restore. Driven by `refreshPolicy`.
- **Expire / GC** — branches **must** have a TTL or the pool fills and the host
  goes down. A control-plane tick (mirror `startDataFolderSweep`) destroys
  branches past `expiresAt` (ZFS: `zfs destroy` clone + snapshot; logical:
  `destroyDatabase`). Surface remaining pool capacity in the UI.
- **Destroy** — wired into the existing resource teardown (`deleteResourceById`,
  the reconciler delete phase): `destroyDatabase` + `zfs destroy
  otter/pg/<branchId>` + drop the per-branch snapshot. Guarded the same way as
  `removeResourceDir` — only act on a dataset under `otter/pg/` whose leaf
  matches the id.

## Networking

A branch container joins its **project overlay/bridge network** and is reachable
by container name like any other resource (the platform's default model); its
own `internalConnectionString` is generated from the branch credentials. Public
access reuses the existing Caddy layer-4 path. (DBLab's host-port-pool model is
explicitly *not* adopted — it fights our container-name networking.)

## Consistency & safety

- ZFS snapshot of a live PGDATA is crash-consistent; the clone boots via standard
  recovery. `CHECKPOINT;` before snapshot shortens recovery.
- Each branch gets **its own generated credentials** (deterministic from the
  branch id, like the source — `postgres/credentials.ts`), so a leaked branch
  DSN never exposes prod.
- ⚠️ **Encrypt DB passwords first.** `database_resource.password` is plaintext at
  rest today (flagged in `data-viewer.md`); branching multiplies copies of every
  credential — the encryption pass should land before this ships.
- The pool/datasets are secret-bearing; pool file lives under the `0700`
  `DATA_ROOT`.

## Multi-node

A clone shares blocks with its snapshot on **one machine's** pool — it cannot
migrate. That is fine for preview/staging (no HA needed): branchable DBs (and
their branches) are **pinned to a ZFS-capable node** via a placement label and
kept off Swarm's "schedule anywhere." Non-ZFS nodes simply offer the logical
tier. Cross-node CoW is a non-goal.

## Touchpoints

| Where | Change |
|---|---|
| `packages/db/src/schema/project.ts` | activate `environment`; add branch columns to `database_resource` (`branchOf`, `environmentId`, `branchEngine`, `zfsDataset`, `expiresAt`, `refreshPolicy`) |
| `packages/api/src/runtime/types.ts` + `docker-driver.ts` | add `branchDatabase` / `destroyBranch`; ZFS snapshot+clone helpers (shell out to `zfs`/`zpool`) |
| `packages/api/src/backups/engine.ts` | implement **restore** (the missing half); reuse for the logical tier |
| `packages/api/src/backups/scheduler.ts` | drive `refreshPolicy` (reuse cron) |
| new `packages/api/src/branches/` | orchestration: create/refresh/expire/destroy across both tiers; TTL sweep |
| `packages/shared/src/paths.ts` | branch-pool file path under `DATA_ROOT` |
| `scripts/install.sh` | detect/auto-provision the ZFS pool (file-backed fallback); write `BRANCH_ZFS_POOL` to `.env` |
| `apps/web` resources/projects | "Create branch from source" + branch list under `environment`; pool-capacity meter |

## Phases

1. **Logical tier** — implement restore; "clone/branch from source" provisioning
   a fresh `database_resource` from a dump; `environment` rows; destroy wiring.
   Ships on every install, zero host requirements. *(Also unblocks "copy prod
   verbatim.")*
2. **Scheduled refresh** — `refreshPolicy` on the backup scheduler; nightly
   "refresh staging from prod."
3. **ZFS CoW tier** — installer pool provisioning; dataset-per-DB + bind mount;
   `branchDatabase` via snapshot/clone; node pinning. Instant branches where ZFS
   is present, logical fallback elsewhere.
4. **TTL + GC + capacity** — branch expiry sweep; pool-capacity surfacing; the
   safety net that keeps the pool from filling.
5. **Refinements** — `CHECKPOINT`/`pg_backup_start` consistency hook; per-branch
   resource quotas; "diff vs parent" surfacing.

## Deferred / non-goals

- **Neon-grade scale-to-zero, storage/compute separation, branch-from-any-WAL**
  — out of scope; we do snapshot-based branching, not a rewritten storage engine.
- **Physical/continuous-replication retrieval (WAL-G/pgBackRest, PITR)** — the
  logical + snapshot tiers cover the use case; physical mode is a later option.
- **Cross-node CoW clones** — pinned-to-node by nature; not pursued.
- **DBLab Engine as the provisioner** — evaluated; its host-port-pool +
  single-node control-plane model overlaps and partly fights ours. We build the
  ~four `zfs` calls natively into the runtime driver instead (DBLab is
  effectively a reference implementation of exactly that).
- **Branching engines other than Postgres** — Postgres only at first; the
  dataset/CoW mechanism generalizes later.

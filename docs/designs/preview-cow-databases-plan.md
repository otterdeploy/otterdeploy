# Preview CoW databases — build plan

Turns [`preview-cow-databases.md`](./preview-cow-databases.md) into ordered,
checkable work. Target: **a single ZFS-capable node** where every PR gets its own
compute (built) + its own instant copy-on-write Postgres branch, resolving env
against **one shared `Preview` environment**.

**Legend:** ✅ already built · ⛏ to build · ⚠️ prerequisite/blocker.

## Already built (foundation — do not rebuild)

- ✅ `preview` table + `previewId` scoping on resource / deployment / proxy_route / serviceEnvVar.
- ✅ Per-PR compute: `-pr-N` containers built at head SHA (`preview-deploy.ts`, scoping in `lib/environment/`).
- ✅ Preview routes + Caddy reconcile (`preview-routes.ts`); PR status check + sticky comment (`preview-report.ts`, `preview-comment.ts`).
- ✅ Logical `copy` DB tier: `pg_dump | pg_restore` (`preview-db.ts` → `docker-driver-branch.ts` → `backups/copy.ts`), Postgres-only, opt-in per DB.
- ✅ ZFS **pool management** (not branching): sizing/trim/grow/headroom (`system-health/branch-pool.ts` + `host-run.ts` `nsenter` helper).
- ✅ Schema scaffolding: `branchStrategy` enum, `branchedFromResourceId`, `branchSnapshotRef`, `legacyVolumeName`, `previewBranching`.
- ✅ Snapshot-driver seam (`runtime/snapshot/{index,copy,types}.ts`); `DB_BRANCH_STRATEGY` env (currently always resolves to `copy`).

---

## Phase 0 — Prerequisites (land before/with CoW)

- [ ] ⚠️ **Encrypt `databaseResource.password`** (plaintext at rest today; branching multiplies credential copies). Blocks shipping any branch tier widely. See `data-viewer.md`.
- [ ] ⚠️ **Validate the `copy` tier end-to-end** on the live box: enable `previewBranching` on a Postgres, re-trigger a PR, confirm a branch DB is created and its `DATABASE_URL` is rewired. De-risks the orchestration before adding ZFS.

## Phase 1 — Volumes onto ZFS datasets (the CoW prerequisite)

*Nothing to clone until DB bytes live on a dataset under the pool.*

- [ ] ⛏ Provision new managed DB volumes as **bind mounts** at `${DATA_ROOT}/volumes/<projectId>/<resourceId>` (via `volumeDir()`), replacing Docker named volumes in `docker-driver-db.ts` (`Type: "volume"` → `Type: "bind"`) and `swarm/database-internals.ts`.
- [ ] ⛏ **One-time migration** for existing DBs: stop, copy `/var/lib/docker/volumes/<name>/_data` → `volumeDir`, repoint the mount, clear `legacyVolumeName`. Until migrated → resource is `copy`-only (flag it).
- [ ] ⛏ Extend `data-folder-sweep` / teardown guards to cover the new DB volume dirs (same inside-`DATA_ROOT` + `endsWith(id)` guard).

## Phase 2 — ZFS pool provisioning (installer)

- [ ] ⛏ `scripts/install.sh`: detect ZFS (`apt install zfsutils-linux` on Ubuntu); create a file-backed pool — `truncate -s <size> ${DATA_ROOT}/branch-pool.img && zpool create otter <img>`; size = ¼ of free at `$DATA_DIR`, cap 40G, 5G floor, `OTTERDEPLOY_ZFS_SIZE` wins; `zpool set autotrim=on`; mount `otter/pg` at `${DATA_ROOT}/volumes` with `recordsize=16k atime=off logbias=throughput`.
- [ ] ⛏ Write `BRANCH_ZFS_POOL` to `.env`; probe it at boot so `resolveSnapshotDriver()` can pick `zfs`.

## Phase 3 — The ZFS snapshot driver (the core)

- [ ] ⛏ Implement `runtime/snapshot/zfs.ts` `SnapshotDriver`: `probe()` (pool present + host helper works), `branch()` = `CHECKPOINT` → `zfs snapshot otter/pg/<resourceId>@pr<N>` → `zfs clone … otter/pg/<branchId>`, `destroy()` = `zfs destroy` clone + snapshot. Shell out via `host-run.ts`.
- [ ] ⛏ In `resolveSnapshotDriver()`: return the zfs driver when `DB_BRANCH_STRATEGY=zfs|auto` **and** probe passes; else `copy`. Remove the "not implemented, falling back" warning.
- [ ] ⛏ `docker-driver-branch.ts`: replace the `strategy !== "copy"` 501 with the clone path — boot the branch container bind-mounting the clone; **record source creds verbatim** on the branch row (clone ignores `POSTGRES_*`); set `branchSnapshotRef`.
- [ ] ⛏ Schema: relax global unique indexes on `databaseName`/`username`/`internalHostname` (partial-unique by `previewId`, like resource names); default `previewBranching` **on** where the resolved driver is `zfs`. `bun db:push`.
- [ ] ⛏ Keep synchronize **reusing** the existing branch (no re-clone on push).

## Phase 4 — The `Preview` environment (config divergence)

- [ ] ⛏ Seed one `Preview` `environment` row per project (lazily on first preview, or at project create).
- [ ] ⛏ `resolver.ts`: resolve preview deployments against the `Preview` env — order: system › `serviceEnvVar{previewId}` › `projectEnvVar{Preview}` › `serviceEnvVar{Preview}` › defaults. (No inherit-from-prod in v1.)
- [ ] ⛏ `apps/web`: surface the `Preview` env in the variables UI (it already renders in the switcher as a normal env).

## Phase 5 — TTL, GC, capacity (mandatory safety)

- [ ] ⛏ Add `expiresAt` to branch rows; set on create, bump on synchronize.
- [ ] ⛏ Extend `preview-reaper.ts` to destroy branches past `expiresAt` (clone pins its snapshot → forgotten branch = disk leak; full pool → ZFS suspends → all branch DBs hang).
- [ ] ⛏ `apps/web` Server-health: pool fill (zpool alloc/size) + image physical-vs-apparent size; grow suggestion past ~70% with headroom; wire `host.pressure` for suspended/unhealthy pools. (`checkBranchHeadroom` 507 guard already exists.)

## Phase 6 — Refinements (post-v1)

- [ ] ⛏ "Diff vs parent" surfacing per branch; per-branch resource quotas.
- [ ] ⛏ "Refresh from prod" for long-lived branches via the backup scheduler (`refreshPolicy`) — the "copy prod verbatim" tier.
- [ ] ⛏ Optional "inherit unset keys from Production" toggle on the `Preview` env.
- [ ] ⛏ Data masking/anonymization hook before a branch is exposed.
- [ ] ⛏ Generalize the dataset/CoW mechanism to non-Postgres engines.

---

## Critical path (shortest route to instant per-PR DBs)

`P0 validate copy` → `P1 volumes→ZFS` → `P2 pool` → `P3 snapshot driver` →
`P5 TTL/GC`. Phase 4 (Preview env) and the P0 encryption prereq run in parallel;
Phase 6 is post-v1. **Do not ship P3 without P5** — an ungoverned pool takes the
host down.

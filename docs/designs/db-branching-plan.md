# DB branching — build tracker (branch `feat/pg-cow-branching-previews`)

> ⚠️ **Superseded by [`preview-cow-databases-plan.md`](./preview-cow-databases-plan.md)**,
> which reflects the current previews-as-resources model, marks what's already
> built, and makes the volume→ZFS migration prerequisite explicit.

Turns the design in [`db-branching.md`](./db-branching.md) into checkable work.
Research backing: [`neon-cow-branching-research.md`](./neon-cow-branching-research.md).
Goal: **copy-on-write Postgres branching → instant per-PR preview databases.**

Two engines under one button: a universal **logical** tier (`pg_dump`/restore)
and an instant **ZFS CoW** tier. Ship logical first — it works on every install
and unblocks "copy prod verbatim" — then layer CoW on top.

## Prereqs (land before/with shipping)

- [ ] Encrypt `database_resource.password` (plaintext at rest today; branching
      multiplies credential copies — see `data-viewer.md`).

## Phase 1 — Logical tier (every install, zero host requirements)

- [ ] Implement **restore** in `packages/api/src/backups/engine.ts` (the missing
      half of `executeBackup`; needed regardless of branching).
- [ ] Activate the dormant `environment` table; add branch columns to
      `database_resource` (`branchOf`, `environmentId`, `branchEngine`,
      `expiresAt`, `refreshPolicy`, `zfsDataset`) in
      `packages/db/src/schema/project.ts`. → `bun db:push`.
- [ ] New `packages/api/src/branches/` orchestration: `createBranch(source)` =
      `executeBackup(source)` → provision fresh `database_resource` → restore.
- [ ] Destroy wiring into existing resource teardown (`deleteResourceById` /
      reconciler delete phase).
- [ ] oRPC router: `branches.create` / `branches.list` / `branches.destroy`.
- [ ] `apps/web`: "Create branch from source" + branch list under `environment`.

## Phase 2 — Scheduled refresh

- [ ] `refreshPolicy` driven by the backup scheduler
      (`packages/api/src/backups/scheduler.ts`, BullMQ cron) — "refresh staging
      from prod nightly."

## Phase 3 — ZFS CoW tier (instant, where ZFS is present)

- [ ] `scripts/install.sh`: detect / auto-provision pool (file-backed fallback);
      write `BRANCH_ZFS_POOL` to `.env`.
- [ ] `branchDatabase` / `destroyBranch` on the `RuntimeDriver`
      (`runtime/types.ts` + `docker-driver.ts`): `zfs snapshot` + `zfs clone` +
      provision a container bind-mounting the clone, fresh per-branch creds.
- [ ] Dataset-per-DB + node pinning (branchable DBs pinned to a ZFS-capable
      node; non-ZFS nodes fall back to logical).

## Phase 4 — TTL + GC + capacity

- [ ] Branch expiry sweep (mirror `startDataFolderSweep`) — TTL is mandatory or
      the pool fills and the host goes down.
- [ ] Surface remaining pool capacity in the UI.

## Phase 5 — Refinements

- [ ] `CHECKPOINT` / `pg_backup_start` consistency hook before snapshot.
- [ ] Per-branch resource quotas; "diff vs parent" surfacing.

## PR lifecycle (the preview hook)

Branch DB created on PR-open / destroyed on PR-close off the same GitHub events
that already drive preview deploys; injected as `DATABASE_URL` into the preview
env. Wire after Phase 1 so previews get isolated, prod-shaped data.

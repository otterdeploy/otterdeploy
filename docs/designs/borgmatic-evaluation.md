# Borgmatic Evaluation — Should We Drop Our Backup Engine For It?

**Status:** Research / decision doc · **Last verified:** 2026-07-14
**Question asked:** "Deep research into Borgmatic, and see if we can drop most of the code we have for it."

## Verdict (read this first)

**No — don't drop your engine. Adopt *Borg* additively, for the dedup + Storage-Box case only.**

The code you would delete (dump → tar → gzip → checksum → encrypt → prune-math → upload) is the
**cheap, already-built, already-tested** part — ~8 mechanics files. The code you must **keep**
(oRPC contract, org multi-tenancy, the four DB tables, the UI + CLI typed off the contract, the
schedule scanner, encrypted-secret storage, log capture, platform-event notifications, source
resolution) is the **majority of the surface and 100% of the otterdeploy-specific value** — and it
would need a **migration**, not just a keep, because Borg's repository model breaks your
per-run-object data model. On top of that you'd eat **two hard regressions** (Borg can't write to
S3; Borg has no max-storage cap to replace `maxStorageGb`) and take on a **single-maintainer Python
CLI used in a multi-tenant shape its own author says isn't supported**.

So "drop most of the code" is **negative work**. But Borg's dedup + append-only immutability are a
**real win** for volume backups and large/frequent DB backups to a Hetzner Storage Box — capture
that by adding a **`borg` destination** alongside `local`/`s3`/`sftp`, not by ripping anything out.

---

## Part 1 — What Borgmatic actually is (deep)

- **A config-driven wrapper around BorgBackup.** It does not reimplement backup; every action shells
  out to the `borg` binary from a YAML config, with a raw `borgmatic borg …` passthrough. Python,
  GPLv3, on PyPI. Current stable **2.1.6 (2026-06-01)**, ~monthly releases. ([overview](https://torsion.org/borgmatic/), [PyPI](https://pypi.org/project/borgmatic/))
- **Borg version support: 1.2 / 1.4 / 2.0**, auto-detected. **This is Hetzner-compatible** — Storage
  Boxes only run server-side Borg 1.1/1.2/1.4, and current borgmatic drives a Borg 1.4 client fine;
  it does **not** force Borg 2.0 (which the Storage Box couldn't serve). ([upgrade](https://torsion.org/borgmatic/how-to/upgrade/))
- **No daemon / no scheduler of its own** — you drive it from cron, systemd, or (for us) BullMQ. It
  ships sample systemd/cron units you'd ignore. ([set-up-backups](https://torsion.org/borgmatic/how-to/set-up-backups/))
- **CLI-only — no stable public Python API.** The internal modules are importable but are a
  contributor surface, not an API contract (the explicit "no public API, parse our JSON" guarantee
  is *Borg's*, inherited). Integration path = spawn the CLI and parse output. ([borg frontends](https://github.com/borgbackup/borg/blob/master/docs/internals/frontends.rst))
- **Good machine output for a live UI:** `--json` (final result on **stdout**: archive id,
  original/compressed/**deduplicated** size, nfiles) on `create`/`list`/`info`/`repo-list`; plus
  `--log-json` (borgmatic 2.1.0+) streaming one JSON object per line on **stderr** —
  `archive_progress`, `progress_percent`, `log_message`. This maps cleanly onto a streaming log
  panel. Exit codes: 0 ok / non-zero error, remappable via `borg_exit_codes`, `75` = soft-fail from
  a hook. ([monitor](https://torsion.org/borgmatic/how-to/monitor-your-backups/), [logging](https://torsion.org/borgmatic/reference/command-line/logging/))
- **Config schema (2.x is flat):** all keys top-level (the old `location:/storage:/hooks:` sections
  were deprecated in 1.8.0, **removed in 2.0.0**). `repositories:` is a list of `{path, label}` and
  accepts `ssh://…:23/./repo` remotes (a Storage Box). One YAML **per tenant**; a single invocation
  runs each config **in turn** with **no merging**. `!include` / `<<: !include` for shared fragments.
  ([config ref](https://torsion.org/borgmatic/reference/configuration/), [per-application](https://torsion.org/borgmatic/how-to/make-per-application-backups/))

### Database hooks — the container story (borgmatic's strongest fit)

- Built-in hooks for **postgresql / mysql / mariadb / mongodb / sqlite**. **No Redis hook** (you'd
  script `redis-cli`/`BGSAVE` via a command hook — exactly like your engine, which already tells
  redis "use a volume backup"). ([data-sources](https://torsion.org/borgmatic/reference/configuration/data-sources/))
- **Streams each dump into the archive via a named pipe (FIFO)** — never staged to disk (except the
  Postgres/Mongo `directory` format). This is the streaming property your current buffer-everything
  pipeline lacks. ([backup-databases](https://torsion.org/borgmatic/how-to/backup-your-databases/))
- **Containerized DBs are officially supported three ways** — and one of them is *literally what you
  do today*:
  - `container: <name>` (borgmatic 2.0.8+) — borgmatic resolves the container IP via the docker CLI.
  - `pg_dump_command: docker exec <container> pg_dump` (+ `pg_restore_command`, `psql_command`) —
    **this is your `exec.ts` model, in config form.** MariaDB needs `password_transport: environment`
    when the client runs in a separate container.
  - `pg_dump_command: docker run --rm postgres:17-alpine pg_dump` — ephemeral, version-matched client.
- **Footguns:** client tool version must ≥ server version (the classic `pg_dump` "server version
  mismatch" — your per-container exec already dodges this by using the container's own binaries); a
  single dump failure **aborts the whole borgmatic run** (bad for fan-out — favors per-tenant
  configs); stale FIFOs can hang the next run; restore **doesn't create the target DB**.

### Retention / checks / encryption / monitoring / security

- **Retention** = `keep_secondly…keep_yearly` + `keep_within` → `borg prune`. Default action order is
  **create → prune → compact → check** (borgmatic runs `compact`, which is required because *prune
  doesn't free space*). **No max-total-size retention** exists in borg or borgmatic — `storage_quota`
  only *refuses new writes*, it doesn't evict. **Your `maxStorageGb` has no native equivalent.**
- **Integrity checks:** `repository` / `archives` / `data` / `extract` / `spot` (spot = sample source
  vs archive, catches silent corruption; v1.8.10+), each with its own `frequency:`.
- **Encryption** = Borg client-side. Borg 1.x = AES-256-CTR + HMAC-SHA256 (authenticated;
  functionally equivalent to your AES-256-GCM); Borg 2.x adds true AEAD. Per-repo passphrase, and
  `encryption_passcommand` can pull from a secret store — fine for per-tenant keys.
- **Monitoring/hooks:** healthchecks / ntfy / pagerduty / sentry / loki / **apprise** (→
  Slack/Telegram/Discord/email) + the unified `commands:` hooks (v2.0.0). An `error`/`states: [fail]`
  hook can `curl` your notify endpoint — i.e. it can bridge into your platform-event matrix.
- **Append-only immutability** is a **Borg** feature (server-side SSH forced command
  `command="borg serve --append-only"`), relevant for a Storage Box — a leaked client key can't
  delete existing archives. **Caveat:** your own `prune` over a non-append-only channel defeats it,
  so the pruning identity must be separated from the backup client.

### Multi-tenant fitness — the real blockers

- ✅ Per-repo isolation is clean: one config + one repo + one passphrase per tenant; Borg locks
  **per-repo**, so separate repos never contend; per-repo cache is keyed by repo id automatically.
- ⚠️ **Borgmatic does not support running multiple instances concurrently on one host** — its data
  hooks rely on **shared global runtime files**. One invocation processes tenants **sequentially**;
  you cannot naively fan out N `borgmatic` processes. The plausible workaround (one borgmatic
  **container per tenant-run**, isolated runtime dir/repo/cache) is an **inference from the stated
  root cause, not an officially blessed mode**. ([per-application](https://github.com/borgmatic-collective/borgmatic/blob/main/docs/how-to/make-per-application-backups.md))
- ⚠️ **Bus factor:** despite the "collective" name it's effectively **one maintainer** (Dan Helfman),
  governance on a self-hosted Gitea. **No known PaaS uses borgmatic as its multi-tenant backup
  engine** — BorgBase is storage-*hosting*, not orchestration. You'd be pioneering the shape.

---

## Part 2 — Your current engine (the reality, which corrects `backups.md`)

`backups.md` says "zero backend exists / UI fully mocked." **That is stale — the engine is fully
built and wired.** Ground truth from the code:

- **Execution:** runs **in-process on the control-plane host** (a `setInterval` scanner +
  `void executeBackup(id)` fired detached from the oRPC handler). **Not BullMQ, not a builder worker,
  not Redis pub/sub** — the schema comments describing those are aspirational. Dumps run by
  **`docker exec` into the DB's own container** (resolved by `otterdeploy.resource.id` label,
  `exec.ts`), volumes by an `alpine` helper with the volume mounted read-only. Everything is buffered
  into an **in-memory `Buffer`**.
- **Destinations:** `local` / `s3` / `sftp`, **one opaque encrypted object per run** (`storage.ts`).
  S3 is a hand-rolled SigV4 single-PUT (no SDK).
- **Retention:** hand-rolled GFS (`retention.ts`) — keep-daily/weekly/monthly/yearly **+
  `retentionDays` age cutoff + `maxStorageGb` ceiling**; prunes per (schedule × destination) and
  deletes **both the object and the DB row**. It is explicitly "modelled on restic/borg forget" — i.e.
  a faithful reimplementation of `borg prune` **plus** a size axis borg lacks.
- **Restore:** `download` + `in-place` (postgres-only in-place; typed-name confirm enforced
  server-side; volume in-use guard). `verifyBackup` re-fetches the standalone object and re-checksums.
- **Fully coupled surface that stays no matter what:** `routers/backups/` oRPC contract + RBAC +
  org-scoping; the four tables; the web UI (TanStack DB collections typed off the contract) + the CLI;
  the schedule scanner; `encryptSecret` cred storage; `backup_log` + `backups.logs`;
  `backup.succeeded`/`failed` events; `partitionSources` orphan detection. `copy.ts` (PR-preview DB
  branching) rides the **same** `exec.ts` transport, so transport changes hit it too.

---

## Part 3 — Build-vs-adopt analysis

### What Borgmatic/Borg *could* replace (the mechanics — the easy part)
`dumpCommand` argv · `execDump` collect · `volume.ts` tar · `gzipSync` · `sha256` · `encryptBytes`
· `retention.ts` GFS math · `storage.ts` put/get/remove · `restore.ts` mechanics. ≈ 8 files of
**already-written, already-tested** code.

### What must stay (the glue — the valuable part, ~two-thirds of the surface)
oRPC contract, RBAC, org-scoping, the four tables, UI, CLI, the schedule scanner, secret storage,
log capture, notifications, source resolution. **All retained — and some must be migrated.**

### The frictions that make even the mechanics-swap a bad trade

1. **Data-model break (per-run object → repository).** `backup` = one row = one self-contained
   object with its own `checksum`, `compressedSizeBytes`, `storagePath`. Borg = **one repo, many
   deduped archives**; there's no per-archive object, per-archive checksum (`verifyBackup` has
   nothing to re-fetch — you'd use `borg check`), and `usedBytes = sum(compressedSizeBytes)` becomes
   meaningless under dedup. The table becomes "pointer to a borg archive name," and the contract + UI
   + CLI shapes typed off it must migrate. **The migration touches exactly the glue you wanted to keep.**

2. **S3 regression (the sharpest).** Your flagship destination writes one S3 object via SigV4.
   **Borg cannot use an S3 bucket as a repo** (1.x) — it needs SSH/`borg serve` or a POSIX path. So
   adopting Borg means *dropping S3* or bolting on rclone-mount/sync of the whole repo. That's a
   product regression, not a simplification.

3. **`maxStorageGb` regression.** No borg equivalent; you'd keep hand-rolling it anyway — so you
   don't even fully delete `retention.ts`.

4. **Concurrency + runtime dependency.** Borgmatic can't run concurrently on one host; your model is
   a clean in-process `docker exec`. Adopting it adds a Python+borg image and (for parallelism) a
   container-per-run pattern its author doesn't officially support.

5. **Strategic risk.** Betting the never-lose-data path on a single-maintainer tool in an
   unsupported multi-tenant shape, when you already have a working engine.

**Net:** you'd delete ~200 lines of easy mechanics and take on a data-model migration, an S3
regression, a retained `maxStorageGb`, a Python runtime, and a bus-factor risk. Negative ROI.

---

## Part 4 — The recommendation: add a `borg` destination, don't replace

Borg's genuine wins are **dedup** (your model re-uploads a full compressed archive every run — a
20 GB volume daily = ~600 GB/mo; Borg stores first-full + tiny deltas) and **append-only
immutability** on a Storage Box. Capture both **additively**:

- **Add a 4th backend to `storage.ts`'s dispatch: `borg`** (or a per-destination `strategy` flag).
  For `local`/`s3`/`sftp` nothing changes. For a `borg` destination (target = an SSH/`borg serve`
  repo, e.g. a **Hetzner Storage Box on port 23**), the engine path changes from
  "dump → buffer → gzip → encrypt → put one object" to "**`borg create` streams the dump into the
  repo**" (deduped, borg-encrypted, optionally append-only).
- **Retention for `borg` destinations delegates to `borg prune` + `borg compact`**; keep your
  hand-rolled GFS + `maxStorageGb` for the object destinations. (`maxStorageGb` on a borg repo would
  stay custom — `du`/`borg info` + delete-oldest.)
- **The `backup` row for a borg run stores `{repo, archiveName}`** instead of a `storagePath` +
  standalone checksum; `verify` → `borg check`; `download` → `borg extract`. This is a *contained*
  contract extension, not a rip-out.

### borgmatic-the-tool vs. raw `borg` for that destination
You already own the scheduler, queue, secrets, streaming UI, and org model — **half of borgmatic's
value**. Given the concurrency limit, the Python dependency, and the bus factor, calling **`borg`
directly from your TypeScript** (borrowing borgmatic's config vocabulary + its `--json`/`--log-json`
conventions) is likely the cleaner fit. The one genuinely fiddly bit borgmatic gives you for free is
**streaming a `docker exec` dump into `borg create` via a FIFO** — worth studying its recipe (and
you could even shell out to borgmatic *just for the create step* on borg destinations while keeping
raw `borg list/info/extract` for the rest). Decide that when you build it; it's not load-bearing for
the verdict.

### Sequencing
1. Ship **Storage Box as an `sftp` destination** first (works today, zero engine change — see
   [`hetzner-backups.md`](./hetzner-backups.md)).
2. Fix the **in-memory buffering** in `engine.ts`/`storage.ts` (stream the dump) — valuable
   regardless of borg, and a prerequisite for large data over a remote box.
3. Add the **`borg` destination** for dedup + append-only, targeting Storage Boxes on port 23.
4. Update `backups.md` — it's stale (the engine exists).

---

## Sources
Borgmatic: [overview](https://torsion.org/borgmatic/) · [config](https://torsion.org/borgmatic/reference/configuration/) ·
[databases](https://torsion.org/borgmatic/how-to/backup-your-databases/) · [checks](https://torsion.org/borgmatic/reference/configuration/consistency-checks/) ·
[command hooks](https://torsion.org/borgmatic/reference/configuration/command-hooks/) · [monitor/json](https://torsion.org/borgmatic/how-to/monitor-your-backups/) ·
[per-application (concurrency)](https://github.com/borgmatic-collective/borgmatic/blob/main/docs/how-to/make-per-application-backups.md) ·
[upgrade (borg versions)](https://torsion.org/borgmatic/how-to/upgrade/) · [NEWS](https://raw.githubusercontent.com/borgmatic-collective/borgmatic/main/NEWS) ·
[docker image](https://github.com/borgmatic-collective/docker-borgmatic)
Borg: [prune (no size cap)](https://borgbackup.readthedocs.io/en/stable/usage/prune.html) ·
[init/encryption](https://borgbackup.readthedocs.io/en/stable/usage/init.html) ·
[append-only notes](https://borgbackup.readthedocs.io/en/stable/usage/notes.html) ·
[frontends/JSON](https://github.com/borgbackup/borg/blob/master/docs/internals/frontends.rst) ·
[hosting/storage-quota](https://borgbackup.readthedocs.io/en/stable/deployment/hosting-repositories.html)
otterdeploy code: `packages/api/src/backups/*`, `packages/api/src/routers/backups/*`,
`packages/db/src/schema/backup.ts`, `apps/web/src/features/backups/*`, `apps/server/src/background-services.ts`

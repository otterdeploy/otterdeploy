# Rustic Backup Engine — Port Analysis

_Source: `github.com/rustic-rs/rustic_core` (Apache-2.0 / MIT dual, library that powers the `rustic` CLI). Compared against restic (Go), BorgBackup, and otterdeploy's current backup subsystem (`packages/api/src/backups/**`). Analysis date: 2026-07-18._

**The plan:** **one engine only — rustic, the Rust version (not restic-Go). Shell out to the `rustic` CLI binary — no napi/embedding, no second tool, no hybrid.** Ship + version-pin the `rustic` binary and drive it from a thin TS wrapper. rustic covers `backup`/`restore`/`forget`/`prune`/`check` out of the box. Its one gap — repo `recover` / `repair packs` — is **deferred** (rare disaster ops; `check` + `repair index`/`repair snapshots` still ship), to be added later by extending rustic itself if/when needed. The `otterdeploy/rustic_core` fork (pinned at `82f32a4` / 0.12.0) **parks** for that eventual work; it isn't needed for CLI v1.

---

## Why an engine at all — where the current subsystem stands

otterdeploy's backups today are the **Coolify tier**: native in-container dumps (`pg_dump --format=custom`, `mysqldump`, `mongodump`) or an `alpine:3.20` volume-tar, `gzipSync`, optional `aes-256-gcm`, then **one full independent archive per run**, buffered entirely in memory, uploaded to local / S3 (hand-rolled single-PUT SigV4) / SFTP. GFS retention, a 60s `setInterval` scheduler, postgres-only in-place restore, and a sha256-of-blob `verify`.
_Files: `packages/api/src/backups/{engine,engine-helpers,storage,exec,volume,restore,scheduler}.ts`._

Two limitations the code itself flags: **the whole archive is held in RAM** (noted as needing streaming), and **every run writes a full copy** (a 5 GB DB backed up daily = 5 GB × N days in the bucket). A real dedup/incremental engine fixes both. The only such engine that is *embeddable as a library* is rustic — restic-Go and Borg are CLI-only.

---

## Engine contrast

| Axis | otterdeploy **now** | **rustic** (`rustic_core`, embed) | restic (Go) | BorgBackup |
|---|---|---|---|---|
| Embeddable library | homegrown TS | ✅ **`rustic_core` crate** | ❌ CLI only | ❌ CLI only |
| Dedup / incremental | ❌ full copy per run | ✅ | ✅ | ✅ (best ratio) |
| Compression | gzip | ✅ zstd, configured once in-repo | zstd (per-call) | ✅ zstd/lzma |
| Encryption | aes-256-gcm (`BETTER_AUTH_SECRET`) | ✅ repo-key, encrypts metadata too | ✅ | ✅ |
| Streaming source (no full buffer) | ❌ whole archive in RAM | ✅ `StdinSource` / `ChildStdoutSource` / `ReadSource` | ✅ `--stdin` | ✅ |
| Backends | local, S3 (custom PUT), SFTP | ✅ local, S3/R2/SFTP/WebDAV/+ via OpenDAL | S3/B2/SFTP/REST | ❌ **no native S3** (needs rclone) |
| **Concurrency** | serial-ish per tick | ✅ **lock-free, two-phase prune** | ❌ repo locks | ❌ exclusive lock |
| Cold storage (Glacier) + warm-up | ❌ | ✅ **unique across all tools** | ❌ | ❌ |
| Snapshot metadata (labels, delete-protect) | resourceId in path only | ✅ | limited | limited |
| Integrity check | sha256 of stored blob | ✅ `check` (structural) | ✅ | ✅ |
| Repo `recover` / `repair packs` | n/a | ⚠️ **missing → we port it** | ✅ | ✅ |
| Maturity | ours, in prod | ⚠️ **beta, API unstable** | ✅ mature | ✅ mature |
| Runtime shape | in-process (TS) | in-process (native `.node`) | subprocess | subprocess (Python) |

Benchmark context (3-way, 10.4 GB → 7.6 GB repo): rustic and restic finish an initial backup in ~1:48; **Borg takes ~5:20** and its 2.0 beta re-backup ran ~10× slower than expected. rustic uses **less CPU than restic** at parity speed. Repo format is **identical to restic's** — the same repository is readable by both tools, which is the safety net that makes a beta acceptable.

**Why Borg is out:** no native S3 (dealbreaker for a bring-your-own-bucket product), Python runtime, and **exclusive repo locking** — fatal for a multi-tenant scheduler that fans out concurrent runs. rustic's lock-free design is the opposite, and exactly what our 60s tick needs.

---

## The maturity risk, and why it's contained

`rustic_core` is **beta**: its README states the API will break between releases, test coverage is thin, and the maintainers do not yet call it production-ready (rustic #110). This is the real risk — not performance.

It is contained by two things:

1. **We own the recovery path inside rustic.** rustic lacks `recover` and `repair packs` (see parity list below); we **port them into our fork**, modelled on the `commands/repair/{index,snapshots,hotcold}.rs` code already in the tree (with restic's implementations as a spec reference only — not a runtime dependency). Recovery is rustic-native: no restic-Go, no second tool, no mixing.
2. **Hard version pin + thin fork.** We pin `rustic_core` to `82f32a4` (0.12.0) and keep the diff minimal — the two ported commands plus binding shims — so rebasing onto upstream stays cheap.

(The repo format is restic-compatible, so data is never locked to a single tool — but that's a bonus property, and nothing in the architecture depends on it.)

---

## rustic vs restic — the parity delta that matters to us

_(rustic compares itself against restic 0.19.0 at rustic 0.11.3.)_

**rustic has, that restic does not — and that we'd actually use:**
- **Lock-free operations / two-phase prune** — concurrent backups and prune-parallel-to-backup. Directly serves our fan-out scheduler.
- **Cold-storage classes (S3 Glacier / OVH Cold Archive) with automatic warm-up** — a net-new product tier no competitor (Coolify, Dokploy, openship) offers.
- **Remote / streamed sources** (`StdinSource`, `ChildStdoutSource`, generic `ReadSource`, OpenDAL source) — the seam for piping our in-container dumps without buffering.
- **In-repo config + hooks + config profiles**, compression set once, custom chunker, pack sizes to 4 GB.
- **Extended snapshot metadata** — labels, descriptions, **delete-protection** — maps onto our per-tenant / per-resource tagging.
- **`rustic_core` as a library** — the entire reason this port is possible.
- **Backend breadth via OpenDAL** — superset of our local/S3/SFTP, adds R2/WebDAV/etc. for free.

**restic has, that rustic lacks:**
- **`recover`** — not implemented → **we port this.**
- **`repair packs`** — missing → **we port this.**
- `cache` command (omitted — not relevant to embedded use).
- Restore flags `--verify`, `--sparse`, if-newer/never `--overwrite` variants (nice-to-have; can follow).
- `--files-from*`, TLS client-cert flags, `--repository-file` (irrelevant to our embedded/OpenDAL path).

So the parity gap that touches **data safety** is exactly two commands. Everything else rustic either matches, exceeds, or renders moot.

---

## Ground we cover — mapped to `packages/api/src/backups/`

| Today | After the port |
|---|---|
| `engine.ts` buffers the whole archive in RAM | rustic streams the source (`ReadSource`) — RAM limitation gone |
| Full copy per run (5 GB × N in the bucket) | Dedup + incremental-forever — storage cost collapses |
| gzip | zstd + dedup, configurable compression |
| `storage.ts` hand-rolled single-PUT SigV4 + SFTP | OpenDAL backends (S3/R2/MinIO/SFTP/WebDAV) |
| `applyRetention` deletes archives | Lock-free `forget`/`prune`; our GFS `keepDaily/Weekly/Monthly/Yearly` maps 1:1 onto rustic `KeepOptions` |
| `verifyBackup` = sha256 of one blob | `check` — structural repo + pack integrity |
| — | **New surfaces:** cross-run dedup per tenant, a **cold-storage retention tier**, snapshot **delete-protection** |

**Ground the port does NOT cover (orthogonal — do not expect the engine to fix these):**
- **DB logical restore breadth** — `restore.ts` implements in-place restore for **postgres only**; `mariadb`/`mongodb` are "not implemented." rustic hands back the dump *file*; you still need `pg_restore`/`mysql`/`mongorestore` around it. Engine-independent.
- **The orphaned-schedule `sources` FK gap** (`backup_schedule.sources` is FK-less jsonb) — schema-level, unaffected by the engine.

---

## CLI integration (shell out to the `rustic` binary)

- **Ship the binary.** Vendor + version-pin + checksum the `rustic` binary per target (`linux-x64-gnu`; `-musl` if alpine-hosted; `arm64` if ARM); manage its exec path. No Rust build of our own for v1.
- **Thin TS wrapper** (`RusticCli`) replacing the internals of `engine.ts` / `storage.ts`: spawn `rustic <cmd>`, pass the repo password + backend creds via **env, never argv**, map exit codes → typed errors, parse `--json` output where available.
- **Dump→engine seam.** Pipe the in-container dump straight into `rustic backup --stdin --stdin-filename <name>` via child-process stdin — no temp file, no in-RAM buffer (fixes the current whole-archive-in-memory limit). Volume tar streams the same way. The in-container dump step in TS stays unchanged.
- **Backends.** rustic's OpenDAL/local backends cover local, S3/R2/MinIO, SFTP, WebDAV — configured via env/flags. Replaces the hand-rolled SigV4 PUT and most of `storage.ts`.
- **Retention.** `rustic forget --keep-daily/--keep-weekly/--keep-monthly/--keep-yearly --prune` maps 1:1 onto the existing GFS fields; lock-free prune suits the 60s fan-out scheduler.
- **Encryption / keys.** rustic encrypts each repo under a repo password (AES-256, scrypt-derived, metadata included). Pinned model: **one repo per (resource × destination)**, password **derived via HKDF-SHA256(`BETTER_AUTH_SECRET`, repoId)** — no new secret store, re-derivable. Supplied to rustic via `RUSTIC_PASSWORD` (or password-file/fd). Replaces the bespoke `aes-256-gcm`-off-`BETTER_AUTH_SECRET` layer.
- **Progress.** Parse `rustic`'s progress/stderr output (the one UX downside vs an in-process callback) and surface coarse phase/percent to the UI.
- **Integrity.** `rustic check` replaces the sha256-of-blob `verify`.

Command surface used: `init` / `backup` (`--stdin`) / `restore` / `dump` / `snapshots` (`--json`) / `forget` / `prune` / `check`. Not in stock rustic: `recover`, `repair packs` (deferred — see plan).

---

## Recommended sequencing

1. **Prove the seam (spike):** ship a pinned `rustic` binary, write a minimal `RusticCli.backup()/snapshots()`, pipe a `pg_dump` into `rustic backup --stdin` to a local repo, then `restore`/`dump` it back — confirm the round-trip end-to-end.
2. **Wire the hot path:** replace `engine.ts` + `storage.ts` internals with `RusticCli` — `backup` (`--stdin`) for pg/maria/mongo dumps and volume tar, `restore`/`dump`, `forget`/`prune` (GFS → keep flags), `check`. Keep the in-container dump step in TS unchanged; keep the scheduler as-is.
3. **New surface:** cold-storage retention tier + snapshot delete-protection (both unique vs. every competitor).
4. **Later / optional:** `recover` + `repair packs` by extending rustic itself (only if repo-corruption recovery is needed); maria/mongo in-place restore; the `backup_schedule.sources` FK fix. None are engine-v1 concerns.

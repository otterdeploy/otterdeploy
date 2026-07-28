# Borg vs restic vs rustic — Full Feature Matrix

**Status:** Reference · **Last verified:** 2026-07-14 · **Companion to:** [`backup-engine-comparison.md`](./backup-engine-comparison.md)

Side-by-side of the three **backup engines**. (Borgmatic is a *wrapper over Borg*, not a peer — where
it adds capability Borg lacks natively, it's noted as "via borgmatic".)

**Legend:** ✅ yes / native · ⚠️ partial / with caveats / via add-on · ❌ no

---

## Project & meta

| Feature | Borg | restic | rustic |
|---|---|---|---|
| Language | Python + C (Cython) | Go | Rust |
| License | BSD-3-Clause | BSD-2-Clause | Apache-2.0 OR MIT |
| First released | 2015 (fork of Attic, 2010) | 2015 | CLI 2022 · `rustic_core` 2023 |
| Version (Jul 2026) | 1.4.x stable · 2.0 (new format) | 0.19.x | CLI 0.11.3 · core 0.12.0 |
| Maturity | Production, decade-hardened | Production, battle-tested | **Pre-1.0, "early development"** |
| Contributors / bus factor | Team (multiple maintainers) | fd0 + ~300 contributors | **~1 engine author** |
| Distro packaging (Debian/Fedora) | ✅ | ✅ | ❌ (AUR/Nix/Homebrew/etc.) |
| Embeddable **library** | ❌ (CLI, "no public API") | ❌ (Go internals, unstable) | ✅ **`rustic_core`** (unstable API) |
| Stable public API | ❌ | ❌ | ⚠️ library exists but breaks ~every minor |
| Single static binary | ⚠️ (Python runtime) | ✅ | ✅ |

## Repository & format

| Feature | Borg | restic | rustic |
|---|---|---|---|
| Repository format | Own | Own | **restic-compatible** (r/w) |
| Cross-tool interop | ❌ Borg only | ✅ with rustic | ✅ with restic (both directions) |
| Deduplication (content-defined chunking) | ✅ buzhash | ✅ Rabin (~0.5–8 MiB, ~1 MiB avg) | ✅ Rabin (restic-compat) |
| Configurable chunker (min/max/avg, fixed) | ⚠️ tunable | ❌ | ✅ |
| Global / cross-snapshot dedup | ✅ | ✅ | ✅ |
| Incremental (only changed data) | ✅ | ✅ | ✅ |
| Compression | ✅ lz4/zstd/zlib/lzma (default on) | ✅ zstd (repo v2, since 0.14) | ✅ zstd (repo v2, rustic ≥0.2) |
| Compression setting stored in repo | ⚠️ per-run flag | ❌ (`--compression` every run) | ✅ in-repo config |
| Repo format versions | 1.x vs 2.x (migrate via `transfer`) | v1 / v2 | v1 / v2 |

## Cryptography

| Feature | Borg | restic | rustic |
|---|---|---|---|
| Encryption | ⚠️ optional (modes incl. `none`) | ✅ **always on** | ✅ **always on** |
| Cipher | AES-256-CTR + HMAC-SHA256 (2.x adds AEAD) | AES-256-CTR + Poly1305-AES | AES-256-CTR + Poly1305-AES |
| Client-side (zero-knowledge) | ✅ | ✅ | ✅ |
| Authenticated (tamper detection) | ✅ | ✅ | ✅ |
| Key derivation | PBKDF2-HMAC-SHA256 (argon2id in 1.2+) | scrypt | scrypt |
| Multiple passwords / keys per repo | ⚠️ (export/import key) | ✅ | ✅ |
| Passphrase via command / secret store | ✅ (`BORG_PASSCOMMAND`) | ✅ (env / command) | ✅ (config / env / command) |

## Backends / destinations

| Feature | Borg | restic | rustic |
|---|---|---|---|
| Local filesystem | ✅ | ✅ | ✅ |
| SSH remote | ✅ (`borg serve`) | ✅ (SFTP) | ✅ (opendal sftp) |
| Plain SFTP server (no tool installed remote) | ❌ (needs `borg` remote) | ✅ | ✅ |
| **S3 / object storage** | ❌ (rclone-mount only) | ✅ native (S3/B2/Azure/GCS/Swift) | ✅ via **OpenDAL** (S3 + many) |
| REST server | ❌ | ✅ (rest-server) | ✅ (rest) |
| rclone | ⚠️ (mount) | ✅ | ✅ |
| WebDAV / cloud drives | ❌ | ⚠️ (rclone) | ✅ (opendal) |
| **Hetzner Storage Box** | ✅ native (port 23) | ✅ (SFTP) | ✅ (sftp/opendal) |
| Cold storage tiers (Glacier hot/cold + warm-up) | ❌ | ❌ built-in | ✅ |

## Backup sources

| Feature | Borg | restic | rustic |
|---|---|---|---|
| Filesystem paths | ✅ | ✅ | ✅ |
| stdin / stream a command's output | ✅ (`--content-from-command`) | ✅ (`--stdin-from-command`) | ✅ (`StdinSource`/`ChildStdoutSource`) |
| Native DB dump hooks (pg/mysql/mongo…) | ❌ (✅ via borgmatic) | ❌ | ❌ (generic hooks only) |
| LVM/ZFS/Btrfs snapshot integration | ❌ (✅ via borgmatic) | ❌ | ❌ |
| Exclude patterns / rules | ✅ | ✅ | ✅ |
| xattrs / ACLs / extended metadata | ✅ (strong) | ✅ | ✅ |
| Bootable whole-disk image | ❌ | ❌ | ❌ |

## Operations & commands

| Feature | Borg | restic | rustic |
|---|---|---|---|
| Backup / create | ✅ | ✅ | ✅ |
| Restore / extract | ✅ | ✅ | ✅ |
| List snapshots/archives | ✅ | ✅ | ✅ |
| Prune (retention) | ✅ `prune` | ✅ `forget`/`prune` | ✅ `forget`/`prune` |
| Separate compact step to free space | ⚠️ **yes, `compact` required** | ✅ prune repacks (1 step) | ✅ prune repacks (two-phase) |
| Integrity check (structural) | ✅ | ✅ | ✅ |
| Deep verify (re-read all data) | ✅ `--verify-data` | ✅ `--read-data` | ✅ `check` |
| Probabilistic / subset verify | ⚠️ partial | ✅ `--read-data-subset` | ⚠️ (unconfirmed sub-flags) |
| Source-vs-archive spot check | ❌ (✅ via borgmatic) | ❌ | ❌ |
| FUSE mount | ✅ | ✅ | ⚠️ Unix only (no Windows) |
| Diff snapshots | ✅ | ✅ | ✅ |
| Copy between repos | ❌ (`transfer`/`export-tar`) | ✅ `copy` | ✅ `copy` |
| Repair / rebuild index | ✅ (`check --repair`) | ✅ (`repair`, `rebuild-index`) | ⚠️ `repair-index`/`repair-snapshots` |
| Dedicated `recover` command | ⚠️ via check-repair | ✅ `recover` | ❌ **none** |
| Rewrite / recreate archives | ✅ `recreate` | ✅ `rewrite` | ✅ |
| Tags on snapshots | ❌ (archive names only) | ✅ | ✅ |
| `--sparse` / `--verify` on restore | ⚠️ | ✅ | ❌ (gap vs restic) |
| Machine-readable JSON output | ✅ `--json` | ✅ `--json` | ✅ `--json` + structured lib returns |
| Progress reporting | ✅ | ✅ | ✅ (`RusticProgress` trait) |

## Retention policy

| Feature | Borg | restic | rustic |
|---|---|---|---|
| keep last / hourly / daily / weekly / monthly / yearly | ✅ | ✅ | ✅ |
| keep-within (duration) | ✅ | ✅ | ✅ |
| keep-tag | ❌ (no tags) | ✅ | ✅ |
| Quarterly (13weekly / 3monthly) | ⚠️ via borgmatic | ❌ | ❌ |
| **Absolute storage-size cap (keep repo < N GB)** | ❌ | ❌ | ❌ |

## Concurrency & locking

| Feature | Borg | restic | rustic |
|---|---|---|---|
| Locking model | Exclusive per-repo | Lock files (non-excl. for backup) | **Lock-free** |
| Concurrent backups to one repo | ❌ | ✅ | ✅ |
| Prune concurrent with backup | ❌ | ❌ (prune needs exclusive lock) | ✅ |
| Multiple tool instances on one host | ✅ (per-repo lock serializes) | ✅ | ✅ |

## Immutability & security

| Feature | Borg | restic | rustic |
|---|---|---|---|
| Append-only mode | ✅ (SSH forced cmd / repo flag) | ✅ (rest-server / rclone `--append-only`) | ✅ **default** + config |
| **S3 Object Lock / true WORM** | ❌ (compaction rewrites files) | ⚠️ possible (lock files complicate) | ✅ **cleanest** (lock-free) |
| Protects against compromised client | ✅ | ✅ | ✅ |
| Protects against root on backup server | ⚠️ (only WORM does) | ⚠️ (only WORM does) | ✅ (via WORM) |

## Automation & integration

| Feature | Borg | restic | rustic |
|---|---|---|---|
| Built-in scheduler/daemon | ❌ (cron/systemd) | ❌ (cron/systemd) | ❌ (cron; `rustic_scheduler` crate) |
| Native config file | ❌ (env + flags) | ❌ (env + flags) | ✅ **TOML profiles** |
| Monitoring integrations (healthchecks/ntfy/…) | ⚠️ via borgmatic | ⚠️ via resticprofile | ✅ hooks |
| Command/lifecycle hooks | ⚠️ via borgmatic | ⚠️ via wrapper | ✅ |
| Wrapper / GUI ecosystem | borgmatic, Vorta | autorestic, resticprofile, Backrest | (config-native), rustic_scheduler |
| Embeddable in another program | ❌ | ❌ | ✅ (`rustic_core` via FFI/napi-rs) |

## Platform & performance

| Feature | Borg | restic | rustic |
|---|---|---|---|
| Linux / macOS | ✅ | ✅ | ✅ |
| Windows | ⚠️ (WSL/Cygwin) | ✅ native | ⚠️ CLI yes; mount/sftp limited |
| Memory footprint | Efficient | Heavier (index in RAM) | Lower than restic |
| Prune cost on cloud | n/a (local/SSH) | ⚠️ historically slow (improved 0.12+) | ⚠️ mitigated by lock-free parallel prune |
| Async vs blocking (library) | — | — | Blocking core + internal rayon parallelism |

---

## Caveats / flags on the above
- **Borg 2.0** GA timing/adoption and its new format should be verified before pinning; Hetzner
  Storage Boxes only serve borg **≤ 1.4** (so you'd run a 1.4 client against them).
- **restic ↔ rustic interop** is a design goal confirmed by both projects (tested pairing restic 0.19
  ↔ rustic 0.11.3), but there is **no formal conformance suite** — test restores if you rely on it.
  Don't run `prune` from both tools on one repo concurrently.
- **rustic** `check` deep-verify sub-flag names, and a few `KeepOptions` edge fields, were not
  verbatim-confirmed. rustic lacks `recover`, `--sparse`, and native Windows mount/sftp.
- "via borgmatic" rows = the Python **wrapper** adds it on top of Borg; the Borg *binary* alone does not.
- **None** of the three: an absolute storage-size retention cap, native DB hooks (engine itself), or a
  bootable disk image. Those are, respectively: your `maxStorageGb` glue, a wrapper/your dump logic,
  and a provider/hypervisor snapshot.

## Sources
See [`backup-engine-comparison.md`](./backup-engine-comparison.md) and
[`borgmatic-evaluation.md`](./borgmatic-evaluation.md) for the full cited source lists (restic design
doc, borg docs, rustic.cli.rs comparison, docs.rs/rustic_core, crates.io, restic forum).

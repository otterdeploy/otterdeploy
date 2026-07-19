# Implementation Plan — Backup Engine on `rustic` CLI Shell-Outs

_Branch: `feat/rustic-backup-engine`. Companion to `docs/rustic-backup-analysis.md`. Pinned decisions there are authoritative. This doc is the build plan, with the rustic command surface **empirically verified against the real v0.11.3 GNU binary** (not guessed)._

## 0. Verified against rustic v0.11.3 (ground truth)

Downloaded the pinned GNU binary (SHA256 `3860383a…04f8` ✓) and ran the full flow end-to-end against a local repo. **All of the following is confirmed, not assumed:**

| Operation | Exact invocation (verified) | Notes |
|---|---|---|
| Repo/password | `-r <repoUrl>` (env `RUSTIC_REPOSITORY`); password via env `RUSTIC_PASSWORD`, `--password-file`, `--password-command`, or in a profile | **No `-o`/`--option` flag exists** — backend options must come from a profile TOML or env |
| Init | `rustic -r <repo> init` | idempotent-guard by tolerating "already initialized" |
| Backup (stdin) | `rustic -r <repo> backup - --stdin-filename dump --tag otterdeploy,backup:<id> --json` | **source is `-`, NOT a `--stdin` flag.** Requires stdin piped in. |
| Backup JSON out | `.id` = snapshot id (64-hex); `.summary.total_bytes_processed` = source size; `.summary.data_added` / `.data_added_packed` = added/packed bytes; `.summary.total_duration` | captured live |
| Snapshots | `rustic -r <repo> snapshots --json` → `[{ group_key, snapshots:[{ id, time, tags, summary, … }] }]` | grouped array |
| Restore (download) | `rustic -r <repo> dump <id|latest>:dump` → stdout | **round-trip byte-exact verified** |
| Restore (in-place) | `rustic -r <repo> restore <id>:<path> <destDir>` | `<SNAPSHOT[:PATH]> <DESTINATION>` |
| Retention | `rustic -r <repo> forget --filter-tags otterdeploy --keep-last N --keep-daily N --keep-weekly N --keep-monthly N --keep-yearly N [--keep-within <N>d] --prune` | GFS keep-* flags all real; verified kept-newest/removed-old |
| Integrity | `rustic -r <repo> check` | exit 0 on OK |
| Config profile | `rustic -P /abs/path/to/prof …` reads `/abs/path/to/prof.toml` | **verified** — this is how backends get their options |

**Bonus finding:** `backup --stdin-command "<cmd>"` lets rustic spawn the dump itself. Not used in v1 (we pipe the existing docker-exec stream to `-`), but noted for the zero-plumbing future.

## 1. Pinned model (from analysis doc)

- One repo per **(resource × destination)**, rooted at today's prefix `otterdeploy-backups/<resourceId|volume-<name>>/`. Each run = one snapshot, tagged `otterdeploy,backup:<backupId>,schedule:<scheduleId|manual>`.
- Repo password = `HKDF-SHA256(BETTER_AUTH_SECRET, info=repoId)`, delivered via the profile (or `RUSTIC_PASSWORD` on the child env) — never argv.
- Keep unchanged: in-container dump exec (`pg_dump`/`mysqldump`/`mongodump`/alpine volume-tar) and the 60s scheduler. Pipe dump stdout → `rustic backup -`.

## 2. `RusticCli` + profile generation

**`packages/api/src/backups/rustic.ts`** — binary at `process.env.RUSTIC_BIN ?? '/usr/local/bin/rustic'`.

The wrapper **writes a per-invocation profile TOML** (0600, in the host tmp dir, unlinked in `finally`) carrying `[repository] repository/password` and `[repository.options]` backend keys, and invokes `rustic -P <tmpProfilePathNoExt> <cmd> --json`. This is the single mechanism for local/S3/SFTP.

```ts
type RusticRepo = { repoId: string; repository: string; options: Record<string,string> };
// local:  repository = "<path>/<repoId>"                         options = {}
// s3:     repository = "opendal:s3"    options = { bucket, root, region?, endpoint?, access_key_id, secret_access_key }
// sftp:   repository = "opendal:sftp"  options = { user, endpoint:"ssh://host:port", root }   // KEY AUTH ONLY
```

Methods: `ensureInit()`, `backupStdin({stdin, stdinFilename, tags})→{snapshotId,sourceSizeBytes,addedBytes,durationMs}`, `dumpToStream({snapshotId,filenameInSnapshot,out})`, `restoreToPath({snapshotId,targetDir})`, `forget(spec, filterTags)`, `check()`, `snapshotExists(id)`. All spawn with the profile, parse `--json` stdout, stream stderr to the log closure, reject on non-zero.

## 3. Backend mapping — `backends.ts`

`toRusticRepo(dest: ResolvedDestination, repoId): RusticRepo` from today's `resolveSecret` output. **S3**: keys→options, `root=repoId`, `endpoint` for MinIO/R2. **SFTP**: ⚠️ rustic's opendal sftp is **key-auth only — password SFTP is unsupported**; if a destination has only a password, fail fast with a clear error (documented limitation; see risks). **Local**: `repository = <config.path>/<repoId>`.

## 4. Replace vs keep — file by file

(unchanged from recon code-map — the seams are correct)

| File | Action |
|---|---|
| `rustic.ts`, `backends.ts` | **NEW** |
| `engine.ts` | Rewrite `produceArchive` + the compress/encrypt/checksum/stage/put block in `executeBackup` → `ensureInit` + pipe dump stream to `backupStdin`; map result to `markBackupSucceeded`. `archiveShape`→`repoScope`. Keep run/log/event flow + `docker.destroy()`. |
| `exec.ts` | Keep `findResourceContainerId`/`execCapture`. **Replace `execDump`** → streaming `{stream, stderr(), exitCode}`. |
| `volume.ts` | Keep pure/guard helpers. Rewrite `dumpVolume` → stream tar to rustic; rewire `restoreVolumeFromTar` source. |
| `storage.ts` | **Delete** transfer code (`putArchive/getArchive/removeArchive/archiveKey/sftpRemotePath`); knowledge moves to `backends.ts`. |
| `restore.ts` | download→`dumpToStream`; in-place volume→rustic + kept guards; in-place pg→`dumpToStream` piped to `pg_restore`; maria/mongo throw unchanged. `verifyBackup`→`check`+`snapshotExists`. |
| `scheduler.ts` | Keep tick. Rewire `applyRetention` → `forget(spec,[schedule tag])` + reconcile rows. |
| `retention.ts` | GFS→keep flags supersede `selectBackupsToPrune`; keep only `maxStorageGb` residual (no native rustic flag). |
| `db.ts` | Keep state machine; `markBackupSucceeded` now gets `storagePath=snapshotId, compressedSizeBytes=addedBytes, sourceSizeBytes=total`. |
| `schema/backup.ts` | No migration — repurpose `storagePath`←snapshotId, `checksum`←null/short-id; comment the semantics. |
| `apps/server/Dockerfile` | Vendor layer (§5). |

## 5. Binary vendoring (verified asset)

`apps/server/Dockerfile` runtime stage (`oven/bun:1.3.14-debian`, glibc x86_64): download `rustic-v0.11.3-x86_64-unknown-linux-gnu.tar.gz`, verify SHA256 `3860383a38f5c717ff8302574d79a0581452361985346ed1d116216cdb1b04f8` via `sha256sum -c`, install the bare `rustic` (at archive root — confirmed) to `/usr/local/bin/rustic`. `ARG RUSTIC_VERSION=0.11.3` + literal hash. Ensure `curl` + `ca-certificates` present. Dev: run with `rustic` on PATH or `RUSTIC_BIN` set.

## 6. Retention mapping

`keepDaily/Weekly/Monthly/Yearly → --keep-daily/-weekly/-monthly/-yearly`; `retentionDays → --keep-within <N>d`; scope with `--filter-tags otterdeploy,schedule:<id>`; `--prune`. `maxStorageGb` → residual app logic after prune (no native flag). Then reconcile: `deleteBackupRow` for succeeded rows whose `storagePath` snapshot no longer exists.

## 7. Build waves (dependency-ordered)

- **W0 (parallel, new files):** T1 Dockerfile vendor · T2+T3 `rustic.ts` + `backends.ts` (one owner — shared internal API) · confirm `retention.ts` contract.
- **W1 (backup path):** T4 rewrite `exec.ts execDump`→stream + `volume.ts dumpVolume` + `engine.ts` backup path. (edits existing shared files — single owner, sequential)
- **W2 (restore/retention):** T5 `restore.ts` + `verifyBackup`; T6 `scheduler.ts applyRetention` + `retention.ts` trim.
- **W3 (cleanup):** delete `storage.ts` dead code, schema comments, doc sync.

## 8. Risks / open (verified-updated)

1. **SFTP is key-auth only** in rustic's opendal backend — password-SFTP destinations will not work. Must fail-fast + document; consider a follow-up for an SFTP-key destination field. *(new, from ground truth)*
2. **`storagePath`/`checksum`/`verify` semantic redefinition** — contract change on shared columns; audit any external reader.
3. **`execDump`/`dumpVolume` signature change** buffer→stream ripples to all callers (W1 must land coherently).
4. **`BETTER_AUTH_SECRET` rotation** makes every repo unreadable (HKDF) — operational constraint, no rotation path in v1.
5. **maria/mongo in-place restore** still unimplemented (rustic doesn't change this).
6. **arm64** vendoring latent (x86_64 pin only) — branch on `TARGETARCH` if an arm image ships.
7. **Scheduler is DB-only** — volume backup/restore validated via manual runs, not the tick.

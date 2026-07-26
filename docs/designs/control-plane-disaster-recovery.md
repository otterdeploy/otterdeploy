# Control-plane backup & disaster recovery (od-5j8.13)

**Status:** Partially implemented. Core mechanics built and verified in isolation; a full
timed drill on a real fresh VPS has NOT been run — see "Verified vs unverified" below.
Do not read this as "recovery works," read it as "here is exactly what has and hasn't
been proven."

## 0. Cross-check: what already existed before this pass

od-5j8.13 was written before a lot of backup work landed. Before building anything, this pass
read `packages/api/src/routers/backups/**`, `packages/db/src/schema/backup.ts`, the engine
(`packages/api/src/backups/**`), and `docs/designs/backups.md`. Conclusion: **all of that is a
TENANT backup system** — it backs up org resources (`database`/`volume` kind, via rustic +
OpenDAL to S3/local/SFTP destinations, on the `backup`/`backup_schedule`/`backup_destination`
tables). It has zero awareness of the control plane's own Postgres, its own data directory, or
Caddy's own state. od-5j8.13's actual scope (whole-install DR) was **genuinely unbuilt** — this
doc/implementation is new work, not a rebuild of something that already existed. Where it made
sense, it *reuses* the tenant system rather than duplicating it (see §2.2).

Also cross-checked: od-5j8.12 (separate encryption domains / key rotation) is open and its
closing notes explicitly list *"No distinct backup recovery key — backup archives
(encryptBytes/decryptBytes) still share the legacy v1/BETTER_AUTH_SECRET key; the epic's
'recovery-key loss and restore procedures are tested' acceptance criterion is UNMET."* This pass
implements that missing recovery key — scoped specifically to control-plane backup archive
encryption (see §1). It does **not** touch od-5j8.12's `DATA_ENCRYPTION_KEYS` rotation tooling or
`encryptBytes`/`decryptBytes` (tenant backup archive encryption) — those stay od-5j8.12's
territory. Cross-referenced in both issues' notes.

## 1. The recovery key — why, and how it works

Every secret the platform stores at rest is encrypted with a key derived from
`DATA_ENCRYPTION_KEYS` / `BETTER_AUTH_SECRET` (`packages/api/src/lib/crypto.ts`). That key
material lives ONLY in the control plane's own `.env` file. A whole-control-plane backup
encrypted with that same key is worthless for disaster recovery: if the host is gone, the key
needed to read the backup is gone with it.

**Design:** a separate, high-entropy **recovery key** (`packages/api/src/lib/recovery-key.ts`):

- Generated independently of the keyring — 256 bits from `crypto.getRandomValues`, never derived
  from or stored alongside `BETTER_AUTH_SECRET`.
- Shown to the operator **exactly once**, at generation time (`otterdeploy backups control-plane
  generate-key`, or offline via `otterdeploy recovery-key generate` — see §4). The platform never
  persists the raw key — only `sha256(key)[:4 bytes]` (embedded in each archive, for a fast
  wrong-key rejection) and a separate `sha256(key)[:8 bytes]` fingerprint on `platform_settings`,
  so the readiness UI can show "a key was generated" and let the operator visually confirm a held
  key matches, without the platform ever being able to leak the key itself.
- Is the AES-256-GCM key for the **entire control-plane archive** — which itself contains the
  control-plane `.env` (and therefore `DATA_ENCRYPTION_KEYS`/`BETTER_AUTH_SECRET`). Decrypting the
  archive with the recovery key on a fresh box recovers the whole keyring as a side effect of
  restoring `.env` — **there is no separate "unwrap the keyring" ceremony to get wrong.** This is
  simpler than a key-wraps-a-key design and was chosen deliberately: the `.env` file is already the
  keyring's only home today (that's inherent to the platform's current env-var-based config), so
  encrypting the archive that contains it *is* the key-recovery mechanism.
- An operator must explicitly **confirm export** (`otterdeploy backups control-plane
  confirm-key-exported`) before readiness reports anything but `not_ready` — generating a key and
  never saving it is exactly as useless as never generating one, and the platform can't tell the
  difference on its own, so it asks.

Archive framing (`wrapControlPlaneArchive`/`unwrapControlPlaneArchive`):

```
magic "OTCPBK1\0" (8B) | sha256(key)[:4B] | AES-GCM nonce (12B) | AES-GCM(ciphertext ‖ 16B tag)
```

## 2. What gets backed up, and by what

### 2.1 Scope (per the issue)

Control-plane Postgres, the data directory (`.env` + compose file), Caddy state (TLS certs +
Caddy's own storage), and the recovery key required to read all of the above.
**Deliberately excluded:** redis (ephemeral BullMQ job state — losing it means re-triggering
in-flight jobs, not data loss) and CrowdSec state (a threat-intel cache that rebuilds itself).
Neither is in the issue's scope.

### 2.2 Execution: a host script, not a BullMQ job

`scripts/control-plane-backup.sh` runs on the HOST (like `install.sh`/`uninstall.sh`), not as an
in-app job. Reasoning: it needs to `pg_dump` the control plane's *own* database and tar named
Docker volumes from *outside* any container the API process runs in — the same reason
`install.sh`/`uninstall.sh` are host scripts rather than in-app actions. A "documented, tested
script" was explicitly acceptable per the issue's guidance over an unverifiable in-app claim.

Steps: `pg_dump -Fc` the control-plane DB → copy `.env` + compose file → tar
`otterdeploy-caddy-data` + `otterdeploy-caddy-state` (via a throwaway `alpine` helper container,
the same idiom Docker's own docs use for volume backup) → combine into one tar → encrypt with the
recovery key → upload to S3 (via `rclone/rclone`, CLI-flag-only config, no destination table
needed at backup time — see §2.3) → report the run back to the API
(`backups.controlPlane.reportRun`) so the readiness surface reflects reality.

`scripts/control-plane-restore.sh` is the inverse: decrypt → restore `.env` (recovers the keyring)
→ restore Caddy volumes → spin up a throwaway `postgres:17-alpine` container, `pg_restore` into a
fresh `otterdeploy-postgres-data` volume → `docker compose up`.

Both scripts shell out to `scripts/lib/recovery-key.mjs` for the actual encrypt/decrypt — **not**
the `otterdeploy` CLI. Reason: `apps/server/Dockerfile`'s production image is built with `bun
install --filter server --filter builder --production`, which deliberately excludes `apps/cli` and
its dependencies. A fresh-VPS restore can't assume that image (or any otterdeploy image) has even
been pulled yet. `recovery-key.mjs` needs *nothing* but a bare `oven/bun` image (pulled fresh) and
itself (bind-mounted in) — no `bun install`, no workspace resolution, no network beyond the image
pull.

**Consistency risk this creates:** two implementations of the same AES-GCM framing (the TS module
used by the API/web UI, and the standalone script used for real encrypt/decrypt). Addressed with
`packages/api/src/lib/__tests__/recovery-key-script-parity.test.ts`, which shells out to the real
`.mjs` file and asserts byte-for-byte interop in both directions, including the failure paths
(wrong key, tampered ciphertext) — see §5.

### 2.3 Off-host destination — reuse, not a new surface

`platformSettings.controlPlaneBackupDestinationId` points at an existing (org-scoped)
`backup_destination` row (`packages/db/src/schema/backup.ts`) — deliberately **not** a second
destination-config surface. The tenant backup system already has S3-compatible destinations with
encrypted credentials, structural validation (`destinations.test`), and a UI; control-plane backup
reuses that instead of re-implementing it. `s3` is the only genuinely off-host type the existing
system supports (`local`/`sftp` are host-adjacent by construction) — pick an `s3` destination.

**Immutability:** the platform does not implement object-lock/versioning itself — that's a
bucket-level setting the operator configures on their S3-compatible provider (S3 Object Lock in
compliance or governance mode, or the equivalent on Backblaze B2 / Hetzner Object Storage / MinIO).
This is stated plainly rather than pretended: nothing in this codebase enforces retention/WORM on
the uploaded archive. **Retention** (how many archives to keep) is likewise not automated for
control-plane backups — the tenant system's GFS retention (`keepDaily`/`keepWeekly`/…) applies to
tenant snapshots, not this archive. An operator should set a lifecycle policy on the bucket prefix.

## 3. Readiness — "could I actually recover right now?"

`packages/api/src/backups/control-plane-readiness.ts` — a pure classification function
(`classifyControlPlaneReadiness`), unit-tested with one test per signal proving that signal ALONE
pulls the verdict down (the "never fake green" guarantee — see §5). Real signals assembled by
`packages/api/src/routers/backups/control-plane-service.ts`:

- **Backups enabled** (operator switch).
- **Destination configured + a structural check** (required config present, stored credential
  decrypts). This is the SAME check `backups.destinations.test` already performs — **not** a live
  network round-trip. Said plainly: there is no head-bucket/list-objects probe today. Labeled as
  such everywhere it surfaces (CLI, web card, this doc) rather than implied to be more than it is.
- **Recovery key exported** (not just generated — see §1).
- **Last successful backup age** — `ready` under 30h, `degraded` 30–96h, `not_ready` beyond 96h
  (the recovery-point objective this pass picked; not independently validated against a real
  operational cadence).
- **Most recent run status** — a failed latest attempt degrades readiness even if an earlier run
  succeeded.

Surfaces: `backups.controlPlane.readiness` (oRPC, install-admin only), `otterdeploy backups
control-plane status` (CLI), and a "Control-plane recovery" card on the web Backups page.

## 4. Operator workflow

```
# One-time setup
otterdeploy backups destinations create --type s3 ...     # (existing tenant destination flow)
otterdeploy backups control-plane configure --destination <id> --enable
otterdeploy backups control-plane generate-key             # save the printed key OFF this host
otterdeploy backups control-plane confirm-key-exported

# Recurring (cron, on the control-plane host)
OTTERDEPLOY_RECOVERY_KEY=... OTTERDEPLOY_CP_BACKUP_S3_* ... \
  sudo -E bash scripts/control-plane-backup.sh

# Disaster recovery, on a FRESH VPS
OTTERDEPLOY_RECOVERY_KEY=... \
  sudo -E bash scripts/control-plane-restore.sh --archive control-plane.tar.enc
```

## 5. Verified vs unverified (macOS dev host, no real Linux control-plane install available)

**Verified, with real commands, real Docker containers, real Postgres — not simulated:**

- `packages/api/src/lib/recovery-key.ts`: generate/fingerprint/wrap/unwrap round-trip, wrong-key
  rejection, tamper detection, truncation detection, malformed-key rejection — 16 unit tests.
- `packages/api/src/backups/control-plane-readiness.ts`: 12 table-driven unit tests, one per
  signal, proving each alone can pull the verdict off `ready`.
- **Cross-implementation parity**: `recovery-key-script-parity.test.ts` shells out to the *real*
  `scripts/lib/recovery-key.mjs` as a subprocess and proves the TS module and the script produce
  interchangeable archives in both directions, including failure paths — 5 tests, all passing.
- **A manual, real, end-to-end mechanics round trip** (not part of the automated suite, run once
  during this implementation and reported here): started a throwaway `postgres:17-alpine`
  container, seeded a sample row, `pg_dump`'d it, tarred a fake `.env` + a fake `caddy-data` Docker
  volume, encrypted the combined archive via `docker run oven/bun:1.3.14-slim
  scripts/lib/recovery-key.mjs encrypt` (the exact image pin the real scripts use), decrypted it
  back (byte-identical to the pre-encryption tar), `pg_restore`'d into a **second**, fresh
  container, and confirmed the sample row came back exactly. Also restored the fake Caddy volume
  tar into a fresh named volume and confirmed its file content. All throwaway containers/volumes
  were removed afterward; the shared dev Postgres
  (`postgres://postgres:password@localhost:5432/postgres`) was never touched — this used
  independent, disposable containers instead.
- Full `packages/api`, `apps/cli`, `apps/server`, and `apps/web` suites all green after every
  change in this pass (see the closing report for exact counts); `bunx tsc --noEmit` introduces no
  new errors in any touched package.

**NOT verified — this is the honest gap:**

- `scripts/control-plane-backup.sh` and `scripts/control-plane-restore.sh` **themselves** have
  **not** been executed end-to-end. They were written against confirmed real facts (compose volume
  names, `.env` schema, `Dockerfile` image contents) and their core mechanics were proven correct in
  isolation (§ above), but the scripts as whole programs — argument parsing, the `rclone` upload
  step, the `docker compose up` step, error paths — have not run against a real otterdeploy install
  (docker-compose stack, Swarm, Caddy). This environment has no Linux host to install otterdeploy
  onto; a real drill needs one.
- **No timed drill.** The issue's acceptance criterion — "recovers login, projects, routing,
  certificates, deployment history and backup access within documented RPO/RTO" — is NOT met. No
  RTO has been measured. The RPO thresholds in `control-plane-readiness.ts` (30h/96h) are this
  pass's own judgment call, not derived from a measured drill. Restoring an actual working
  dashboard login / project list / Caddy routing / issued certificates (as opposed to the
  underlying Postgres rows and Caddy volume bytes, which ARE verified to round-trip) has not been
  observed.
- The web "Control-plane recovery" card (`apps/web/src/features/backups/control-plane-recovery-card.tsx`)
  compiles and the app's existing test suite stays green, but it has no dedicated component test
  and has not been visually verified in a browser in this pass.
- The `rclone/rclone` S3 upload step in `control-plane-backup.sh` has not been run against a real
  S3-compatible bucket (no credentials available in this environment).
- Migration `packages/db/src/migrations/20260726205418_puzzling_zarda` was generated but **NOT**
  applied to the shared dev database, per instructions (mirrors od-5j8.12's precedent) — the new
  `platform_settings` columns exist in the schema/types but not yet in that live database.

**Conclusion:** the strongest defensible claim is "the cryptographic and data-round-trip mechanics
of control-plane DR are real and tested; the orchestration scripts are honest best-effort
automation of those mechanics, unverified as whole programs; the acceptance criterion's timed,
full-stack drill has not been run." See the closing `bd` notes on od-5j8.13 for the same summary.

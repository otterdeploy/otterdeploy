# Continuous Protection: Physical Backups, WAL Archiving, PITR

**Status:** Decided 2026-08-17 (od-6et.20). Physical full backups SHIPPED;
WAL archiving + PITR designed here and deliberately deferred to a dedicated
epic. **Reference implementation:** databasus
(`backend/internal/features/backups/backups/usecases/physical/postgresql/`),
studied in the od-6et competitive analysis.

## Decision

1. **Physical full backups: shipped now** (this document records the shape).
   `pg_basebackup --pgdata=- --format=tar --wal-method=fetch` exec'd inside
   the database's own container, streamed into the existing rustic pipeline —
   the same (resource × destination) repo, dedup, encryption, retention, and
   log streaming as logical dumps. Selected per manual run
   (`approach: "physical"` in the contract, `--physical` in the CLI, a Method
   toggle in the Backup Now dialog; postgres only). Restore is download-only:
   a base backup restores by extracting into a fresh data directory with the
   server stopped, so in-place restore and sandbox verification refuse it
   with that guidance.

2. **WAL archiving + PITR: deferred, not dropped.** It is a quarter-scale
   subsystem (supervised long-running `pg_receivewal` processes per protected
   instance, replication-slot lifecycle, segment upload + gap detection,
   chain/timeline resolution at restore time) whose failure modes are
   entirely unlike the run-to-completion engine we have. Shipping it inside
   the hardening pass would have meant shipping it unsupervised. Evidence
   from databasus supports respect for the scope: their implementation needs
   a WAL supervisor with crash-loop escalation, chain-view resolution, and
   even then ships PITR as an operator-run recovery script, not one-click.

## The deferred design (for the follow-up epic)

Mapped onto otterdeploy's architecture:

- **WAL streaming**: one supervised `pg_receivewal` per protected postgres
  resource, run as a sidecar container (image = the database's own image, so
  client/server versions always match) with a replication slot named
  `otterdeploy_wal_<resourceId>`. Supervision lives in a background service
  (like `startBackupScheduler`): respawn with backoff, crash-loop escalation
  to a `backup.failed`-class platform event, slot rebuild on resume mismatch.
- **Segment storage**: each finished segment uploaded into the resource's
  existing rustic repo tagged `wal:<timeline>:<segment>`; rustic dedup makes
  repeated timeline history files cheap. A `backup_wal_segment` catalog table
  mirrors databasus's per-segment rows and powers gap detection.
- **Chain model**: a physical FULL anchors a chain; PG17+ `--incremental`
  extends it (parent manifest streamed from the repo). Chain extendability
  checks (timeline match + WAL summarizer availability) decide FULL vs INCR,
  falling back to a fresh FULL on `CHAIN_BROKEN`, exactly databasus's rule.
- **PITR restore**: resolve (FULL + INCRs + contiguous WAL to target time +
  timeline history) from the catalog, stream as one tar with a trailing
  `MANIFEST.sha256`, and serve a recovery script that runs
  `pg_combinebackup` and arms `recovery_target_time`. Operator-run, like
  databasus — one-click PITR into a live container is explicitly out of
  scope for v1 of the follow-up too.

## Why not now, in one sentence

The hardening pass's job was to make the existing backup engine trustworthy
(locks, retries, crash recovery, restore-proving verification, overdue
alerts); grafting a process-supervision subsystem onto the same change would
have put the least-reviewable code in the least-reviewed corner of the diff.

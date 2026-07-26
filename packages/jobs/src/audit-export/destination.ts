/**
 * Off-host export destination (od-5j8.21) — a small, storage-agnostic
 * interface so ./export.ts and ./retention.ts never need to know whether
 * they're writing to S3, a local mount, or (in tests) memory.
 *
 * NOTE ON CONVERGENCE: the backups feature (packages/api/src/backups) has
 * its own `ResolvedDestination`/`DestinationType` (S3/local/sftp) and a
 * `backupDestination` DB table an operator configures once and reuses
 * across backup schedules. That would be the natural long-term home for
 * audit-export config too — "pick an existing destination" instead of a
 * second set of AUDIT_EXPORT_* env vars. It is NOT reused here: the backups
 * engine drives rustic (a Rust binary, invoked as a subprocess via OpenDAL
 * backend config — see packages/api/src/backups/backends.ts), which has no
 * JS-callable "PUT this one object" primitive to call into, only whole
 * snapshot/restore operations; and the backups feature has active
 * concurrent work in flight in this worktree, so wiring a second consumer
 * onto its destination table/CRUD right now risks a collision. This module
 * is deliberately a narrow, independent interface + its own env-driven
 * config (packages/env AUDIT_EXPORT_*) so it can be swapped for "resolve an
 * existing backupDestination row" later without any caller of
 * `AuditExportDestination` changing.
 */

export interface AuditExportDestination {
  /** Label for logs — never a secret. */
  readonly kind: string;
  /**
   * Write `body` at `key`. Idempotent: writing the SAME key again (a job
   * retry after a crash between "wrote object" and "marked rows exported")
   * must succeed, not corrupt or duplicate anything — export batch keys are
   * content-addressed by the row-id range they cover, so a re-write is
   * always byte-identical.
   */
  putObject(key: string, body: string): Promise<void>;
  /** Every key currently stored under `prefix` (retention sweep). */
  listKeys(prefix: string): Promise<string[]>;
  /** Delete one key (retention sweep, past the retention window). */
  deleteObject(key: string): Promise<void>;
}

/** In-memory destination — test-only. Nothing survives the process. */
export function createMemoryExportDestination(): AuditExportDestination & {
  objects: Map<string, string>;
} {
  const objects = new Map<string, string>();
  return {
    kind: "memory",
    objects,
    async putObject(key, body) {
      objects.set(key, body);
    },
    async listKeys(prefix) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
    async deleteObject(key) {
      objects.delete(key);
    },
  };
}

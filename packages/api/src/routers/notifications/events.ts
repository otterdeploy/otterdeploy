/**
 * Platform event catalog: the rows of the subscription matrix. Server-side
 * source of truth: the contract validates subscription `eventId`s against
 * EVENT_IDS, and event emitters look up severity here so providers (PagerDuty,
 * etc.) get a consistent level. The web client keeps a parallel labelled copy
 * for rendering; the ids must stay in lockstep.
 */
export type EventSeverity = "info" | "ok" | "warn" | "err";

export interface PlatformEventDef {
  id: string;
  label: string;
  severity: EventSeverity;
  /** Omitted means wired. See the catalog docblock for why `false` hides the
   *  row from the matrix without removing the id. */
  wired?: false;
}

/**
 * The catalog. `wired: false` marks an event that EXISTS as an id but that
 * nothing emits yet, so the subscription matrix must not offer it: a row you
 * can subscribe to that can never fire is a promise the product cannot keep.
 *
 * Such an id stays in {@link EVENT_IDS} on purpose. That array becomes a
 * `z.enum` in both this router's contract and the webhooks contract, and rows
 * subscribed to it may already exist in the database. Dropping the id would
 * turn every one of those rows into a validation failure on read.
 *
 * The matrix that honours this flag is client-side, and mirrors the catalog in
 * apps/web/src/features/notifications/shared.ts — so keep the flag in step
 * there too, exactly as the ids already have to be.
 */
const PLATFORM_EVENTS: readonly PlatformEventDef[] = [
  { id: "deploy.started", label: "Deploy started", severity: "info" },
  { id: "deploy.succeeded", label: "Deploy succeeded", severity: "ok" },
  { id: "deploy.failed", label: "Deploy failed", severity: "err" },
  { id: "deploy.crashed", label: "Service crashed", severity: "err" },
  { id: "build.failed", label: "Build failed", severity: "err" },
  { id: "health.degraded", label: "Health degraded", severity: "warn" },
  { id: "health.recovered", label: "Health recovered", severity: "ok" },
  { id: "host.pressure", label: "Server resource pressure", severity: "warn" },
  // Not emitted anywhere. Caddy logs obtain/renew/fail, not expiry, so there is
  // no source for it today: see src/edge-logs/cert-promote.ts. Kept as an id,
  // hidden from the matrix, until something can actually raise it.
  { id: "cert.expiring", label: "Cert expiring soon", severity: "warn", wired: false },
  { id: "cert.renewed", label: "Cert renewed", severity: "ok" },
  { id: "backup.failed", label: "Backup failed", severity: "err" },
  { id: "backup.succeeded", label: "Backup succeeded", severity: "ok" },
  { id: "backup.orphaned", label: "Backup schedule orphaned", severity: "warn" },
  { id: "backup.overdue", label: "Backups overdue", severity: "warn" },
  { id: "backup.verify-failed", label: "Backup verification failed", severity: "err" },
  { id: "ssh.rotated", label: "SSH key rotated", severity: "info" },
  { id: "audit.anomaly", label: "Audit anomaly", severity: "warn" },
  { id: "edge.probe", label: "Suspicious edge traffic", severity: "warn" },
] as const;

/** Every id the system will accept, including the not-yet-wired ones. Feeds the
 *  `z.enum` in ./contract.ts and ../webhooks/contract.ts, so it must stay a
 *  superset of whatever is already stored. */
export const EVENT_IDS = PLATFORM_EVENTS.map((e) => e.id);

const SEVERITY_BY_ID = new Map(PLATFORM_EVENTS.map((e) => [e.id, e.severity]));

export function eventSeverity(eventId: string): EventSeverity {
  return SEVERITY_BY_ID.get(eventId) ?? "info";
}

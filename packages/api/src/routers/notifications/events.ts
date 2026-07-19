/**
 * Platform event catalog — the rows of the subscription matrix. Server-side
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
}

const PLATFORM_EVENTS: readonly PlatformEventDef[] = [
  { id: "deploy.started", label: "Deploy started", severity: "info" },
  { id: "deploy.succeeded", label: "Deploy succeeded", severity: "ok" },
  { id: "deploy.failed", label: "Deploy failed", severity: "err" },
  { id: "deploy.crashed", label: "Service crashed", severity: "err" },
  { id: "build.failed", label: "Build failed", severity: "err" },
  { id: "health.degraded", label: "Health degraded", severity: "warn" },
  { id: "health.recovered", label: "Health recovered", severity: "ok" },
  { id: "host.pressure", label: "Server resource pressure", severity: "warn" },
  { id: "cert.expiring", label: "Cert expiring soon", severity: "warn" },
  { id: "cert.renewed", label: "Cert renewed", severity: "ok" },
  { id: "backup.failed", label: "Backup failed", severity: "err" },
  { id: "backup.succeeded", label: "Backup succeeded", severity: "ok" },
  { id: "backup.orphaned", label: "Backup schedule orphaned", severity: "warn" },
  { id: "ssh.rotated", label: "SSH key rotated", severity: "info" },
  { id: "audit.anomaly", label: "Audit anomaly", severity: "warn" },
  { id: "edge.probe", label: "Suspicious edge traffic", severity: "warn" },
] as const;

export const EVENT_IDS = PLATFORM_EVENTS.map((e) => e.id);

const SEVERITY_BY_ID = new Map(PLATFORM_EVENTS.map((e) => [e.id, e.severity]));

export function eventSeverity(eventId: string): EventSeverity {
  return SEVERITY_BY_ID.get(eventId) ?? "info";
}

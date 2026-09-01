import type { OrganizationId } from "@otterdeploy/shared/id";

/**
 * Platform-event emission: the single integration point features call when
 * something notification-worthy happens. Resolves severity from the catalog
 * and enqueues a `notification.event` job, which fans the event out to every
 * channel subscribed to it (the subscription matrix).
 *
 * Best-effort by contract: enqueue failures are swallowed (logged by the
 * queue) so a notification problem can never break the action that emitted it.
 * A failed backup must still record as failed even if Redis is down. Uses
 * `Result.tryPromise` rather than raw try/catch per the repo convention.
 *
 * Wired today (every catalog event except the one noted below):
 *   - backup.succeeded / backup.failed  (src/backups/engine.ts)
 *   - backup.verify-failed (src/backups/verify-restore.ts)
 *   - backup.overdue   (src/backups/overdue.ts)
 *   - backup.orphaned  (src/backups/schedule-cleanup.ts, schedule disabled
 *     when its last source was deleted)
 *   - deploy.started   (emitDeployStarted, from all 3 deployment-insert paths)
 *   - deploy.succeeded (reconcileDeploySuccess, lazy detector in the list read)
 *   - deploy.failed    (markDeploymentFailed)
 *   - deploy.crashed   (src/routers/project/deploy-crash-watcher.ts)
 *   - build.failed     (apps/builder pipeline-steps.ts) — FAILURES ONLY;
 *     there is no build.succeeded event, so "build events" means build
 *     problems. The bell's empty-state copy has to say so.
 *   - health.degraded / health.recovered (src/metrics/health-detector.ts)
 *   - host.pressure    (src/metrics/sampler.ts)
 *   - cert.renewed     (src/edge-logs/cert-promote.ts)
 *   - ssh.rotated, audit.anomaly, edge.probe
 *
 * NOT wired: `cert.expiring`. Caddy logs obtain/renew/fail, not expiry, so
 * nothing can raise it (see src/edge-logs/cert-promote.ts). It is flagged
 * `wired: false` in the catalog so the subscription matrix stops offering it.
 */
import { triggerPlatformEvent } from "@otterdeploy/jobs";
import { encodeSubject, type InboxSubject } from "@otterdeploy/shared/inbox-subject";
import { Result } from "better-result";

import { eventSeverity } from "../routers/notifications/events";
import { publishOrgEvent } from "../routers/project/project-event-bus";

export interface EmitInput {
  organizationId: OrganizationId;
  /** Catalog event id (e.g. "backup.failed"). Severity is looked up from it. */
  eventId: string;
  title: string;
  message?: string;
  /** Display context: already-formatted strings, shown as key/value rows. */
  data?: Record<string, string>;
  /**
   * What the event is about, as an identity rather than a display string.
   * This is what lets the inbox fold "deploy failed" and the later "deploy
   * succeeded" on the same resource into one resolved story, and group
   * history under the thing it happened to. Encoded onto `data` so every
   * transport sees it without a schema change (@otterdeploy/shared/inbox-subject).
   */
  subject?: InboxSubject;
}

export async function emitPlatformEvent(input: EmitInput): Promise<void> {
  await Result.tryPromise({
    try: () =>
      triggerPlatformEvent({
        organizationId: input.organizationId,
        eventId: input.eventId,
        severity: eventSeverity(input.eventId),
        title: input.title,
        message: input.message ?? "",
        data: input.subject ? { ...input.data, ...encodeSubject(input.subject) } : input.data,
      }),
    catch: (cause) => cause,
  });

  // Every deploy lifecycle notification is also the moment the org's
  // building/queued counts changed. Announce it so the header activity pill
  // resyncs over the org stream instead of waiting out its idle poll.
  // (Inbox resync is published by the notification-inbox job, AFTER the rows
  // actually exist. Publishing it here would race the async write.)
  if (input.eventId.startsWith("deploy.")) {
    publishOrgEvent(input.organizationId, "activity");
  }
}

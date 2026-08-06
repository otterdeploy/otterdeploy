import type { OrganizationId } from "@otterdeploy/shared/id";

/**
 * Platform-event emission — the single integration point features call when
 * something notification-worthy happens. Resolves severity from the catalog
 * and enqueues a `notification.event` job, which fans the event out to every
 * channel subscribed to it (the subscription matrix).
 *
 * Best-effort by contract: enqueue failures are swallowed (logged by the
 * queue) so a notification problem can never break the action that emitted it
 * — a failed backup must still record as failed even if Redis is down. Uses
 * `Result.tryPromise` rather than raw try/catch per the repo convention.
 *
 * Wired today:
 *   - backup.succeeded / backup.failed  (src/backups/engine.ts)
 *   - backup.orphaned  (src/backups/schedule-cleanup.ts — schedule disabled
 *     when its last source was deleted)
 *   - deploy.started   (emitDeployStarted, from all 3 deployment-insert paths)
 *   - deploy.succeeded (reconcileDeploySuccess — lazy detector in the list read)
 *   - deploy.failed    (markDeploymentFailed)
 *
 * Ready to wire (call `emitPlatformEvent` from the outcome site when the
 * source feature lands): build.failed, health.*, cert.*, ssh.rotated,
 * audit.anomaly.
 */
import { triggerPlatformEvent } from "@otterdeploy/jobs";
import { Result } from "better-result";

import { eventSeverity } from "../routers/notifications/events";
import { publishOrgEvent } from "../routers/project/project-event-bus";

export interface EmitInput {
  organizationId: OrganizationId;
  /** Catalog event id (e.g. "backup.failed"). Severity is looked up from it. */
  eventId: string;
  title: string;
  message?: string;
  /** Display context — already-formatted strings, shown as key/value rows. */
  data?: Record<string, string>;
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
        data: input.data,
      }),
    catch: (cause) => cause,
  });

  // Every deploy lifecycle notification is also the moment the org's
  // building/queued counts changed — announce it so the header activity pill
  // resyncs over the org stream instead of waiting out its idle poll.
  // (Inbox resync is published by the notification-inbox job, AFTER the rows
  // actually exist — publishing it here would race the async write.)
  if (input.eventId.startsWith("deploy.")) {
    publishOrgEvent(input.organizationId, "activity");
  }
}

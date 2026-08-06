/**
 * Jobs-side publisher for the org event channel. The wire shape and channel
 * name live in @otterdeploy/shared/org-events; the API process owns the
 * subscriber side (`events.orgStream`). This package cannot import
 * @otterdeploy/api, so it carries its own thin Redis publisher.
 *
 * Best-effort, like every event publish in this codebase: a Redis outage
 * must never fail the job that did the durable write — consumers repair via
 * their slow poll backstops.
 */
import type { OrgStreamCollection } from "@otterdeploy/shared/org-events";

import { orgEventsChannel } from "@otterdeploy/shared/org-events";
import { RedisClient } from "bun";

let publisher: RedisClient | null = null;
// env/server validates the whole environment the moment it's imported, which
// breaks test files that merely import a job module — defer it to the first
// actual publish (which the best-effort catch already covers in tests).
async function getPublisher(): Promise<RedisClient> {
  if (!publisher) {
    const { env } = await import("@otterdeploy/env/server");
    publisher = new RedisClient(env.REDIS_URL);
  }
  return publisher;
}

export function publishOrgEvent(organizationId: string, kind: OrgStreamCollection): void {
  void getPublisher()
    .then((client) => client.publish(orgEventsChannel(organizationId), JSON.stringify({ kind })))
    .catch(() => undefined);
}

import type { JobsOptions } from "bullmq";

import {
  type DataProcessingPayload,
  processDataJob,
} from "./jobs/process-data";
import {
  type DeployTriggeredPayload,
  deployTriggeredJob,
} from "./jobs/deploy";
import { type EmailPayload, sendEmailJob } from "./jobs/email";
import { hourlyCleanupJob } from "./jobs/hourly-cleanup";
import {
  type NotificationPayload,
  sendNotificationJob,
} from "./jobs/notification";
import {
  type UserSignupPayload,
  welcomeSequenceJob,
} from "./jobs/welcome-sequence";
import { getQueue } from "./queues";

export type {
  EmailPayload,
  NotificationPayload,
  DataProcessingPayload,
  UserSignupPayload,
  DeployTriggeredPayload,
};

/**
 * Each trigger validates with the job's schema, then adds to its queue with
 * the job's default opts (callers can override via the second arg).
 */
function enqueue<P>(
  jobName: string,
  payload: P,
  opts?: JobsOptions,
): Promise<unknown> {
  const queue = getQueue(jobName);
  return queue.add(jobName, payload as unknown as object, opts);
}

export async function triggerEmail(payload: EmailPayload, opts?: JobsOptions) {
  const parsed = sendEmailJob.schema.parse(payload);
  return enqueue(sendEmailJob.name, parsed, { ...sendEmailJob.opts, ...opts });
}

export async function triggerNotification(
  payload: NotificationPayload,
  opts?: JobsOptions,
) {
  const parsed = sendNotificationJob.schema.parse(payload);
  return enqueue(sendNotificationJob.name, parsed, {
    ...sendNotificationJob.opts,
    ...opts,
  });
}

export async function triggerDataProcessing(
  payload: DataProcessingPayload,
  opts?: JobsOptions,
) {
  const parsed = processDataJob.schema.parse(payload);
  return enqueue(processDataJob.name, parsed, { ...processDataJob.opts, ...opts });
}

/**
 * Cancel any pending/queued processData runs for the given dataId.
 * Replaces Inngest's `cancelOn` matcher — BullMQ doesn't have that primitive,
 * so we walk the queue and remove matching jobs.
 */
export async function cancelDataProcessing(dataId: string) {
  const queue = getQueue(processDataJob.name);
  const queued = await queue.getJobs(["waiting", "delayed", "active"]);
  const toRemove = queued.filter((j) => (j.data as DataProcessingPayload)?.dataId === dataId);
  await Promise.all(toRemove.map((j) => j.remove()));
  return { cancelled: toRemove.length };
}

export async function triggerDeploy(
  payload: DeployTriggeredPayload,
  opts?: JobsOptions,
) {
  const parsed = deployTriggeredJob.schema.parse(payload);
  return enqueue(deployTriggeredJob.name, parsed, {
    ...deployTriggeredJob.opts,
    ...opts,
  });
}

export async function triggerWelcomeSequence(
  payload: UserSignupPayload,
  opts?: JobsOptions,
) {
  const parsed = welcomeSequenceJob.schema.parse(payload);
  return enqueue(welcomeSequenceJob.name, parsed, {
    ...welcomeSequenceJob.opts,
    ...opts,
  });
}

export async function triggerEmailBatch(payloads: EmailPayload[]) {
  const queue = getQueue(sendEmailJob.name);
  return queue.addBulk(
    payloads.map((payload) => ({
      name: sendEmailJob.name,
      data: sendEmailJob.schema.parse(payload),
      opts: sendEmailJob.opts,
    })),
  );
}

/**
 * Force-run the cron jobs immediately (for tests / admin actions).
 */
export async function runHourlyCleanupNow() {
  return enqueue(hourlyCleanupJob.name, {}, hourlyCleanupJob.opts);
}

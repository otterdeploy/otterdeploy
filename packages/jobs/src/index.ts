// Public surface for @otterdeploy/jobs.

// Triggers — drop-in replacement for the old inngest send* helpers.
export {
  triggerEmail,
  triggerNotification,
  triggerDataProcessing,
  cancelDataProcessing,
  triggerWelcomeSequence,
  triggerEmailBatch,
  runHourlyCleanupNow,
  triggerDeploy,
  triggerPlatformEvent,
  triggerWebhookEvent,
  triggerWebhookDelivery,
} from "./triggers";
export type {
  EmailPayload,
  NotificationPayload,
  PlatformEventPayload,
  WebhookEventPayload,
  WebhookDeliveryPayload,
  DataProcessingPayload,
  UserSignupPayload,
  DeployTriggeredPayload,
} from "./triggers";
export { buildWebhookBody } from "./jobs/webhook";

// Worker + queue lifecycle (apps/server boot/shutdown).
export { createWorkers } from "./workers";
export { getAllQueues, getQueue, closeQueues } from "./queues";

// Dashboard.
export { workbenchQueues } from "./dashboard";

// Registry — exposed so admin endpoints / tooling can enumerate jobs.
export { jobs, jobsByName } from "./registry";

// Boot-time reconciliation — reset deployments stranded by a crash.
export { reconcileInterruptedDeployments } from "./reconcile";

// Definition helper — exported for callers adding new jobs in apps.
export { defineJob } from "./define";
export type { JobDef, JobContext } from "./define";

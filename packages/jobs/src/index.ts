// Public surface for @otterdeploy/jobs.

// Triggers: drop-in replacement for the old inngest send* helpers.
export {
  triggerEmail,
  triggerNotification,
  triggerDataProcessing,
  cancelDataProcessing,
  triggerWelcomeSequence,
  triggerEmailBatch,
  runHourlyCleanupNow,
  triggerDeploy,
  triggerProvisionServer,
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
// Value export (zod schema + its inferred type): the server's worker registry
// parses queue payloads with it instead of casting.
export { ProvisionServerPayload } from "./jobs/provision";
export { buildWebhookBody } from "./jobs/webhook";

// Worker + queue lifecycle (apps/server boot/shutdown).
export { createWorkers } from "./workers";
export { getAllQueues, getQueue, getDeployQueue, allDeployQueues, closeQueues } from "./queues";

// Deploy lanes — per-build-node queues (see lanes.ts).
export {
  DEFAULT_DEPLOY_LANE,
  deployQueueName,
  isDeployLaneName,
  listDeployLanes,
  registerDeployLane,
} from "./lanes";

// Dashboard.
export { workbenchQueues } from "./dashboard";

// Registry, exposed so admin endpoints / tooling can enumerate jobs.
export { jobs, jobsByName } from "./registry";

// Boot-time reconciliation: reset deployments stranded by a crash.
export { reconcileInterruptedDeployments } from "./reconcile";
export { inFlightDeploys, type InFlightDeploys } from "./in-flight";

// The deploy job definition itself. The control plane needs its queue name to
// pull a not-yet-started build out of the queue when an operator cancels it.
export { deployTriggeredJob } from "./jobs/deploy";

// Definition helper, exported for callers adding new jobs in apps.
export { defineJob } from "./define";
export type { JobDef, JobContext } from "./define";

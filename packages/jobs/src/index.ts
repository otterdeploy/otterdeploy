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
} from "./triggers";
export type {
  EmailPayload,
  NotificationPayload,
  DataProcessingPayload,
  UserSignupPayload,
  DeployTriggeredPayload,
} from "./triggers";

// Worker + queue lifecycle (apps/server boot/shutdown).
export { createWorkers } from "./workers";
export { getAllQueues, getQueue, closeQueues } from "./queues";

// Dashboard.
export { workbenchQueues } from "./dashboard";

// Registry — exposed so admin endpoints / tooling can enumerate jobs.
export { jobs, jobsByName } from "./registry";

// Definition helper — exported for callers adding new jobs in apps.
export { defineJob } from "./define";
export type { JobDef, JobContext } from "./define";

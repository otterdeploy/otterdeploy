import type { JobDef } from "./define";
import { dailyReportJob } from "./jobs/daily-report";
import { deployTriggeredJob } from "./jobs/deploy";
import { sendEmailJob } from "./jobs/email";
import { hourlyCleanupJob } from "./jobs/hourly-cleanup";
import { sendNotificationJob } from "./jobs/notification";
import { processDataJob } from "./jobs/process-data";
import { welcomeSequenceJob } from "./jobs/welcome-sequence";

/**
 * Single source of truth for every job. Queues, workers, and the dashboard
 * all derive from this list — add a new job by appending it here and
 * everything else picks it up automatically.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const jobs = [
  sendEmailJob,
  sendNotificationJob,
  processDataJob,
  hourlyCleanupJob,
  dailyReportJob,
  welcomeSequenceJob,
  deployTriggeredJob,
] as const satisfies ReadonlyArray<JobDef>;

/** Job name → definition lookup. */
export const jobsByName: Record<string, JobDef> = Object.fromEntries(
  jobs.map((job) => [job.name, job]),
);

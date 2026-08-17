import type { UnknownRecord } from "@otterdeploy/shared/json";
import type { JobsOptions, Job } from "bullmq";
import type { z } from "zod";

/** Logger handed to a job handler. Each method emits a structured wide event
 * with the job's name/id/attempt automatically tagged.
 *
 * Fields are `UnknownRecord` (not `JsonObject`) on purpose: this bridges to
 * evlog's global `Log`, whose wide events accept arbitrary runtime values.
 * Handlers pass live `Error` instances (e.g. `{ error: err }`) that evlog
 * serializes itself. */
export interface JobLogger {
  info(fields: UnknownRecord): void;
  warn(fields: UnknownRecord): void;
  error(fields: UnknownRecord): void;
}

/**
 * Context handed to a job handler. Wraps the raw BullMQ Job so handlers can
 * call helpers like `getChildrenValues()` (for flows) without importing
 * `bullmq` directly.
 */
export interface JobContext<TPayload> {
  /** Structured logger scoped to this job run. */
  log: JobLogger;
  /** Underlying BullMQ Job: escape hatch for advanced needs (children, etc.). */
  job: Job<TPayload>;
}

/**
 * A typed job definition. Use the `defineJob()` helper to build one. It's
 * just an identity function that locks in the generics.
 */
export interface JobDef<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Logical job name. Becomes the BullMQ queue name. */
  name: string;
  /** Zod schema for the job payload (validated on enqueue and on worker pickup). */
  schema: TSchema;
  /** Per-job default options (attempts, backoff, retention). */
  opts?: JobsOptions;
  /** What runs when the worker picks the job up. */
  handler: (payload: z.infer<TSchema>, ctx: JobContext<z.infer<TSchema>>) => Promise<unknown>;
  /**
   * Optional cron schedule (BullMQ repeatable job). When set, `createWorkers()`
   * also schedules a repeatable instance using `Queue.upsertJobScheduler()`.
   */
  cron?: {
    pattern: string;
    /** Optional IANA timezone (e.g. "UTC", "America/Los_Angeles"). */
    tz?: string;
  };
}

export function defineJob<TSchema extends z.ZodTypeAny>(def: JobDef<TSchema>): JobDef<TSchema> {
  return def;
}

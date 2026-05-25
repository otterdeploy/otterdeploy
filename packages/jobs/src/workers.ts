import { Worker, type Job } from "bullmq";
import { createError, log as globalLog } from "evlog";

import { getConnection } from "./connection";
import type { JobDef, JobContext } from "./define";
import { getQueue } from "./queues";
import { jobs } from "./registry";

/**
 * Spin up a Worker per registered job + (re)schedule any cron jobs. Returns
 * a `stop()` to call on shutdown — it drains in-flight work, closes workers,
 * and disconnects.
 */
export async function createWorkers(): Promise<{ stop: () => Promise<void> }> {
  const workers: Worker[] = [];

  for (const job of jobs) {
    const worker = createWorker(job);
    workers.push(worker);

    if (job.cron) {
      const queue = getQueue(job.name);
      await queue.upsertJobScheduler(
        `${job.name}:cron`,
        { pattern: job.cron.pattern, tz: job.cron.tz },
        {
          name: job.name,
          data: {},
          opts: job.opts,
        },
      );
    }
  }

  globalLog.info({ jobs: { event: "workers-started", count: workers.length } } as Record<
    string,
    unknown
  >);

  return {
    async stop() {
      await Promise.all(workers.map((w) => w.close()));
      globalLog.info({ jobs: { event: "workers-stopped" } } as Record<string, unknown>);
    },
  };
}

function createWorker<TDef extends JobDef>(def: TDef): Worker {
  return new Worker(
    def.name,
    async (job: Job) => {
      const parsed = def.schema.safeParse(job.data);
      if (!parsed.success) {
        throw createError({
          message: `Invalid payload for job ${def.name}`,
          status: 400,
          why: parsed.error.message,
        });
      }

      // Per-job structured log helper. Every call carries the job name + id
      // + attempt number so log lines join cleanly to a single job run.
      const log = {
        info: (fields: Record<string, unknown>) =>
          globalLog.info({
            jobs: { name: def.name, id: job.id ?? "unknown", attempt: job.attemptsMade + 1 },
            ...fields,
          } as Record<string, unknown>),
        warn: (fields: Record<string, unknown>) =>
          globalLog.warn({
            jobs: { name: def.name, id: job.id ?? "unknown", attempt: job.attemptsMade + 1 },
            ...fields,
          } as Record<string, unknown>),
        error: (fields: Record<string, unknown>) =>
          globalLog.error({
            jobs: { name: def.name, id: job.id ?? "unknown", attempt: job.attemptsMade + 1 },
            ...fields,
          } as Record<string, unknown>),
      };

      const ctx: JobContext<unknown> = { log, job: job as Job };

      try {
        return await def.handler(parsed.data, ctx);
      } catch (err) {
        log.error({ event: "handler-failed", error: err });
        throw err;
      }
    },
    {
      connection: getConnection(),
    },
  );
}

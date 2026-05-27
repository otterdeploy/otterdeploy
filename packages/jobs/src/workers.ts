import { Worker, type Job } from "bullmq";
import { createError, log as globalLog } from "evlog";

import { getConnection } from "./connection";
import type { JobDef, JobContext } from "./define";
import { getQueue } from "./queues";
import { jobs as defaultJobs } from "./registry";

/**
 * Spin up a Worker per registered job + (re)schedule any cron jobs. Returns
 * a `stop()` to call on shutdown — it drains in-flight work, closes workers,
 * and disconnects.
 *
 * `opts.jobs` overrides the default registry — used by apps that should
 * only run a subset (e.g. apps/builder runs only `deploy.triggered`,
 * apps/server runs everything else). Passing a replacement for an
 * existing job by name lets a process supply its own handler (the
 * builder rewires `deploy.triggered` to run the real build pipeline,
 * which can't live in `packages/jobs` itself).
 *
 * `opts.concurrency` sets BullMQ Worker concurrency. Default 1.
 */
export async function createWorkers(opts?: {
  jobs?: ReadonlyArray<JobDef>;
  concurrency?: number;
}): Promise<{ stop: () => Promise<void> }> {
  const workers: Worker[] = [];
  const jobList = opts?.jobs ?? defaultJobs;
  const concurrency = opts?.concurrency ?? 1;

  for (const job of jobList) {
    const worker = createWorker(job, concurrency);
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

function createWorker<TDef extends JobDef>(def: TDef, concurrency: number): Worker {
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
      concurrency,
    },
  );
}

/**
 * An image service's rollout leaves the request as a `service.rollout` job,
 * against a real Redis.
 *
 * Pins the two things a double would only imitate: the job lands on its queue
 * with the options that keep it from re-rolling a service on its own (one
 * attempt) and bound how long finished runs are kept; and the in-flight scan
 * the deployment list consults reads its deployment as OWNED, so a list read
 * cannot call the row a success while the new version is still being gated
 * (the same guard builds have).
 */
import { afterAll, describe, expect, test } from "vite-plus/test";

// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.REDIS_URL ??= "redis://localhost:6379";
// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
// oxlint-disable-next-line node/no-process-env -- test module graph setup
process.env.CORS_ORIGIN ??= "http://localhost:3000";

const { ID_PREFIX, idSchema } = await import("@otterdeploy/shared/id");
const { closeQueues, getQueue, inFlightDeploys, serviceRolloutJob, triggerServiceRollout } =
  await import("@otterdeploy/jobs");

const id = <P extends string>(prefix: P) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

afterAll(async () => {
  await closeQueues();
});

describe("service.rollout on a real queue", () => {
  test("the enqueued job carries its deployment, runs once, and owns its row", async () => {
    const deploymentId = idSchema.deployment.parse(id(ID_PREFIX.deployment));
    // Paused: nothing in this process consumes the queue, but a stray server
    // worker on the same Redis must not pick the job up mid-test either.
    const queue = getQueue(serviceRolloutJob.name);
    await queue.pause();
    try {
      await triggerServiceRollout({
        kind: "roll",
        projectId: idSchema.project.parse(id(ID_PREFIX.project)),
        organizationId: idSchema.organization.parse(id(ID_PREFIX.organization)),
        resourceId: idSchema.resource.parse(id(ID_PREFIX.resource)),
        deploymentIds: [deploymentId],
        fanOut: true,
      });

      const jobs = await queue.getJobs(["waiting", "paused"]);
      const job = jobs.find((j) => j?.data?.deploymentIds?.[0] === deploymentId);
      expect(job?.name).toBe("service.rollout");
      // Never retried: a re-run would roll the service again on its own.
      expect(job?.opts.attempts).toBe(1);
      expect(job?.opts.removeOnComplete).toEqual({ age: 60 * 60 * 24 });
      expect(job?.opts.removeOnFail).toEqual({ age: 60 * 60 * 24 * 7 });

      const inFlight = await inFlightDeploys();
      expect(inFlight.ownedIds.has(deploymentId)).toBe(true);

      await job?.remove();
      expect((await inFlightDeploys()).ownedIds.has(deploymentId)).toBe(false);
    } finally {
      await queue.resume();
    }
  });

  test("the payload names exactly one deployment, by a real deployment id", () => {
    const base = {
      kind: "create",
      projectId: id(ID_PREFIX.project),
      organizationId: id(ID_PREFIX.organization),
      resourceId: id(ID_PREFIX.resource),
      fanOut: false,
    };
    const parse = (deploymentIds: string[]) =>
      serviceRolloutJob.schema.safeParse({ ...base, deploymentIds }).success;
    expect(parse([id(ID_PREFIX.deployment)])).toBe(true);
    expect(parse([])).toBe(false);
    expect(parse([id(ID_PREFIX.deployment), id(ID_PREFIX.deployment)])).toBe(false);
    expect(parse([id(ID_PREFIX.resource)])).toBe(false);
  });
});

/**
 * The builder's verdict on a rollout the runtime did not bring up. The
 * deployment fails with the runtime's own reason, and when the runtime kept the
 * previous version serving, the service row points back at that version's
 * image so the next restart or env change does not redeploy the one that just
 * failed. The db module and the pipeline's other env-reading collaborators are
 * mocked out (dynamic import after mock.module) so `bun test` runs without
 * Postgres or a configured environment.
 */
import type { SwarmServiceRuntime } from "@otterdeploy/api/swarm";

import { idSchema } from "@otterdeploy/shared/id";
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

import type { RolloutSubject } from "../pipeline-steps";

const writes: Array<Record<string, unknown>> = [];
let failWrite = false;

let checkRollout: typeof import("../pipeline-steps").checkRollout;

beforeAll(async () => {
  // Never reached by checkRollout; stubbed only so their env never loads.
  await mock.module("@otterdeploy/api/git/github-app", () => ({ getInstallationToken: mock() }));
  await mock.module("@otterdeploy/api/notifications/emit", () => ({ emitPlatformEvent: mock() }));
  await mock.module("../deploy-hook", () => ({ runDeployHooks: mock() }));
  await mock.module("../docker-push", () => ({ dockerPush: mock() }));
  await mock.module("../load", () => ({ PipelineLoadError: class extends Error {} }));
  await mock.module("../registry-credential", () => ({ resolvePushCredentials: mock() }));
  await mock.module("../state", () => ({ markFailed: mock() }));
  await mock.module("@otterdeploy/db", () => ({
    db: {
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            if (failWrite) throw new Error("connection reset");
            writes.push(values);
          },
        }),
      }),
    },
  }));
  ({ checkRollout } = await import("../pipeline-steps"));
});

beforeEach(() => {
  writes.length = 0;
  failWrite = false;
});

const subject: RolloutSubject = {
  resource: { id: idSchema.resource.parse("res_web") },
  service: { image: "otterdeploy-local/app:old", imageDigest: "sha256:old" },
};

function runtime(overrides: Partial<SwarmServiceRuntime>): SwarmServiceRuntime {
  return {
    serviceId: "c1",
    serviceName: "acme-web",
    networkName: "otterdeploy-acme",
    status: "error",
    health: null,
    errorMessage: null,
    ...overrides,
  };
}

function sink() {
  const lines: string[] = [];
  return { lines, system: (line: string) => void lines.push(line) };
}

describe("checkRollout", () => {
  test("a running rollout passes and writes nothing", async () => {
    const verdict = await checkRollout(subject, runtime({ status: "running" }), false, sink());
    expect(verdict.isOk()).toBe(true);
    expect(writes).toEqual([]);
  });

  test("a rolled-back rollout fails with the runtime's reason and restores the previous image", async () => {
    const out = sink();
    const reason = "new version failed its healthcheck; the previous version keeps serving";
    const verdict = await checkRollout(
      subject,
      runtime({ errorMessage: reason, rolledBack: true }),
      false,
      out,
    );
    expect(verdict.isErr() && verdict.error.message).toBe(reason);
    expect(writes).toEqual([{ image: "otterdeploy-local/app:old", imageDigest: "sha256:old" }]);
    expect(out.lines.at(-1)).toContain("kept the previous version");
  });

  test("a first version that failed has nothing to keep: the row stays on the new image", async () => {
    const reason = "new version crashed: exited with code 1 before it became ready";
    const verdict = await checkRollout(
      subject,
      runtime({ errorMessage: reason, rolledBack: false }),
      false,
      sink(),
    );
    expect(verdict.isErr() && verdict.error.message).toBe(reason);
    expect(writes).toEqual([]);
  });

  test("a preview roll never rewrites the base service row", async () => {
    const verdict = await checkRollout(
      subject,
      runtime({ errorMessage: "never became ready", rolledBack: true }),
      true,
      sink(),
    );
    expect(verdict.isErr()).toBe(true);
    expect(writes).toEqual([]);
  });

  test("no reason from the runtime keeps the generic convergence message", async () => {
    const verdict = await checkRollout(subject, runtime({ health: "unhealthy" }), false, sink());
    expect(verdict.isErr() && verdict.error.message).toBe(
      "swarm convergence failed for service acme-web (health=unhealthy)",
    );
  });

  test("a failed restore is logged, and the deployment still fails with its reason", async () => {
    failWrite = true;
    const out = sink();
    const verdict = await checkRollout(
      subject,
      runtime({ errorMessage: "never became ready", rolledBack: true }),
      false,
      out,
    );
    expect(verdict.isErr() && verdict.error.message).toBe("never became ready");
    expect(out.lines.at(-1)).toContain("could not restore the previous image");
  });
});

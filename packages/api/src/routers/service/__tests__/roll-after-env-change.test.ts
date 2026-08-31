/**
 * od-eb2c: an env write on a compose child must roll the thing that owns the
 * container.
 *
 * `redeployAndFanOut` rolls ONE swarm service. A compose child's service is
 * owned by the stack's reconcile, so that update did not replace the task —
 * verified in the field, the container id was unchanged across two minutes of
 * polling — while the CLI printed "The service is rolling to pick up the
 * change." These pin which owner each shape routes to, and that a failed roll
 * still says the value WAS saved.
 */
import type { RequestLogger } from "evlog";

import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { createRequestLogger } from "evlog";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const deployCompose = vi.fn();
const redeployAndFanOut = vi.fn();

vi.mock("../../compose/deploy", () => ({ deployCompose }));
vi.mock("../redeploy", () => ({ redeployAndFanOut }));

const { rollAfterEnvChange } = await import("../roll-after-env-change");

const log: RequestLogger = createRequestLogger({ method: "TEST", path: "/env" });
const STACK_ID = idSchema.resource.parse("res_stack0000000000000000");
const base = {
  projectId: idSchema.project.parse("prj_rollenv000000000000000"),
  resourceId: idSchema.resource.parse("res_child0000000000000000"),
  projectSlug: "shared",
  log,
};

function call(stackId: typeof STACK_ID | null) {
  return rollAfterEnvChange({ ...base, stackId });
}

beforeEach(() => {
  deployCompose.mockReset();
  redeployAndFanOut.mockReset();
});

describe("rollAfterEnvChange", () => {
  test("a stack child rolls its stack, not itself", async () => {
    deployCompose.mockResolvedValue(Result.ok({}));
    expect((await call(STACK_ID)).isOk()).toBe(true);
    expect(redeployAndFanOut).not.toHaveBeenCalled();
    expect(deployCompose).toHaveBeenCalledWith(
      { projectId: base.projectId, resourceId: STACK_ID },
      "env-change",
      log,
    );
  });

  test("a standalone service keeps the single-service roll", async () => {
    redeployAndFanOut.mockResolvedValue(Result.ok(true));
    expect((await call(null)).isOk()).toBe(true);
    expect(deployCompose).not.toHaveBeenCalled();
    expect(redeployAndFanOut).toHaveBeenCalledWith(
      base.projectId,
      base.resourceId,
      base.projectSlug,
      log,
    );
  });

  test("a failed stack roll says the value was saved anyway", async () => {
    deployCompose.mockResolvedValue(Result.err(new Error("swarm unreachable")));
    const rolled = await call(STACK_ID);
    expect(rolled.isErr()).toBe(true);
    if (rolled.isOk()) return;
    expect(rolled.error._tag).toBe("StackRollFailedError");
    // The two halves have to be said separately, or a failure reads as
    // "nothing happened" and the operator retries a write that succeeded.
    expect(rolled.error.message).toContain("Saved");
    expect(rolled.error.message).toContain("swarm unreachable");
  });
});

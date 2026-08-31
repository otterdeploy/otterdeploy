/**
 * od-6h0: a resource must not be written without an environment when its
 * project has one.
 *
 * The read path treats `resource.environment_id = NULL` as the project's main
 * environment, so an unscoped row still resolves — which is exactly why this
 * kept regressing quietly. The postgres create stream was fixed for it once,
 * in its own stage, while the service and compose inserts went on writing the
 * caller's omitted value verbatim. All three now resolve through here.
 *
 * Same fluent `@otterdeploy/db` mock as the sibling query tests.
 */
import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, test, vi } from "vite-plus/test";

const PROJECT_ID = idSchema.project.parse("prj_newresenv0000000000000");
const MAIN_ENV = idSchema.environment.parse("env_main00000000000000000");
const OTHER_ENV = idSchema.environment.parse("env_other0000000000000000");

const selectSpy = vi.fn();

vi.mock("@otterdeploy/db", () => ({
  db: {
    select: (): unknown => selectSpy(),
  },
}));

const { newResourceEnvironmentId } = await import("../new-resource-environment");

/** `db.select().from().where().limit()` resolving to `rows`. */
function stubProject(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  selectSpy.mockReturnValue(chain);
  return chain;
}

describe("newResourceEnvironmentId", () => {
  test("falls back to the project's main environment when none is requested", async () => {
    stubProject([{ environmentId: MAIN_ENV }]);
    await expect(newResourceEnvironmentId(PROJECT_ID)).resolves.toBe(MAIN_ENV);
  });

  test("keeps an explicitly requested environment, without querying", async () => {
    const chain = stubProject([{ environmentId: MAIN_ENV }]);
    await expect(newResourceEnvironmentId(PROJECT_ID, OTHER_ENV)).resolves.toBe(OTHER_ENV);
    // A caller that already knows the environment must not pay for a lookup,
    // and must never be silently moved to main.
    expect(chain.from).not.toHaveBeenCalled();
  });

  test("stays null for a project that has no environment pointer at all", async () => {
    stubProject([{ environmentId: null }]);
    await expect(newResourceEnvironmentId(PROJECT_ID)).resolves.toBeNull();
  });

  test("stays null when the project row is missing", async () => {
    stubProject([]);
    await expect(newResourceEnvironmentId(PROJECT_ID)).resolves.toBeNull();
  });
});

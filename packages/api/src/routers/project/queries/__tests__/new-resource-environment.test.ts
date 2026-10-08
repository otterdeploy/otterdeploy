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

const { resolveNewResourceEnvironment, ResourceEnvironmentNotFoundError } =
  await import("../new-resource-environment");

/** `db.select().from().where().limit()` resolving to `rows`. */
function stubRows(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  selectSpy.mockReturnValue(chain);
  return chain;
}

describe("resolveNewResourceEnvironment", () => {
  test("falls back to the project's main environment when none is requested", async () => {
    stubRows([{ environmentId: MAIN_ENV }]);
    const resolved = await resolveNewResourceEnvironment(PROJECT_ID);
    expect(resolved.isOk() && resolved.value).toBe(MAIN_ENV);
  });

  test("keeps a requested environment the project owns", async () => {
    const chain = stubRows([{ id: OTHER_ENV }]);
    const resolved = await resolveNewResourceEnvironment(PROJECT_ID, OTHER_ENV);
    // Never silently moved to main: the requested environment is what comes back.
    expect(resolved.isOk() && resolved.value).toBe(OTHER_ENV);
    expect(chain.where).toHaveBeenCalledTimes(1);
  });

  // A supplied id used to be returned untouched, so an id from another
  // project, another org, or nowhere was written verbatim and stranded the row.
  test("refuses a requested environment the project does not own", async () => {
    stubRows([]);
    const resolved = await resolveNewResourceEnvironment(PROJECT_ID, OTHER_ENV);
    expect(resolved.isErr()).toBe(true);
    if (resolved.isErr()) {
      expect(resolved.error).toBeInstanceOf(ResourceEnvironmentNotFoundError);
      expect(resolved.error.environmentId).toBe(OTHER_ENV);
    }
  });

  test("stays null for a project that has no environment pointer at all", async () => {
    stubRows([{ environmentId: null }]);
    const resolved = await resolveNewResourceEnvironment(PROJECT_ID);
    expect(resolved.isOk() && resolved.value).toBeNull();
  });

  test("stays null when the project row is missing", async () => {
    stubRows([]);
    const resolved = await resolveNewResourceEnvironment(PROJECT_ID);
    expect(resolved.isOk() && resolved.value).toBeNull();
  });
});

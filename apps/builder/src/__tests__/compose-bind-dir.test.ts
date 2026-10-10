/**
 * Which host dir a compose stack's build helper mounts. The helper does not
 * mount the data folder, so whatever the stack's deploy writes for its
 * services has to be this dir or it is written into the helper and lost.
 */
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { composeRepoBindDir, resourceDir } from "@otterdeploy/shared/paths";
import { describe, expect, test } from "bun:test";

/* oxlint-disable node/no-process-env -- test env setup boundary: compose-bind-dir imports the env-validating db client (satisfy the required vars before the dynamic import below) */
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
/* oxlint-enable node/no-process-env */

const { composeBindDirFor } = await import("../compose-bind-dir");

const ref = {
  organizationId: createId(ID_PREFIX.organization),
  projectId: createId(ID_PREFIX.project),
  environmentId: null,
  resourceId: createId(ID_PREFIX.resource),
};

describe("composeBindDirFor", () => {
  test("a git stack mounts its staged repo-bind dir", () => {
    expect(composeBindDirFor({ source: "git", hasFiles: false }, ref)).toBe(
      composeRepoBindDir(ref),
    );
  });

  test("a multi-file inline stack mounts the resource dir its tree is written to", () => {
    expect(composeBindDirFor({ source: "inline", hasFiles: true }, ref)).toBe(resourceDir(ref));
  });

  test("a single-file inline stack writes nothing to the host, so mounts nothing", () => {
    expect(composeBindDirFor({ source: "inline", hasFiles: false }, ref)).toBeNull();
  });
});

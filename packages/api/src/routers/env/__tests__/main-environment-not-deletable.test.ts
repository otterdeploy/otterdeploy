/**
 * A project's MAIN environment is not a deletable object, and the emptiness
 * guard must count the rows that environment actually owns.
 *
 * Both halves of this were reachable from the shipped product — the CLI
 * (`otterdeploy env delete <name>`) and the web env collection's `onDelete`
 * both call `env.delete` with any environment the operator can see, neither
 * filtering out the project's main one.
 *
 * What went wrong, in order:
 *
 *   1. `project.environment_id` is the pointer every scoped read resolves
 *      through. `resolveEnvironmentScope` returns null when it is null, and
 *      each caller reads null as "this project has no resources".
 *   2. `deleteEnvRecord` nulled that pointer for whatever project named the
 *      environment being deleted.
 *   3. So deleting a project's main environment made the project report itself
 *      empty — in the UI, the graph and the CLI — permanently, while its
 *      containers kept running and its rows kept holding their unique-name
 *      slots. Nothing in the product sets a main pointer back.
 *
 * And the guard that should have caught step 3 could not, because it counted
 * ownership with `environment_id = ?` while the read path defines a main
 * environment as owning `environment_id = ? OR environment_id IS NULL`. Rows
 * with a null stamp exist (the service and compose inserts wrote them before
 * `newResourceEnvironmentId` landed), so for such a project the main
 * environment measured as empty.
 */
import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../queries", () => ({
  getEnvInOrg: vi.fn(),
  deleteEnvRecord: vi.fn(),
  createEnvRecord: vi.fn(),
  listEnvsByOrg: vi.fn(),
}));

import { deleteEnv } from "../handlers";
import * as queries from "../queries";

const environmentId = idSchema.environment.parse("env_main");
const organizationId = idSchema.organization.parse("org_1");

describe("deleteEnv, for a project's main environment", () => {
  it("refuses with its own error, distinct from a cascade-resolvable conflict", async () => {
    vi.mocked(queries.deleteEnvRecord).mockResolvedValue({ ok: false, reason: "is-main" });

    const result = await deleteEnv({ id: environmentId, organizationId });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    // Not EnvironmentNotEmptyError: that one tells the operator to re-send with
    // `cascade`, and no cascade makes this succeed. Not NotFound either — the
    // environment plainly exists. The operator's next action is "delete the
    // project", so the error has to say that itself.
    expect(result.error._tag).toBe("EnvironmentIsMainError");
    expect(result.error.message).toMatch(/main environment/i);
  });

  it("refuses even when the caller passed cascade, because cascade is not the fix", async () => {
    vi.mocked(queries.deleteEnvRecord).mockResolvedValue({ ok: false, reason: "is-main" });

    const result = await deleteEnv({ id: environmentId, organizationId, cascade: true });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error._tag).toBe("EnvironmentIsMainError");
  });
});

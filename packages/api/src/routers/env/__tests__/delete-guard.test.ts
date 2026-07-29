import type { EnvironmentId, OrganizationId } from "@otterdeploy/shared/id";

import { describe, expect, it, vi } from "vite-plus/test";

// The queries layer is the DB boundary; the guard being tested lives above it.
vi.mock("../queries", () => ({
  getEnvInOrg: vi.fn(),
  deleteEnvRecord: vi.fn(),
  createEnvRecord: vi.fn(),
  listEnvsByOrg: vi.fn(),
  listResourcesInEnvironment: vi.fn(),
}));

import { deleteEnv } from "../handlers";
import * as queries from "../queries";

const environmentId = "env_1" as EnvironmentId;
const organizationId = "org_1" as OrganizationId;

/**
 * A resource whose `environment_id` no longer resolves matches NO scope query —
 * it is not base (the column is non-null) and its environment is gone. It
 * disappears from every list and graph while its container keeps running. These
 * pin that the delete refuses rather than creating that state.
 */

describe("deleteEnv", () => {
  it("surfaces a not-empty refusal as its own error, not as not-found", () => {
    vi.mocked(queries.deleteEnvRecord).mockResolvedValue({
      ok: false,
      reason: "has-resources",
    } as never);

    return deleteEnv({ id: environmentId, organizationId }).then((result) => {
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        // Distinguishable, because the operator's next action differs: one is
        // "confirm the cascade", the other is "this never existed".
        expect(result.error._tag).toBe("EnvironmentNotEmptyError");
      }
    });
  });

  it("still reports a missing environment as not-found", async () => {
    vi.mocked(queries.deleteEnvRecord).mockResolvedValue({
      ok: false,
      reason: "not-found",
    } as never);

    const result = await deleteEnv({ id: environmentId, organizationId });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error._tag).toBe("EnvironmentNotFoundError");
  });

  it("passes cascade through so an explicit confirmation actually deletes", async () => {
    vi.mocked(queries.deleteEnvRecord).mockResolvedValue({
      ok: true,
      id: environmentId,
    } as never);

    const result = await deleteEnv({ id: environmentId, organizationId, cascade: true });
    expect(result.isOk()).toBe(true);
    expect(vi.mocked(queries.deleteEnvRecord)).toHaveBeenCalledWith(
      expect.objectContaining({ cascade: true }),
    );
  });

  it("does not send cascade when the caller did not ask for it", async () => {
    vi.mocked(queries.deleteEnvRecord).mockResolvedValue({
      ok: true,
      id: environmentId,
    } as never);

    await deleteEnv({ id: environmentId, organizationId });
    expect(vi.mocked(queries.deleteEnvRecord)).toHaveBeenCalledWith(
      expect.objectContaining({ cascade: undefined }),
    );
  });
});

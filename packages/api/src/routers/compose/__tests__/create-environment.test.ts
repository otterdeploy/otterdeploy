/**
 * `compose.create` stamped every stack with the project's MAIN environment and
 * named it with no environment suffix, whatever environment it was created
 * for. A stack created for staging landed in production, and given staging
 * would have collided with production's stack name and shared its volumes
 * (both derive from the stack name). It now lands where it was asked to, with
 * that environment's suffix, the same rule the manifest apply follows.
 */
import type { RequestLogger } from "evlog";

import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const MAIN = "env_main";
const STAGING = "env_staging";

const createComposeRecord = vi.hoisted(() =>
  vi.fn(async (input: { environmentId?: string | null; stackName: string }) => ({
    resource: { id: "res_stack", ...input },
  })),
);

vi.mock("../queries", () => ({ createComposeRecord }));
vi.mock("../deploy", () => ({
  deployCompose: async () => Result.ok({ status: "running", deployed: 1, failed: [] }),
}));
vi.mock("../../project/queries", () => ({
  getProjectInOrg: async () => ({ id: "prj_1", slug: "acme", environmentId: MAIN }),
}));
vi.mock("../../project/queries/new-resource-environment", () => ({
  resolveNewResourceEnvironment: async (_projectId: string, requested?: string | null) =>
    Result.ok(requested ?? MAIN),
}));
vi.mock("../../../lib/environment/runtime-scope", () => ({
  resolveRuntimeScope: async (row: { environmentId: string | null }) =>
    row.environmentId === STAGING
      ? { kind: "environment", slug: "staging", isMain: false }
      : { kind: "base" },
}));

const { createComposeResource } = await import("../create");

const log: RequestLogger = {
  set: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  emit: () => null,
  getContext: () => ({}),
};

const create = (environmentId?: string) =>
  createComposeResource({
    input: {
      projectId: idSchema.project.parse("prj_1"),
      environmentId: environmentId ? idSchema.environment.parse(environmentId) : undefined,
      name: "probe",
      source: "inline",
      composeContent: "services:\n  whoami:\n    image: traefik/whoami\n",
      variables: [],
      exposed: [],
      deploy: true,
    },
    organizationId: idSchema.organization.parse("org_1"),
    log,
  });

beforeEach(() => createComposeRecord.mockClear());

describe("compose.create environment", () => {
  it("creates the stack in the requested environment, with its suffix", async () => {
    const result = await create(STAGING);
    expect(result.isOk()).toBe(true);
    expect(createComposeRecord).toHaveBeenCalledWith(
      expect.objectContaining({ environmentId: STAGING, stackName: "acme-probe-staging" }),
    );
  });

  it("keeps main, and main's stack name, when no environment is given", async () => {
    await create();
    expect(createComposeRecord).toHaveBeenCalledWith(
      expect.objectContaining({ environmentId: MAIN, stackName: "acme-probe" }),
    );
  });
});

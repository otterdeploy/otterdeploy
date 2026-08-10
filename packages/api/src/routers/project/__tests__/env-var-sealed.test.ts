/**
 * od-5j8.12: hostile-path coverage: a sealed project env var's real value
 * (plaintext OR ciphertext) must never reach an RPC response, on ANY read
 * path this handler layer exposes: list, the echo from a fresh upsert, and
 * bulk-replace. `../queries/project-env.ts` (the actual encrypt-on-write +
 * DB layer) is exercised directly in `service-env-sealed.test.ts`'s sibling
 * query-layer coverage; this file proves the masking contract in
 * `../env-var.ts` holds even if the query layer ever forgot to (defense in
 * depth: belt AND suspenders).
 */
import type { EnvironmentId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { describe, expect, test, vi } from "vite-plus/test";

// env-var.ts pulls EVERYTHING (getProjectInOrg + the env-var CRUD) from the
// same "./queries" barrel: one mock covers the whole subject.
vi.mock("../queries", () => ({
  getProjectInOrg: vi.fn(),
  bulkReplaceProjectEnvVars: vi.fn(),
  deleteProjectEnvVar: vi.fn(),
  listProjectEnvVars: vi.fn(),
  upsertProjectEnvVar: vi.fn(),
}));

import type { ProjectEnvVarRow } from "../queries";

import {
  bulkReplaceProjectEnvVarsForOrg,
  listProjectEnvVarsForOrg,
  upsertProjectEnvVarForOrg,
} from "../env-var";
import * as queries from "../queries";

const projectId = "project_test" as ProjectId;
const environmentId = "env_test" as EnvironmentId;
const organizationId = "org_test" as OrganizationId;

function sealedRow(overrides: Partial<ProjectEnvVarRow> = {}): ProjectEnvVarRow {
  return {
    id: "pev_1" as ProjectEnvVarRow["id"],
    projectId,
    environmentId,
    key: "API_SECRET",
    // Whatever the query layer stored. A real hostile test doesn't get to
    // assume it's ciphertext; it must be masked regardless of content.
    value: "v2:env-vars:1:AAAA:BBBB",
    isSecret: true,
    sealed: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("sealed project env vars never leak through env-var.ts's read paths", () => {
  test('list masks a sealed row\'s value to ""', async () => {
    vi.mocked(queries.getProjectInOrg).mockResolvedValue({ id: projectId } as never);
    vi.mocked(queries.listProjectEnvVars).mockResolvedValue([sealedRow()]);

    const result = await listProjectEnvVarsForOrg({ projectId, environmentId, organizationId });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.value).toBe("");
    expect(result.value[0]?.sealed).toBe(true);
  });

  test("list leaves a NON-sealed row's value untouched (masking is scoped)", async () => {
    vi.mocked(queries.getProjectInOrg).mockResolvedValue({ id: projectId } as never);
    vi.mocked(queries.listProjectEnvVars).mockResolvedValue([
      sealedRow({ key: "PLAIN", value: "hello", sealed: false }),
    ]);

    const result = await listProjectEnvVarsForOrg({ projectId, environmentId, organizationId });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value[0]?.value).toBe("hello");
  });

  test("upsert's own response masks the row when the final state is sealed", async () => {
    vi.mocked(queries.getProjectInOrg).mockResolvedValue({ id: projectId } as never);
    // The query layer is the one that actually encrypts; simulate its
    // contract (returns the sealed row with `value` = ciphertext) and prove
    // the handler still refuses to echo it back, even on the write that
    // just set it. A "set" response is not a "reveal" oracle.
    vi.mocked(queries.upsertProjectEnvVar).mockResolvedValue(
      sealedRow({ value: "v2:env-vars:1:CCCC:DDDD" }),
    );

    const result = await upsertProjectEnvVarForOrg({
      projectId,
      environmentId,
      organizationId,
      key: "API_SECRET",
      value: "the-plaintext-i-just-sent",
      sealed: true,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.value).toBe("");
  });

  test("bulk-replace masks every sealed row in the returned set", async () => {
    vi.mocked(queries.getProjectInOrg).mockResolvedValue({ id: projectId } as never);
    vi.mocked(queries.bulkReplaceProjectEnvVars).mockResolvedValue([
      sealedRow({ key: "SEALED_ONE", sealed: true }),
      sealedRow({ key: "PLAIN_ONE", value: "visible", sealed: false }),
    ]);

    const result = await bulkReplaceProjectEnvVarsForOrg({
      projectId,
      environmentId,
      organizationId,
      vars: [{ key: "PLAIN_ONE", value: "visible" }],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const byKey = Object.fromEntries(result.value.map((r) => [r.key, r.value]));
    expect(byKey.SEALED_ONE).toBe("");
    expect(byKey.PLAIN_ONE).toBe("visible");
  });
});

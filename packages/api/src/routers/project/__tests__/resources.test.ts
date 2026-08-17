import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, test, vi } from "vite-plus/test";

// Stub the query layer the subject pulls from `./queries`. Each test sets the
// per-call behaviour via `vi.mocked(...).mockResolvedValue(...)`.
vi.mock("../queries", () => ({
  getProjectInOrg: vi.fn(),
  getResourceById: vi.fn(),
  deleteResourceById: vi.fn(),
  listProjectResources: vi.fn(),
}));

import * as queries from "../queries";
// Subject-under-test imports
import { deleteProjectResource, getProjectResource, listProjectResources } from "../resources";

type OrgId = OrganizationId;

const projectId: ProjectId = idSchema.project.parse("prj_test");
const resourceId: ResourceId = idSchema.resource.parse("res_test");
const organizationId: OrgId = idSchema.organization.parse("org_test");

/** Full project row fixture matching `getProjectInOrg`'s drizzle select shape. */
const projectRow: NonNullable<Awaited<ReturnType<typeof queries.getProjectInOrg>>> = {
  id: projectId,
  organizationId,
  name: "p",
  slug: "p",
  environmentId: null,
  stackFile: null,
  stackFileVersion: 0,
  lastAppliedFile: null,
  lastAppliedAt: null,
  manifest: null,
  manifestVersion: 0,
  lastAppliedManifest: null,
  lastManifestAppliedAt: null,
  customDomain: null,
  customDomainVerifiedAt: null,
  customDomainVerifyToken: null,
  nixpacksConfig: null,
  graphLayout: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("listProjectResources", () => {
  test("returns NOT_FOUND error when project does not exist", async () => {
    vi.mocked(queries.getProjectInOrg).mockResolvedValue(undefined);
    vi.mocked(queries.listProjectResources).mockResolvedValue({
      databases: [],
      services: [],
      composes: [],
    });
    const result = await listProjectResources({ projectId, organizationId });
    expect(result.isErr()).toBe(true);
  });
});

describe("getProjectResource", () => {
  test("returns NOT_FOUND when project missing", async () => {
    vi.mocked(queries.getProjectInOrg).mockResolvedValue(undefined);
    vi.mocked(queries.getResourceById).mockResolvedValue(null);
    const result = await getProjectResource({
      projectId,
      resourceId,
      organizationId,
    });
    expect(result.isErr()).toBe(true);
  });
});

describe("deleteProjectResource", () => {
  test("returns NOT_FOUND when resource missing", async () => {
    vi.mocked(queries.getProjectInOrg).mockResolvedValue(projectRow);
    vi.mocked(queries.getResourceById).mockResolvedValue(null);
    vi.mocked(queries.deleteResourceById).mockResolvedValue(undefined);
    const log: RequestLogger = {
      set: () => {},
      error: () => {},
      info: () => {},
      warn: () => {},
      emit: () => null,
      getContext: () => ({}),
    };
    const result = await deleteProjectResource({ projectId, resourceId, organizationId }, log);
    expect(result.isErr()).toBe(true);
  });
});

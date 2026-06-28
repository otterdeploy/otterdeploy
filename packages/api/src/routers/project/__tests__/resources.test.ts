import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { describe, expect, test, vi } from "vitest";

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

const projectId = "project_test" as ProjectId;
const resourceId = "resource_test" as ResourceId;
const organizationId = "org_test" as OrgId;

describe("listProjectResources", () => {
  test("returns NOT_FOUND error when project does not exist", async () => {
    vi.mocked(queries.getProjectInOrg).mockResolvedValue(undefined);
    vi.mocked(queries.listProjectResources).mockResolvedValue({ databases: [] } as never);
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
    vi.mocked(queries.getProjectInOrg).mockResolvedValue({ id: projectId, slug: "p" } as never);
    vi.mocked(queries.getResourceById).mockResolvedValue(null);
    vi.mocked(queries.deleteResourceById).mockResolvedValue(undefined as never);
    const log = { set: () => {} } as never;
    const result = await deleteProjectResource({ projectId, resourceId, organizationId }, log);
    expect(result.isErr()).toBe(true);
  });
});

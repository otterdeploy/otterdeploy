import { describe, expect, mock, test } from "bun:test";

import type { Id, ID_PREFIX as IDP } from "@otterstack/shared/id";

// Subject-under-test imports
import {
  deleteProjectResource,
  getProjectResource,
  listProjectResources,
} from "../resources";

type ProjectId = Id<typeof IDP.project>;
type ResourceId = Id<typeof IDP.resource>;
type OrgId = Id<typeof IDP.organization>;

const projectId = "project_test" as ProjectId;
const resourceId = "resource_test" as ResourceId;
const organizationId = "org_test" as OrgId;

describe("listProjectResources", () => {
  test("returns NOT_FOUND error when project does not exist", async () => {
    mock.module("../queries", () => ({
      getProjectInOrg: async () => null,
      listProjectResources: async () => ({ databases: [] }),
    }));
    const result = await listProjectResources({ projectId, organizationId });
    expect(result.isErr()).toBe(true);
  });
});

describe("getProjectResource", () => {
  test("returns NOT_FOUND when project missing", async () => {
    mock.module("../queries", () => ({
      getProjectInOrg: async () => null,
      getResourceById: async () => null,
    }));
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
    mock.module("../queries", () => ({
      getProjectInOrg: async () => ({ id: projectId, slug: "p" }),
      getResourceById: async () => null,
      deleteResourceById: async () => undefined,
    }));
    const log = { set: () => {} } as never;
    const result = await deleteProjectResource(
      { projectId, resourceId, organizationId },
      log,
    );
    expect(result.isErr()).toBe(true);
  });
});

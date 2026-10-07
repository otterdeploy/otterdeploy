import type { ResourceId } from "@otterdeploy/shared/id";

/**
 * An update with nothing for the service row itself.
 *
 * A second `otterdeploy deploy` of an upload service that only moved its port
 * reached `updateServiceRecord` with no row column to change (ports live in
 * service_port). Drizzle refuses an empty SET ("No values to set"), so the
 * apply died with INTERNAL_SERVER_ERROR and no deployment was recorded. The
 * row now stands as it is and is returned.
 */
import { db } from "@otterdeploy/db";
import { serviceResource } from "@otterdeploy/db/schema/project";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { seedOrganization, seedProject, seedService } from "../../../__tests__/postgres-seed";
import { updateServiceRecord } from "../queries/service";

let resourceId: ResourceId;

beforeAll(async () => {
  const organizationId = await seedOrganization("empty-patch");
  const project = await seedProject(organizationId);
  ({ resourceId } = await seedService({
    projectId: project.projectId,
    environmentId: project.mainEnvironmentId,
    name: "web",
  }));
});

async function storedRow() {
  const [row] = await db
    .select()
    .from(serviceResource)
    .where(eq(serviceResource.resourceId, resourceId));
  return row;
}

describe("updateServiceRecord with no column to change", () => {
  it("returns the row unchanged instead of throwing", async () => {
    const before = await storedRow();
    expect(before).toBeDefined();
    expect(await updateServiceRecord(resourceId, {})).toEqual(before);
    expect(await updateServiceRecord(resourceId, { image: undefined })).toEqual(before);
    expect(await storedRow()).toEqual(before);
  });

  it("still writes a real change", async () => {
    const updated = await updateServiceRecord(resourceId, { image: "otterdeploy-local/web:built" });
    expect(updated?.image).toBe("otterdeploy-local/web:built");
  });
});

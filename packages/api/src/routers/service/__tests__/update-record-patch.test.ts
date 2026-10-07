/**
 * A resources patch clears a limit with an explicit null, for CPU like every
 * other limit. The CPU columns dropped null, so neither the Scaling card's
 * "no limit" nor a manifest removing `cpuLimit` could clear a stored cap, and
 * the manifest diff would re-stage that change forever.
 */
import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import { toUpdateRecordPatch } from "../inputs";

const ref = {
  projectId: idSchema.project.parse("prj_1"),
  organizationId: idSchema.organization.parse("org_1"),
  resourceId: idSchema.resource.parse("res_1"),
};

describe("toUpdateRecordPatch resources", () => {
  it("clears CPU limit and reservation on an explicit null", () => {
    const patch = toUpdateRecordPatch({
      ...ref,
      resources: { cpuLimit: null, cpuReservation: null, memoryLimitMb: null },
    });
    expect(patch.cpuLimit).toBeNull();
    expect(patch.cpuReservation).toBeNull();
    expect(patch.memoryLimitMb).toBeNull();
  });

  it("writes a CPU value as the numeric column's string and leaves an omitted one alone", () => {
    const patch = toUpdateRecordPatch({ ...ref, resources: { cpuLimit: 1.5 } });
    expect(patch.cpuLimit).toBe("1.5");
    expect(patch.cpuReservation).toBeUndefined();
    expect(toUpdateRecordPatch({ ...ref }).cpuLimit).toBeUndefined();
  });
});

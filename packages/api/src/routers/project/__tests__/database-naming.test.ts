/**
 * od-jwx: a database's container and volume names get ONE origin.
 *
 * They were recomputed from {engine, projectSlug, resourceName} at 78 call
 * sites, so there was nowhere to make the name environment-aware and a staging
 * `postgres` collided with production's. `database_resource.service_name` /
 * `volume_name` are now written once at create and preferred everywhere.
 *
 * The fallback is the whole safety argument, and it is what these pin. It is
 * byte-identical to what produced today's names, so a row that predates the
 * column keeps addressing the container it already has — no backfill, and
 * nothing to get wrong in SQL. Landing the column had to be a no-op; only the
 * later env-scoping step changes a name.
 */
import { describe, expect, it } from "vite-plus/test";

import { buildContainerName, buildVolumeName } from "../view-helpers";

const base = { engine: "postgres", projectSlug: "shared", resourceName: "postgres" } as const;

describe("database naming", () => {
  it("computes the historical name when nothing is stored", () => {
    expect(buildContainerName(base)).toBe("otterdeploy-pg-shared-postgres");
    expect(buildVolumeName(base)).toBe("otterdeploy-pgdata-shared-postgres");
  });

  it("is unchanged by an explicitly absent stored value", () => {
    // A pre-column row reads as null, and must not become a different name.
    expect(buildContainerName({ ...base, stored: null })).toBe("otterdeploy-pg-shared-postgres");
    expect(buildContainerName({ ...base, stored: undefined })).toBe(
      "otterdeploy-pg-shared-postgres",
    );
  });

  it("prefers the stored name outright", () => {
    // This is the seam env-scoping will use: the stored name need not be
    // derivable from the inputs at all.
    expect(buildContainerName({ ...base, stored: "otterdeploy-pg-shared-postgres-staging" })).toBe(
      "otterdeploy-pg-shared-postgres-staging",
    );
    expect(buildVolumeName({ ...base, stored: "otterdeploy-pgdata-shared-pg-staging" })).toBe(
      "otterdeploy-pgdata-shared-pg-staging",
    );
  });

  it("treats an empty stored value as absent rather than as a name", () => {
    // An empty container name would address nothing at all.
    expect(buildContainerName({ ...base, stored: "" })).toBe("otterdeploy-pg-shared-postgres");
  });

  it("keeps each engine's prefix", () => {
    expect(buildContainerName({ ...base, engine: "redis" })).toBe(
      "otterdeploy-redis-shared-postgres",
    );
    expect(buildVolumeName({ ...base, engine: "mongodb" })).toBe(
      "otterdeploy-mongodata-shared-postgres",
    );
  });
});

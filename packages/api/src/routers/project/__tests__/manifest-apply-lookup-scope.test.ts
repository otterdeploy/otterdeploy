/**
 * The apply must resolve an EXISTING resource within the environment it is
 * applying to.
 *
 * Resource names are unique per environment, not per project, so `api-prod`
 * names one row in staging and a different row in production. The lookups used
 * to match on (project, name) alone with no ORDER BY, so they returned
 * whichever row Postgres happened to reach first, and the apply wrote the
 * environment it had resolved the manifest FOR onto a resource belonging to the
 * other one.
 *
 * The failure was silent and symmetrical: staging's overrides landed on
 * production and production's base values landed on staging, leaving both
 * environments serving each other's configuration. It surfaced as an API on the
 * production domain running the staging database URL, CORS list and auth URL.
 *
 * These tests render the WHERE clause the lookup actually builds, so the
 * environment predicate cannot quietly go missing again.
 */

import type { SQL } from "drizzle-orm";

import { idSchema } from "@otterdeploy/shared/id";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vite-plus/test";

const captured: { where?: SQL } = {};

vi.mock("@otterdeploy/db", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: (condition: SQL) => {
      captured.where = condition;
      return chain;
    },
    limit: () => Promise.resolve([]),
  };
  return { db: chain };
});

const { lookupDatabaseId, lookupServiceId } = await import("../manifest-apply-support");

const PROJECT = idSchema.project.parse("prj_one");
const STAGING = idSchema.environment.parse("env_staging");
const PRODUCTION = idSchema.environment.parse("env_production");

const dialect = new PgDialect();

async function whereFor(
  lookup: typeof lookupServiceId,
  scope: { environmentId: typeof STAGING; isMain: boolean },
) {
  captured.where = undefined;
  await lookup(PROJECT, "api-prod", scope);
  const where = captured.where;
  if (!where) throw new Error("the lookup built no WHERE clause at all");
  return dialect.sqlToQuery(where);
}

describe("apply resolves an existing resource within its environment", () => {
  it("filters services by the environment being applied", async () => {
    const q = await whereFor(lookupServiceId, { environmentId: STAGING, isMain: false });
    expect(q.sql).toContain('"resource"."environment_id"');
    expect(q.params).toContain(STAGING);
  });

  // The bug itself: two environments, same service name, different rows. If
  // the predicates match, the lookup cannot tell the two apart and the apply
  // writes to whichever one the database returns.
  it("builds a different predicate per environment", async () => {
    const staging = await whereFor(lookupServiceId, {
      environmentId: STAGING,
      isMain: false,
    });
    const production = await whereFor(lookupServiceId, {
      environmentId: PRODUCTION,
      isMain: false,
    });
    expect(staging.params).not.toEqual(production.params);
  });

  // Main additionally owns every row that predates environments (no stamp).
  // A non-main environment must NOT inherit those, or staging resolves
  // production's unstamped resources and the swap comes back by another route.
  it("only main inherits unstamped rows", async () => {
    const main = await whereFor(lookupServiceId, { environmentId: PRODUCTION, isMain: true });
    const staging = await whereFor(lookupServiceId, {
      environmentId: STAGING,
      isMain: false,
    });
    expect(main.sql).toContain("is null");
    expect(staging.sql).not.toContain("is null");
  });

  it("scopes database lookups the same way", async () => {
    const q = await whereFor(lookupDatabaseId, { environmentId: STAGING, isMain: false });
    expect(q.sql).toContain('"resource"."environment_id"');
    expect(q.params).toContain(STAGING);
  });
});

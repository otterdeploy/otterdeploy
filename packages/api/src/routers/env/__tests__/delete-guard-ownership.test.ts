/**
 * The environment-delete emptiness guard must measure ownership the way the
 * READ path defines it, or it reports "empty" for an environment that owns rows.
 *
 * `inEnvironmentScope` (project/queries/resource.ts) is that definition, and it
 * is asymmetric: a MAIN environment owns both the rows stamped with its id AND
 * every row whose `environment_id` is null, because null has always meant "the
 * project's main environment" on the read side. A non-main environment owns only
 * what explicitly names it.
 *
 * The guard used to hand-write `environment_id = ?`, which silently equals the
 * non-main half of that. Null-stamped rows do exist — the service and compose
 * inserts wrote them before `newResourceEnvironmentId` centralized the rule —
 * so for a project holding any of them the main environment measured as empty
 * and the guard never fired for exactly the rows deletion would strand.
 *
 * These render the predicates with drizzle's dialect (no database needed) and
 * pin the asymmetry, so a future edit that "simplifies" either side back to a
 * bare equality fails here.
 */
import { idSchema } from "@otterdeploy/shared/id";
import { PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

import { inEnvironmentScope } from "../../project/queries/resource";

const dialect = new PgDialect();
const environmentId = idSchema.environment.parse("env_1");

function render(isMain: boolean): string {
  const predicate = inEnvironmentScope({ environmentId, isMain });
  if (!predicate) throw new Error("inEnvironmentScope returned no predicate for a real scope");
  return dialect.sqlToQuery(predicate).sql;
}

describe("environment ownership, as the read path defines it", () => {
  it("a main environment owns its stamped rows AND the unstamped ones", () => {
    const sql = render(true);
    expect(sql).toContain('"resource"."environment_id" = $1');
    // The half the delete guard was missing. Without it, a project whose rows
    // predate `newResourceEnvironmentId` looks empty to the guard.
    expect(sql).toContain('"resource"."environment_id" is null');
    expect(sql).toMatch(/\bor\b/);
  });

  it("a non-main environment owns only what names it, never the unstamped rows", () => {
    const sql = render(false);
    expect(sql).toContain('"resource"."environment_id" = $1');
    // Claiming null rows here would make a staging environment appear to own
    // production's resources, and cascade-delete them.
    expect(sql).not.toContain("is null");
  });

  it("the two are genuinely different predicates, so the guard cannot use one for the other", () => {
    expect(render(true)).not.toBe(render(false));
  });

  it("the delete guard resolves ownership through inEnvironmentScope, not a hand-written equality", () => {
    const source = readFileSync(
      resolve(fileURLToPath(new URL(".", import.meta.url)), "../queries.ts"),
      "utf8",
    );
    const guard = source.slice(
      source.indexOf("async function listResourcesInEnvironment"),
      source.indexOf("async function isMainEnvironmentOfAProject"),
    );
    expect(guard).toContain("inEnvironmentScope(");
    // A bare `eq(resource.environmentId, …)` here is the original bug.
    expect(guard).not.toMatch(/eq\(\s*resource\.environmentId/);
  });
});

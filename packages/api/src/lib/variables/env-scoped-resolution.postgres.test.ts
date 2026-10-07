/**
 * A `${{…}}` reference resolves inside the environment of the service that
 * holds it.
 *
 * Resources in a non-main environment reuse the base name on purpose (the
 * partial unique indexes on `resource` are per environment), so
 * `${{db.PGHOST}}` means "this environment's db". Every lookup on the
 * resolution path is pinned to the caller's environment:
 *
 *   - `resolveResourceForPreview` (routers/service/queries/env.ts) for a
 *     `${{name.X}}` reference.
 *   - `resolveServiceEnv` (./resolver.ts) for the `${{environment.X}}` bag,
 *     read from the service's own environment, not the project's main one.
 *   - `getComposeStackByName` (routers/service/queries/stack.ts) for a
 *     `${{<stack>.<svc>.X}}` reference.
 *   - `loadRefTable` (routers/project/manifest-apply-refs.ts) for the ref
 *     table of an environment-scoped manifest apply.
 *
 * Row order must not decide the answer, so every name-collision case runs
 * twice: once with production's row written first, once with staging's.
 *
 * Real Postgres, real record creators, real resolver. The controls prove the
 * seeded rows resolve at all, so a scoping case fails on scoping, not on setup.
 */
import type { EnvironmentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { describe, expect, it } from "vite-plus/test";

import {
  seedDatabase,
  seedEnvironment,
  seedOrganization,
  seedProject,
  seedService,
  uniq,
} from "../../__tests__/postgres-seed";
import { createComposeRecord } from "../../routers/compose/queries";
import { loadRefTable, makeEnvRefResolver } from "../../routers/project/manifest-apply-refs";
import { upsertProjectEnvVar } from "../../routers/project/queries/project-env";
import { upsertServiceEnvVar } from "../../routers/service/queries";
import { resolveServiceEnv } from "./resolver";

type Order = "production-first" | "staging-first";
const ORDERS: Order[] = ["production-first", "staging-first"];

interface TwoEnvProject {
  projectId: ProjectId;
  production: EnvironmentId;
  staging: EnvironmentId;
}

async function twoEnvProject(): Promise<TwoEnvProject> {
  const organizationId = await seedOrganization("envscope");
  const { projectId, mainEnvironmentId } = await seedProject(organizationId);
  const staging = await seedEnvironment(projectId, `staging-${uniq()}`);
  return { projectId, production: mainEnvironmentId, staging };
}

/** Both environments, tagged, in the order their rows should be written. */
function inOrder(p: TwoEnvProject, order: Order): Array<[EnvironmentId, "prod" | "stg"]> {
  const production: [EnvironmentId, "prod"] = [p.production, "prod"];
  const staging: [EnvironmentId, "stg"] = [p.staging, "stg"];
  return order === "production-first" ? [production, staging] : [staging, production];
}

/** `db` in both environments, written in `order`. Returns each side's host. */
async function sameNamedDatabases(p: TwoEnvProject, order: Order) {
  const hosts = { prod: "", stg: "" };
  for (const [environmentId, tag] of inOrder(p, order)) {
    const created = await seedDatabase({ projectId: p.projectId, environmentId, name: "db", tag });
    hosts[tag] = created.host;
  }
  return hosts;
}

async function resolvedKey(projectId: ProjectId, serviceId: ResourceId, key: string) {
  const resolved = await resolveServiceEnv(projectId, serviceId);
  if (resolved.isErr()) throw new Error(`resolveServiceEnv: ${resolved.error.message}`);
  return resolved.value[key];
}

async function serviceWithEnv(
  p: TwoEnvProject,
  environmentId: EnvironmentId,
  env: Record<string, string>,
): Promise<ResourceId> {
  const svc = await seedService({ projectId: p.projectId, environmentId, name: "api" });
  for (const [key, value] of Object.entries(env)) {
    await upsertServiceEnvVar({ serviceResourceId: svc.resourceId, key, value });
  }
  return svc.resourceId;
}

describe("name references resolve within the caller's environment", () => {
  it("a staging service resolves ${{db.PGHOST}} to staging's db, whichever row was written first", async () => {
    for (const order of ORDERS) {
      const p = await twoEnvProject();
      const hosts = await sameNamedDatabases(p, order);
      const api = await serviceWithEnv(p, p.staging, { DB_HOST: "${{db.PGHOST}}" });
      expect(await resolvedKey(p.projectId, api, "DB_HOST"), order).toBe(hosts.stg);
    }
  });

  it("a production service resolves ${{db.PGHOST}} to production's db, never staging's", async () => {
    for (const order of ORDERS) {
      const p = await twoEnvProject();
      const hosts = await sameNamedDatabases(p, order);
      const api = await serviceWithEnv(p, p.production, { DB_HOST: "${{db.PGHOST}}" });
      expect(await resolvedKey(p.projectId, api, "DB_HOST"), order).toBe(hosts.prod);
    }
  });

  // Control: a name that exists only in the caller's environment resolves,
  // so the cases above fail on scoping, not on setup.
  it("a staging service resolves a db that exists only in staging", async () => {
    const p = await twoEnvProject();
    const only = await seedDatabase({
      projectId: p.projectId,
      environmentId: p.staging,
      name: "db",
      tag: "stg",
    });
    const api = await serviceWithEnv(p, p.staging, { DB_HOST: "${{db.PGHOST}}" });
    expect(await resolvedKey(p.projectId, api, "DB_HOST")).toBe(only.host);
  });
});

describe("the environment variable bag is the caller's environment's", () => {
  async function bagProject() {
    const p = await twoEnvProject();
    for (const [environmentId, value] of [
      [p.production, "https://api.example.com"],
      [p.staging, "https://staging-api.example.com"],
    ] as const) {
      await upsertProjectEnvVar({
        scope: { projectId: p.projectId, environmentId },
        key: "API_URL",
        value,
        isSecret: false,
      });
    }
    return p;
  }

  it("a staging service reads ${{environment.API_URL}} from the staging environment", async () => {
    const p = await bagProject();
    const web = await serviceWithEnv(p, p.staging, { API: "${{environment.API_URL}}" });
    expect(await resolvedKey(p.projectId, web, "API")).toBe("https://staging-api.example.com");
  });

  // Control: production's own bag resolves.
  it("a production service reads ${{environment.API_URL}} from production", async () => {
    const p = await bagProject();
    const web = await serviceWithEnv(p, p.production, { API: "${{environment.API_URL}}" });
    expect(await resolvedKey(p.projectId, web, "API")).toBe("https://api.example.com");
  });
});

describe("stack references resolve within the caller's environment", () => {
  /** A compose stack named `autumn` with a `db` child, in one environment. */
  async function stackIn(p: TwoEnvProject, environmentId: EnvironmentId, tag: string) {
    const stack = await createComposeRecord({
      projectId: p.projectId,
      environmentId,
      name: "autumn",
      source: "inline",
      composeContent: "services:\n  db:\n    image: postgres:17-alpine\n",
      stackName: `autumn-${tag}-${uniq()}`,
      services: [],
    });
    const child = await seedService({
      projectId: p.projectId,
      environmentId,
      name: `autumn-db-${tag}`,
      hostname: `autumn-db-${tag}-${uniq()}`,
      stackId: stack.resource.id,
      composeService: "db",
    });
    return child.host;
  }

  it("a staging service resolves ${{autumn.db.HOST}} to the staging stack's child, whichever stack was written first", async () => {
    for (const order of ORDERS) {
      const p = await twoEnvProject();
      const hosts = { prod: "", stg: "" };
      for (const [environmentId, tag] of inOrder(p, order)) {
        hosts[tag] = await stackIn(p, environmentId, tag);
      }
      const api = await serviceWithEnv(p, p.staging, { DB_HOST: "${{autumn.db.HOST}}" });
      expect(await resolvedKey(p.projectId, api, "DB_HOST"), order).toBe(hosts.stg);
    }
  });
});

describe("manifest apply resolves refs within the environment being applied", () => {
  it("a production apply resolves ${database:db.host} to production's db, never staging's", async () => {
    for (const order of ORDERS) {
      const p = await twoEnvProject();
      const hosts = await sameNamedDatabases(p, order);
      const scope = { environmentId: p.production, isMain: true };
      const resolve = makeEnvRefResolver(await loadRefTable(p.projectId, scope));
      expect(resolve("${database:db.host}"), order).toBe(hosts.prod);
    }
  });

  it("a staging apply resolves ${database:db.host} to staging's db, never production's", async () => {
    for (const order of ORDERS) {
      const p = await twoEnvProject();
      const hosts = await sameNamedDatabases(p, order);
      const scope = { environmentId: p.staging, isMain: false };
      const resolve = makeEnvRefResolver(await loadRefTable(p.projectId, scope));
      expect(resolve("${database:db.host}"), order).toBe(hosts.stg);
    }
  });
});

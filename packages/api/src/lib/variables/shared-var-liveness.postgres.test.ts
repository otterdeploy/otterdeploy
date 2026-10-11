/**
 * A shared variable reaches a service only through a
 * `${{project.X}}` / `${{environment.X}}` reference in its env, expanded when
 * the service rolls. Changing the shared value used to leave every dependent
 * reading as running its current env (envChangedAt untouched), while the
 * container still held the old value. Each write to the bag (upsert, delete,
 * whole-bag replace) now marks exactly the services in that environment that
 * reference a changed key as `pending` until their next roll.
 */
import type { EnvironmentId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { serviceResource } from "@otterdeploy/db/schema/project";
import { Temporal } from "@otterdeploy/shared/temporal";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  seedEnvironment,
  seedOrganization,
  seedProject,
  seedService,
  uniq,
} from "../../__tests__/postgres-seed";
import {
  bulkReplaceProjectEnvVars,
  deleteProjectEnvVar,
  upsertProjectEnvVar,
} from "../../routers/project/queries/project-env";
import { markServiceEnvApplied, upsertServiceEnvVar } from "../../routers/service/queries";
import { envLiveness } from "../../routers/service/views";

interface World {
  projectId: ProjectId;
  main: EnvironmentId;
  staging: EnvironmentId;
  /** References ${{project.DATABASE_URL}}. */
  user: ResourceId;
  /** References ${{environment.API_KEY}} only. */
  keyUser: ResourceId;
  /** No shared references. */
  plain: ResourceId;
  /** Staging's copy referencing ${{project.DATABASE_URL}}: another bag. */
  stagingUser: ResourceId;
}

let world: World;

async function service(
  projectId: ProjectId,
  environmentId: EnvironmentId,
  env: Record<string, string>,
): Promise<ResourceId> {
  const { resourceId } = await seedService({ projectId, environmentId, name: `svc-${uniq()}` });
  for (const [key, value] of Object.entries(env)) {
    await upsertServiceEnvVar({ serviceResourceId: resourceId, key, value });
  }
  return resourceId;
}

async function liveness(resourceId: ResourceId) {
  const [row] = await db
    .select({
      envChangedAt: serviceResource.envChangedAt,
      envAppliedAt: serviceResource.envAppliedAt,
      stackId: serviceResource.stackId,
    })
    .from(serviceResource)
    .where(eq(serviceResource.resourceId, resourceId));
  if (!row) throw new Error("no service row");
  return envLiveness(row).state;
}

/** Every service just rolled: what each runs is what is saved. */
async function rollAll(): Promise<void> {
  // A second ahead, so a stamp written in the same millisecond still reads as older.
  const at = new Date(Temporal.Now.instant().add({ seconds: 1 }).epochMilliseconds);
  for (const id of [world.user, world.keyUser, world.plain, world.stagingUser]) {
    await markServiceEnvApplied(id, at);
  }
  await Bun.sleep(1_100);
}

async function states() {
  return {
    user: await liveness(world.user),
    keyUser: await liveness(world.keyUser),
    plain: await liveness(world.plain),
    stagingUser: await liveness(world.stagingUser),
  };
}

const mainScope = () => ({ projectId: world.projectId, environmentId: world.main });

beforeEach(async () => {
  const organizationId = await seedOrganization("shared-var-liveness");
  const { projectId, mainEnvironmentId: main } = await seedProject(organizationId);
  const staging = await seedEnvironment(projectId, `staging-${uniq()}`);
  world = {
    projectId,
    main,
    staging,
    user: await service(projectId, main, { DB: "${{project.DATABASE_URL}}?sslmode=off" }),
    keyUser: await service(projectId, main, { KEY: "${{environment.API_KEY}}" }),
    plain: await service(projectId, main, { MODE: "production" }),
    stagingUser: await service(projectId, staging, { DB: "${{project.DATABASE_URL}}" }),
  };
  await upsertProjectEnvVar({ scope: mainScope(), key: "DATABASE_URL", value: "postgres://a" });
  await upsertProjectEnvVar({ scope: mainScope(), key: "API_KEY", value: "k1" });
  await rollAll();
});

describe("a changed shared variable marks the services that use it", () => {
  it("upsert: a new value marks only the referencing services in that environment pending", async () => {
    expect(await states()).toEqual({
      user: "live",
      keyUser: "live",
      plain: "live",
      stagingUser: "live",
    });
    await upsertProjectEnvVar({ scope: mainScope(), key: "DATABASE_URL", value: "postgres://b" });
    expect(await states()).toEqual({
      user: "pending",
      keyUser: "live",
      plain: "live",
      stagingUser: "live",
    });
  });

  it("upsert: re-saving the same value changes nothing", async () => {
    await upsertProjectEnvVar({ scope: mainScope(), key: "DATABASE_URL", value: "postgres://a" });
    expect(await liveness(world.user)).toBe("live");
  });

  it("delete: removing a referenced key marks its users pending", async () => {
    await deleteProjectEnvVar({ scope: mainScope(), key: "API_KEY" });
    expect(await states()).toEqual({
      user: "live",
      keyUser: "pending",
      plain: "live",
      stagingUser: "live",
    });
  });

  it("bulk replace: only the keys whose value changed mark their users", async () => {
    await bulkReplaceProjectEnvVars(mainScope(), [
      { key: "DATABASE_URL", value: "postgres://a" },
      { key: "API_KEY", value: "k2" },
    ]);
    expect(await states()).toEqual({
      user: "live",
      keyUser: "pending",
      plain: "live",
      stagingUser: "live",
    });
  });
});

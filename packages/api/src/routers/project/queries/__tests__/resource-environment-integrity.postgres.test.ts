/**
 * A resource can only be created in, or moved to, an
 * environment of its own project.
 *
 * Before: `newResourceEnvironmentId` returned a supplied environment id
 * untouched, and `resource.environment_id` had no foreign key, so an id from
 * another project, another organization, or nowhere was written verbatim. The
 * row then matched no scoped read and vanished from every list while its
 * container kept running and its name stayed taken.
 *
 * After: the create handlers refuse such an id with a typed error before any
 * row exists; the record creators refuse it too (backstop for internal
 * callers); and the database refuses it outright through the composite
 * `resource_environment_in_project_fk`, for any write that bypasses both.
 */
import type { EnvironmentId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { environment, project, resource } from "@otterdeploy/db/schema/project";
import { createId, ID_PREFIX } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { and, eq } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { beforeAll, describe, expect, test } from "vite-plus/test";

import {
  seedEnvironment,
  seedOrganization,
  seedProject,
  seedService,
  uniq,
} from "../../../../__tests__/postgres-seed";
import { pgErrorInfo } from "../../../../lib/pg-error";
import { createComposeRecord } from "../../../compose/queries";
import { createService } from "../../../service/create";
import { createServiceRecord } from "../../../service/queries/service";
import { validatePostgresCreate } from "../../postgres/create-stream";
import { ResourceEnvironmentNotFoundError } from "../new-resource-environment";
import { createDatabaseResourceRecord } from "../postgres-resource";

const FK = "resource_environment_in_project_fk";

interface World {
  organizationId: OrganizationId;
  projectId: ProjectId;
  mainId: EnvironmentId;
  stagingId: EnvironmentId;
  /** Same org, another project. */
  siblingEnvironmentId: EnvironmentId;
  /** Another org entirely. */
  foreignEnvironmentId: EnvironmentId;
  /** Exists nowhere. */
  missingEnvironmentId: EnvironmentId;
}

let world: World;

beforeAll(async () => {
  const organizationId = await seedOrganization("envint");
  const own = await seedProject(organizationId);
  const sibling = await seedProject(organizationId);
  const foreign = await seedProject(await seedOrganization("envint-other"));
  world = {
    organizationId,
    projectId: own.projectId,
    mainId: own.mainEnvironmentId,
    stagingId: await seedEnvironment(own.projectId, `staging-${uniq()}`),
    siblingEnvironmentId: sibling.mainEnvironmentId,
    foreignEnvironmentId: foreign.mainEnvironmentId,
    missingEnvironmentId: createId(ID_PREFIX.environment),
  };
});

const BAD_ENVIRONMENTS = [
  ["another project's environment (same org)", (w: World) => w.siblingEnvironmentId],
  ["another organization's environment", (w: World) => w.foreignEnvironmentId],
  ["an environment that does not exist", (w: World) => w.missingEnvironmentId],
] as const;

async function resourceNamed(name: string) {
  return db
    .select({ id: resource.id })
    .from(resource)
    .where(and(eq(resource.projectId, world.projectId), eq(resource.name, name)));
}

const log = createRequestLogger({ method: "TEST", path: "/resource-environment-integrity" });

describe("a supplied environment must be the project's own", () => {
  test.each(BAD_ENVIRONMENTS)("service create refuses %s, writing nothing", async (_, pick) => {
    const name = `svc-${uniq()}`;
    const environmentId = pick(world);
    const result = await createService(
      {
        projectId: world.projectId,
        organizationId: world.organizationId,
        environmentId,
        name,
        image: "nginx:alpine",
        ports: [],
      },
      log,
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ResourceEnvironmentNotFoundError);
      // The refusal names the id the caller sent and nothing about who owns it.
      expect(result.error.message).toBe(
        `environment ${environmentId} is not an environment of this project`,
      );
    }
    expect(await resourceNamed(name)).toEqual([]);
  });

  test.each(BAD_ENVIRONMENTS)("database create pre-flight refuses %s", async (_, pick) => {
    const result = await validatePostgresCreate({
      projectId: world.projectId,
      organizationId: world.organizationId,
      name: `db-${uniq()}`,
      environmentId: pick(world),
    });
    expect(result.isErr() && result.error).toBeInstanceOf(ResourceEnvironmentNotFoundError);
  });

  test.each(BAD_ENVIRONMENTS)(
    "every record creator refuses %s, before the insert",
    async (_, pick) => {
      const environmentId = pick(world);
      const name = `rec-${uniq()}`;
      const attempts: Array<() => Promise<unknown>> = [
        () =>
          createServiceRecord({
            projectId: world.projectId,
            environmentId,
            name,
            image: "nginx:alpine",
            internalHostname: name,
            serviceName: `od-${name}`,
            networkName: `od-net-${name}`,
            ports: [],
          }),
        () =>
          createComposeRecord({
            projectId: world.projectId,
            environmentId,
            name,
            source: "inline",
            composeContent: "services: {}",
            stackName: `stack-${name}`,
            services: [],
          }),
        () =>
          createDatabaseResourceRecord({
            projectId: world.projectId,
            environmentId,
            name,
            databaseName: "app",
            username: "app",
            password: "pw",
            publicHostname: `public-${name}`,
            publicPort: 443,
            publicConnectionString: "postgres://x",
            internalHostname: `${name}.otterdeploy.internal`,
            internalPort: 5432,
            internalConnectionString: "postgres://x",
            upstreamHost: name,
            upstreamPort: 5432,
            caddyLayer4Snippet: "",
          }),
      ];
      for (const attempt of attempts) {
        const outcome = await Result.tryPromise({ try: attempt, catch: (error: unknown) => error });
        expect(outcome.isErr() && outcome.error).toBeInstanceOf(ResourceEnvironmentNotFoundError);
      }
      expect(await resourceNamed(name)).toEqual([]);
    },
  );

  test("the project's own non-main environment is kept, and an omitted one is main", async () => {
    const inStaging = await seedService({
      projectId: world.projectId,
      environmentId: world.stagingId,
      name: `stg-${uniq()}`,
    });
    const [staged] = await db
      .select({ environmentId: resource.environmentId })
      .from(resource)
      .where(eq(resource.id, inStaging.resourceId));
    expect(staged?.environmentId).toBe(world.stagingId);

    const name = `main-${uniq()}`;
    const created = await createServiceRecord({
      projectId: world.projectId,
      name,
      image: "nginx:alpine",
      internalHostname: name,
      serviceName: `od-${name}`,
      networkName: `od-net-${name}`,
      ports: [],
    });
    expect(created.resource.environmentId).toBe(world.mainId);
  });
});

describe("the database refuses a stranded resource row", () => {
  /** The SQLSTATE + constraint of a write that should not have landed. */
  async function refusal(write: () => Promise<unknown>) {
    const outcome = await Result.tryPromise({ try: write, catch: (error: unknown) => error });
    const info = outcome.isErr() ? pgErrorInfo(outcome.error) : null;
    return { code: info?.code ?? null, constraint: info?.constraint ?? null };
  }

  test.each(BAD_ENVIRONMENTS)("a raw insert naming %s", async (_, pick) => {
    const environmentId = pick(world);
    const name = `raw-${uniq()}`;
    expect(
      await refusal(() =>
        db
          .insert(resource)
          .values({ projectId: world.projectId, environmentId, name, type: "service" }),
      ),
    ).toEqual({ code: "23503", constraint: FK });
    expect(await resourceNamed(name)).toEqual([]);
  });

  test("a raw update moving a resource into another project's environment", async () => {
    const { resourceId } = await seedService({
      projectId: world.projectId,
      environmentId: world.mainId,
      name: `mv-${uniq()}`,
    });
    expect(
      await refusal(() =>
        db
          .update(resource)
          .set({ environmentId: world.siblingEnvironmentId })
          .where(eq(resource.id, resourceId)),
      ),
    ).toEqual({ code: "23503", constraint: FK });
    const [row] = await db
      .select({ environmentId: resource.environmentId })
      .from(resource)
      .where(eq(resource.id, resourceId));
    expect(row?.environmentId).toBe(world.mainId);
  });

  test("an unstamped row (null environment, read as main) is still accepted", async () => {
    const name = `null-${uniq()}`;
    await db
      .insert(resource)
      .values({ projectId: world.projectId, environmentId: null, name, type: "service" });
    expect(await resourceNamed(name)).toHaveLength(1);
  });

  test("an environment that still owns a resource cannot be deleted out from under it", async () => {
    const organizationId = await seedOrganization("envint-del");
    const seeded = await seedProject(organizationId);
    const doomed = await seedEnvironment(seeded.projectId, `doomed-${uniq()}`);
    await seedService({ projectId: seeded.projectId, environmentId: doomed, name: "api" });
    expect(await refusal(() => db.delete(environment).where(eq(environment.id, doomed)))).toEqual({
      code: "23503",
      constraint: FK,
    });
  });

  test("deleting the project still takes its environments and resources with it", async () => {
    const organizationId = await seedOrganization("envint-prj");
    const seeded = await seedProject(organizationId);
    const staging = await seedEnvironment(seeded.projectId, `staging-${uniq()}`);
    await seedService({ projectId: seeded.projectId, environmentId: staging, name: "api" });
    await seedService({
      projectId: seeded.projectId,
      environmentId: seeded.mainEnvironmentId,
      name: "web",
    });

    await db.delete(project).where(eq(project.id, seeded.projectId));

    expect(
      await db.select().from(resource).where(eq(resource.projectId, seeded.projectId)),
    ).toEqual([]);
    expect(
      await db.select().from(environment).where(eq(environment.projectId, seeded.projectId)),
    ).toEqual([]);
  });
});

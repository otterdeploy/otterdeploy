/**
 * Against a migrated Postgres: installing a template never touches
 * another stack's values.
 *
 * Template variable names are generic (POSTGRES_PASSWORD, JWT_SECRET). Before
 * stacks had a scope, every install wrote its `${VAR}` values into the
 * project bag that EVERY stack in the project interpolates against: first
 * unconditionally (rotating a running stack's credential), then as a seed
 * (silently handing the new stack the other stack's credential and throwing
 * its own generated one away). An install now writes the new stack's own
 * variables only. Drives the real manifest create path and `compose.create`;
 * only the swarm rollout is stubbed.
 */
import { Result } from "better-result";
import { describe, expect, it, vi } from "vite-plus/test";

const deployCompose = vi.fn(async () =>
  Result.ok({ status: "running" as const, deployed: 1, failed: [] }),
);
vi.mock("../deploy", () => ({ deployCompose, removeComposeDomains: vi.fn() }));

const { uniq } = await import("../../../__tests__/postgres-seed");
const { upsertProjectEnvVar } = await import("../../project/queries/project-env");
const { createComposeFromManifest } = await import("../manifest-reconcile");
const { createComposeResource } = await import("../create");
const { interpolate } = await import("../env");
const { POSTGRES_STACK, log, projectBag, seedLegacyStack, seedTenantProject, stackVars } =
  await import("./stack-env-seed");

describe("installing a template never touches another stack's values", () => {
  it("template B applied through the manifest keeps its own POSTGRES_PASSWORD and leaves stack A's", async () => {
    const t = await seedTenantProject("esjx");
    // Stack A, as installed before stacks had a scope: running on the
    // project-level POSTGRES_PASSWORD its own install wrote.
    const a = await seedLegacyStack(t, POSTGRES_STACK);
    const scope = { projectId: t.projectId, environmentId: t.mainEnvironmentId };
    await upsertProjectEnvVar({ scope, key: "POSTGRES_PASSWORD", value: "a-live-password" });
    await upsertProjectEnvVar({ scope, key: "JWT_SECRET", value: "a-live-jwt" });

    // Template B wants the same generic names, with freshly generated values.
    const created = await createComposeFromManifest({
      projectId: t.projectId,
      organizationId: t.organizationId,
      name: `b-${uniq()}`,
      placementServerId: null,
      log: log(),
      spec: {
        source: "inline",
        content: POSTGRES_STACK,
        env: { POSTGRES_PASSWORD: "b-generated-password", JWT_SECRET: "b-generated-jwt" },
      },
    });
    expect(created.isOk()).toBe(true);
    if (!created.isOk()) return;
    expect(deployCompose).toHaveBeenCalled();

    // A's values are exactly what A was running on.
    expect(await projectBag(t)).toEqual({
      POSTGRES_PASSWORD: "a-live-password",
      JWT_SECRET: "a-live-jwt",
    });
    expect((await stackVars(t, a)).vars).toMatchObject({
      POSTGRES_PASSWORD: "a-live-password",
      JWT_SECRET: "a-live-jwt",
    });
    // B got the credential it generated, not A's, and says it overrides.
    const b = await stackVars(t, created.value.resourceId);
    expect(b.vars).toMatchObject({
      POSTGRES_PASSWORD: "b-generated-password",
      JWT_SECRET: "b-generated-jwt",
    });
    expect(b.shadowedProjectKeys).toEqual(["JWT_SECRET", "POSTGRES_PASSWORD"]);
    expect(
      interpolate("postgres://app:${POSTGRES_PASSWORD}@db/app", (await stackVars(t, a)).vars),
    ).toBe("postgres://app:a-live-password@db/app");
  });

  it("two stacks created through compose.create with the same key each keep their own", async () => {
    const t = await seedTenantProject("esjx-create");
    const create = (password: string) =>
      createComposeResource({
        organizationId: t.organizationId,
        log: log(),
        input: {
          projectId: t.projectId,
          name: `pg-${uniq()}`,
          source: "inline",
          composeContent: POSTGRES_STACK,
          variables: [
            { key: "POSTGRES_PASSWORD", value: password },
            // An empty value is "not set here": it must not become a row.
            { key: "JWT_SECRET", value: "" },
          ],
          exposed: [],
          deploy: false,
        },
      });
    const first = await create("first-password");
    const second = await create("second-password");
    expect(first.isOk() && second.isOk()).toBe(true);
    if (!first.isOk() || !second.isOk()) return;

    expect(await projectBag(t)).toEqual({});
    expect((await stackVars(t, first.value.resourceId)).vars).toEqual({
      POSTGRES_PASSWORD: "first-password",
    });
    expect((await stackVars(t, second.value.resourceId)).vars).toEqual({
      POSTGRES_PASSWORD: "second-password",
    });
  });
});

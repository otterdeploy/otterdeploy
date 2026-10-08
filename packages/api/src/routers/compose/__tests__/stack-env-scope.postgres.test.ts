/**
 * Against a migrated Postgres: a compose stack's `${VAR}` values
 * belong to the stack, and reading and writing agree on that scope.
 *
 * Before, reading was scoped and writing was not: a stack had no variables of
 * its own, so its `${VAR}` values lived in the project bag every other stack
 * also reads. Now a stack resolves its own variables over the project bag of
 * its environment over the file's defaults; the stack variables procedures
 * write the stack and never the project; the upgrade copies each stack-local
 * project value into its stack without changing what anything resolves; and a
 * deleted stack takes only what it owned. Real query modules and procedures;
 * only RBAC is stubbed (authz has its own suites).
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { createProcedureClient } from "@orpc/server";
import { db } from "@otterdeploy/db";
import { stackEnvVar } from "@otterdeploy/db/schema/project";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@otterdeploy/auth", () => ({
  auth: { api: { hasPermission: async () => ({ success: true }) } },
}));

const { seedEnvironment, uniq } = await import("../../../__tests__/postgres-seed");
const {
  POSTGRES_STACK,
  log,
  migrationDataStatement,
  projectBag,
  seedLegacyStack,
  seedTenantProject,
  stackVars,
  storedProjectRows,
} = await import("./stack-env-seed");
const { upsertProjectEnvVar } = await import("../../project/queries/project-env");
const { createComposeRecord, deleteComposeRecord } = await import("../queries");
const { interpolate } = await import("../env");
const { cleanupOrphanedComposeVars } = await import("../cleanup-vars");
const { listStoredStackEnvVars, loadStackInterpolationVars } = await import("../stack-env");
type Seeded = Awaited<ReturnType<typeof seedTenantProject>>;
const { composeRouter } = await import("../index");

// First: the migration statement runs install-wide, so it goes before this
// file seeds anything else that it could legitimately pick up.
describe("the migration copies each stack-local project variable into its stack", () => {
  it("a key one stack references is copied verbatim; shared, escaped and unused keys stay project-only", async () => {
    const t = await seedTenantProject("migrate");
    const x = await seedLegacyStack(
      t,
      "services:\n  x:\n    image: x:${X_TAG}\n    environment:\n      ONLY_X: ${ONLY_X}\n      SHARED: ${SHARED}\n      LITERAL: $${ESCAPED}\n",
    );
    const y = await seedLegacyStack(
      t,
      "services:\n  y:\n    image: y\n    command: [run, ${SHARED}]\n",
      {
        files: [
          { path: "conf.yml", content: "secret: ${FILE_ONLY}\n", interpolate: true },
          { path: "run.sh", content: "echo ${NOT_INTERPOLATED}\n" },
        ],
      },
    );
    const scope = { projectId: t.projectId, environmentId: t.mainEnvironmentId };
    for (const key of ["ONLY_X", "SHARED", "FILE_ONLY", "ESCAPED", "NOT_INTERPOLATED", "UNUSED"]) {
      await upsertProjectEnvVar({ scope, key, value: `${key.toLowerCase()}-value` });
    }
    await upsertProjectEnvVar({ scope, key: "X_TAG", value: "sealed-tag", sealed: true });
    const before = await storedProjectRows(t);

    await db.execute(sql.raw(migrationDataStatement()));
    // Idempotent: a second run (a re-applied migration, a restore) adds nothing.
    await db.execute(sql.raw(migrationDataStatement()));

    const own = async (id: ResourceId) =>
      (await listStoredStackEnvVars(id)).sort((a, b) => a.key.localeCompare(b.key));
    const stored = new Map(before.map((r) => [r.key, r.value]));
    expect(await own(x)).toEqual([
      { key: "ONLY_X", value: stored.get("ONLY_X") },
      { key: "X_TAG", value: stored.get("X_TAG") },
    ]);
    expect(await own(y)).toEqual([{ key: "FILE_ONLY", value: stored.get("FILE_ONLY") }]);
    // Copy, never move: the project bag is byte-for-byte what it was.
    expect(await storedProjectRows(t)).toEqual(before);
    // The sealed row stayed sealed in its new home.
    const [tag] = await db
      .select({ sealed: stackEnvVar.sealed })
      .from(stackEnvVar)
      .where(and(eq(stackEnvVar.stackResourceId, x), eq(stackEnvVar.key, "X_TAG")));
    expect(tag?.sealed).toBe(true);
    // And every stack still resolves exactly what it resolved before.
    expect((await stackVars(t, x)).vars).toMatchObject({
      ONLY_X: "only_x-value",
      SHARED: "shared-value",
      X_TAG: "sealed-tag",
    });
    expect((await stackVars(t, y)).vars).toMatchObject({
      SHARED: "shared-value",
      FILE_ONLY: "file_only-value",
    });
  });
});

describe("a stack's ${VAR} resolves stack > project (its environment) > file default", () => {
  it("the narrowest scope that sets a key wins; an unset key falls through", async () => {
    const t = await seedTenantProject("precedence");
    const stack = await createComposeRecord({
      projectId: t.projectId,
      environmentId: t.mainEnvironmentId,
      name: `p-${uniq()}`,
      source: "inline",
      composeContent: "services:\n  s:\n    image: s\n",
      stackName: `p-${uniq()}`,
      services: [],
      variables: [{ key: "BOTH", value: "from-stack", isSecret: false }],
    });
    const scope = { projectId: t.projectId, environmentId: t.mainEnvironmentId };
    await upsertProjectEnvVar({ scope, key: "BOTH", value: "from-project" });
    await upsertProjectEnvVar({ scope, key: "PROJECT_ONLY", value: "from-project" });

    const { vars } = await stackVars(t, stack.resource.id);
    expect(interpolate("${BOTH}|${PROJECT_ONLY}|${DEFAULTED:-from-file}|${NOWHERE}", vars)).toBe(
      "from-stack|from-project|from-file|",
    );
  });

  it("a stack in another environment reads that environment's project bag, not main's", async () => {
    const t = await seedTenantProject("envbag");
    const staging = await seedEnvironment(t.projectId, `staging-${uniq()}`);
    await upsertProjectEnvVar({
      scope: { projectId: t.projectId, environmentId: t.mainEnvironmentId },
      key: "SMTP_HOST",
      value: "smtp.production",
    });
    await upsertProjectEnvVar({
      scope: { projectId: t.projectId, environmentId: staging },
      key: "SMTP_HOST",
      value: "smtp.staging",
    });
    const stack = await createComposeRecord({
      projectId: t.projectId,
      environmentId: staging,
      name: `s-${uniq()}`,
      source: "inline",
      composeContent: "services:\n  s:\n    image: s\n",
      stackName: `s-${uniq()}`,
      services: [],
    });
    const { vars } = await loadStackInterpolationVars({
      projectId: t.projectId,
      environmentId: staging,
      stackResourceId: stack.resource.id,
    });
    expect(vars.SMTP_HOST).toBe("smtp.staging");
  });
});

describe("the stack variables procedures write the stack, never the project", () => {
  let t: Seeded;
  let stackId: ResourceId;
  beforeAll(async () => {
    t = await seedTenantProject("procs");
    stackId = await seedLegacyStack(t, POSTGRES_STACK.replace("JWT_SECRET}", "JWT_SECRET:-dev}"));
    await upsertProjectEnvVar({
      scope: { projectId: t.projectId, environmentId: t.mainEnvironmentId },
      key: "POSTGRES_PASSWORD",
      value: "project-password",
    });
  });
  const context = () => t.member;
  const listVariables = (input: { projectId: ProjectId; resourceId: ResourceId }) =>
    createProcedureClient(composeRouter.listVariables, { context: context() })(input);
  const setVariable = (input: { key: string; value: string; sealed?: boolean }) =>
    createProcedureClient(composeRouter.setVariable, { context: context() })({
      projectId: t.projectId,
      resourceId: stackId,
      ...input,
    });
  const deleteVariable = (key: string) =>
    createProcedureClient(composeRouter.deleteVariable, { context: context() })({
      projectId: t.projectId,
      resourceId: stackId,
      key,
    });

  it("listVariables says where each referenced key resolves from", async () => {
    const view = await listVariables({ projectId: t.projectId, resourceId: stackId });
    expect(view.map((v) => [v.key, v.scope, v.value])).toEqual([
      ["JWT_SECRET", "default", ""],
      ["POSTGRES_PASSWORD", "project", ""],
    ]);
  });

  it("setVariable overrides for this stack only; the project value is untouched", async () => {
    const row = await setVariable({ key: "POSTGRES_PASSWORD", value: "stack-password" });
    expect(row).toMatchObject({
      key: "POSTGRES_PASSWORD",
      scope: "stack",
      isSecret: true,
      overridesProject: true,
    });
    expect(await projectBag(t)).toEqual({ POSTGRES_PASSWORD: "project-password" });
    expect((await stackVars(t, stackId)).vars.POSTGRES_PASSWORD).toBe("stack-password");

    const sealed = await setVariable({ key: "JWT_SECRET", value: "sealed-jwt", sealed: true });
    // Write-only: the plaintext never comes back out of a read surface.
    expect(sealed).toMatchObject({ value: "", sealed: true, overridesProject: false });
    const view = await listVariables({ projectId: t.projectId, resourceId: stackId });
    expect(view.map((v) => [v.key, v.scope, v.value])).toEqual([
      ["JWT_SECRET", "stack", ""],
      ["POSTGRES_PASSWORD", "stack", "stack-password"],
    ]);
    // The deploy boundary still gets the real value.
    expect((await stackVars(t, stackId)).vars.JWT_SECRET).toBe("sealed-jwt");
  });

  it("deleteVariable drops the override, and the project value shows through again", async () => {
    await deleteVariable("POSTGRES_PASSWORD");
    expect((await stackVars(t, stackId)).vars.POSTGRES_PASSWORD).toBe("project-password");
    expect(await projectBag(t)).toEqual({ POSTGRES_PASSWORD: "project-password" });
  });

  it("a stack outside the caller's project is not found, for reads and writes alike", async () => {
    const other = await seedTenantProject("procs-other");
    const context = other.member;
    // The caller's OWN project, naming a stack that lives in someone else's.
    const target = { projectId: other.projectId, resourceId: stackId };
    const notFound = {
      code: "NOT_FOUND",
      status: 404,
      message: "Compose resource or project not found",
    };
    await expect(
      createProcedureClient(composeRouter.listVariables, { context })(target),
    ).rejects.toMatchObject(notFound);
    await expect(
      createProcedureClient(composeRouter.setVariable, { context })({
        ...target,
        key: "POSTGRES_PASSWORD",
        value: "hijacked",
      }),
    ).rejects.toMatchObject(notFound);
    await expect(
      createProcedureClient(composeRouter.deleteVariable, { context })({
        ...target,
        key: "JWT_SECRET",
      }),
    ).rejects.toMatchObject(notFound);
    // Nothing moved on the victim's stack.
    expect((await stackVars(t, stackId)).vars).toMatchObject({
      POSTGRES_PASSWORD: "project-password",
      JWT_SECRET: "sealed-jwt",
    });
  });
});

describe("the stack variables procedures answer a session and an API key alike", () => {
  it("list, set and delete give the same result for a session and an API key", async () => {
    const t = await seedTenantProject("parity");
    const contexts = {
      web: t.member,
      apikey: {
        ...t.member,
        actor: {
          kind: "api-key" as const,
          id: `key_${uniq()}`,
          permissions: null,
          organizationId: t.organizationId,
        },
        session: null,
        apiKey: {
          kind: "api-key" as const,
          id: `key_${uniq()}`,
          permissions: null,
          organizationId: t.organizationId,
        },
      },
    };
    const outcomes: Record<string, unknown> = {};
    for (const [channel, context] of Object.entries(contexts)) {
      const stack = await seedLegacyStack(t, POSTGRES_STACK);
      const target = { projectId: t.projectId, resourceId: stack };
      const set = await createProcedureClient(composeRouter.setVariable, { context })({
        ...target,
        key: "POSTGRES_PASSWORD",
        value: "same-value",
      });
      const listed = await createProcedureClient(composeRouter.listVariables, { context })(target);
      const deleted = await createProcedureClient(composeRouter.deleteVariable, { context })({
        ...target,
        key: "POSTGRES_PASSWORD",
      });
      const after = await createProcedureClient(composeRouter.listVariables, { context })(target);
      outcomes[channel] = { set, listed, deleted, after };
    }
    expect(outcomes.apikey).toEqual(outcomes.web);
    expect(outcomes.web).toMatchObject({
      set: { key: "POSTGRES_PASSWORD", scope: "stack", value: "same-value" },
      deleted: { ok: true },
    });
  });
});

describe("deleting a stack removes only what the stack owned", () => {
  it("its variables cascade; a project value it merely read survives the cleanup", async () => {
    const t = await seedTenantProject("cleanup");
    const scope = { projectId: t.projectId, environmentId: t.mainEnvironmentId };
    const stack = await seedLegacyStack(
      t,
      "services:\n  s:\n    image: s\n    environment:\n      A: ${LEFTOVER}\n      B: ${EDITED}\n      C: ${READ_ONLY}\n",
    );
    for (const key of ["LEFTOVER", "EDITED", "READ_ONLY"]) {
      await upsertProjectEnvVar({ scope, key, value: `${key}-v1` });
    }
    // The migration's copies of the two stack-local keys (READ_ONLY is a
    // project value the operator set after the upgrade; it was never copied).
    await db.execute(sql.raw(migrationDataStatement()));
    await db
      .delete(stackEnvVar)
      .where(and(eq(stackEnvVar.stackResourceId, stack), eq(stackEnvVar.key, "READ_ONLY")));
    // Edited on the project page after the upgrade: no longer the stack's copy.
    await upsertProjectEnvVar({ scope, key: "EDITED", value: "EDITED-v2" });

    const ownRows = await listStoredStackEnvVars(stack);
    await deleteComposeRecord(t.projectId, stack);
    expect(await listStoredStackEnvVars(stack)).toEqual([]);
    await cleanupOrphanedComposeVars(
      { projectId: t.projectId, deletedResourceId: stack, ownRows },
      log(),
    );

    expect(await projectBag(t)).toEqual({ EDITED: "EDITED-v2", READ_ONLY: "READ_ONLY-v1" });
  });
});

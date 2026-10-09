/**
 * State-changing procedures check a permission, not only membership.
 *
 * These used to sit on the bare org-scoped builder, which only checks that
 * the caller belongs to the organization, so a read-only API key or a role
 * without the permission reached them:
 *   - git provider writes (refreshRepos, refetchPermissions, connectPublicRepo,
 *     startConnect, startManifest) need `project:update`;
 *   - git.disconnect and git.deleteProvider are org-wide and need
 *     `organization:update` (owners and admins; no API key, keys are capped at
 *     the member role);
 *   - deployment.cancel needs `service:deploy`;
 *   - the postgres draftCredentials procedure needs `database:create`;
 *   - backups.destinations.test needs `backup:run`.
 *
 * A refused call is FORBIDDEN; an allowed one gets past the gate to the
 * handler's own NOT_FOUND for the made-up id. Real procedures against a
 * migrated database.
 */
import type { AnyProcedure } from "@orpc/server";
import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";

import { createProcedureClient, ORPCError } from "@orpc/server";
import { auth } from "@otterdeploy/auth";
import { createId, ID_PREFIX } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { Context } from "../../context";

import { appRouter } from "../../routers";
import {
  createKeyContext,
  createOwnerContext,
  createRequestContext,
  openRegistration,
  signIn,
  signUp,
} from "../postgres-actors";
import { seedOrganization, seedProject } from "../postgres-seed";

async function code(procedure: AnyProcedure, context: Context, input: unknown): Promise<string> {
  const client = createProcedureClient(procedure, { context });
  const called = await Result.tryPromise({
    try: async (): Promise<unknown> => client(input),
    catch: (error) => error,
  });
  if (called.isOk()) return "OK";
  if (called.error instanceof ORPCError) return String(called.error.code);
  throw called.error;
}

let restoreRegistration: () => Promise<void>;
let organizationId: OrganizationId;
let projectId: ProjectId;
let readOnlyKey: Context;
let fullKey: Context;
let owner: Context;
let member: Context;

beforeAll(async () => {
  restoreRegistration = await openRegistration();
  organizationId = await seedOrganization("gates");
  ({ projectId } = await seedProject(organizationId));
  fullKey = createKeyContext(organizationId, null);
  readOnlyKey = createKeyContext(organizationId, null);
  if (readOnlyKey.apiKey) readOnlyKey.apiKey.accessLevel = "read";
  owner = await createOwnerContext(organizationId);
  const plain = await signUp("gates-member");
  await auth.api.addMember({ body: { organizationId, userId: plain.id, role: "member" } });
  member = await createRequestContext(await signIn(plain.email));
});

afterAll(async () => {
  await restoreRegistration?.();
});

const installationId = () => createId(ID_PREFIX.gitInstallation);
const providerId = () => createId(ID_PREFIX.gitProvider);

describe("a read-only API key is refused by every write", () => {
  it.each<[string, AnyProcedure, () => unknown]>([
    ["git.refreshRepos", appRouter.git.refreshRepos, () => ({ installationId: installationId() })],
    [
      "git.refetchPermissions",
      appRouter.git.refetchPermissions,
      () => ({ installationId: installationId() }),
    ],
    [
      "git.connectPublicRepo",
      appRouter.git.connectPublicRepo,
      () => ({ cloneUrl: "https://github.com/otterdeploy/example.git" }),
    ],
    ["git.disconnect", appRouter.git.disconnect, () => ({ installationId: installationId() })],
    ["git.deleteProvider", appRouter.git.deleteProvider, () => ({ providerId: providerId() })],
    [
      "deployment.cancel",
      appRouter.deployment.cancel,
      () => ({ deploymentId: createId(ID_PREFIX.deployment) }),
    ],
    [
      "postgres.draftCredentials",
      appRouter.project.resource.database.postgres.draftCredentials,
      () => ({ projectId, name: "db" }),
    ],
    [
      "backups.destinations.test",
      appRouter.backups.destinations.test,
      () => ({ id: createId(ID_PREFIX.backupDestination) }),
    ],
  ])("%s", async (_name, procedure, input) => {
    expect(await code(procedure, readOnlyKey, input())).toBe("FORBIDDEN");
  });

  it("a writable key gets past the gate", async () => {
    expect(
      await code(appRouter.deployment.cancel, fullKey, {
        deploymentId: createId(ID_PREFIX.deployment),
      }),
    ).toBe("NOT_FOUND");
    expect(
      await code(appRouter.git.refreshRepos, fullKey, { installationId: installationId() }),
    ).toBe("NOT_FOUND");
  });
});

describe("disconnecting an installation or deleting a git provider is for owners and admins", () => {
  it("an API key and a plain member are refused", async () => {
    for (const context of [fullKey, member]) {
      expect(
        await code(appRouter.git.disconnect, context, { installationId: installationId() }),
      ).toBe("FORBIDDEN");
      expect(await code(appRouter.git.deleteProvider, context, { providerId: providerId() })).toBe(
        "FORBIDDEN",
      );
    }
  });

  it("an owner gets past the gate", async () => {
    expect(await code(appRouter.git.disconnect, owner, { installationId: installationId() })).toBe(
      "NOT_FOUND",
    );
    expect(await code(appRouter.git.deleteProvider, owner, { providerId: providerId() })).toBe(
      "NOT_FOUND",
    );
  });
});

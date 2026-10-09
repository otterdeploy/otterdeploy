/**
 * Refusals that are the caller's to fix answer with a typed 4xx that says why,
 * never an untyped 500:
 *   - project.stack.save: a file that is not a stack (400 INVALID_STACK), a
 *     stale version (409 CONFLICT); project.stack.apply before any save (409
 *     STACK_NOT_SAVED);
 *   - organization.setCloudflareConfig: a save with no zone picked (400);
 *   - sso.listProviders called with an API key (403);
 *   - data.testConnection for an unknown connection (404).
 *
 * Real procedures against a migrated database; only the Cloudflare client is
 * stubbed, so nothing reaches the network.
 */
import type { AnyProcedure } from "@orpc/server";
import type { OrganizationId } from "@otterdeploy/shared/id";

import { createProcedureClient, isProcedure, ORPCError } from "@orpc/server";
import { createId, ID_PREFIX } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { Context } from "../context";

vi.mock("../lib/cloudflare", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/cloudflare")>()),
  verifyCloudflareToken: async () => Result.ok({ active: true, status: "active" }),
}));

const { appRouter } = await import("../routers");
const { createKeyContext, createOwnerContext, openRegistration } =
  await import("./postgres-actors");
const { seedOrganization, seedProject } = await import("./postgres-seed");

const procedures = new Map<string, AnyProcedure>();
(function walk(node: unknown, path: readonly string[]) {
  if (isProcedure(node)) {
    procedures.set(path.join("."), node);
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, child] of Object.entries(node)) walk(child, [...path, key]);
})(appRouter, []);

type Outcome =
  | { kind: "ok"; output: unknown }
  | { kind: "refused"; code: string; status: number }
  | { kind: "untyped"; message: string };

async function call(name: string, context: Context, input: unknown): Promise<Outcome> {
  const procedure = procedures.get(name);
  if (!procedure) throw new Error(`no procedure ${name}`);
  const client = createProcedureClient(procedure, { context, path: name.split(".") });
  const called = await Result.tryPromise({ try: () => client(input), catch: (error) => error });
  if (called.isOk()) return { kind: "ok", output: called.value };
  const error = called.error;
  if (error instanceof ORPCError && error.status < 500) {
    return { kind: "refused", code: error.code, status: error.status };
  }
  return { kind: "untyped", message: error instanceof Error ? error.message : String(error) };
}

let organizationId: OrganizationId;
let key: Context;
let owner: Context;
let restoreRegistration: () => Promise<void>;

beforeAll(async () => {
  restoreRegistration = await openRegistration();
  organizationId = await seedOrganization("typed");
  key = createKeyContext(organizationId, null);
  owner = await createOwnerContext(organizationId);
  return async () => {
    await restoreRegistration();
  };
});

describe("project.stack", () => {
  it("save: a file that is not a stack is a 400, a stale version a 409", async () => {
    const { projectId } = await seedProject(organizationId);
    expect(
      await call("project.stack.save", key, {
        projectId,
        yaml: "services: [this is: not: a stack",
        expectedVersion: 0,
      }),
    ).toMatchObject({ kind: "refused", code: "INVALID_STACK", status: 400 });

    const yaml = 'version: "1"\nservices: {}\n';
    const saved = await call("project.stack.save", key, { projectId, yaml, expectedVersion: 0 });
    expect(saved.kind).toBe("ok");
    expect(
      await call("project.stack.save", key, { projectId, yaml, expectedVersion: 0 }),
    ).toMatchObject({ kind: "refused", code: "CONFLICT", status: 409 });
  });

  it("apply before any save is a 409 STACK_NOT_SAVED", async () => {
    const { projectId } = await seedProject(organizationId);
    expect(await call("project.stack.apply", key, { projectId })).toMatchObject({
      kind: "refused",
      code: "STACK_NOT_SAVED",
      status: 409,
    });
  });
});

describe("organization.setCloudflareConfig", () => {
  it("a token with no zone picked is a 400 that says so", async () => {
    expect(
      await call("organization.setCloudflareConfig", owner, {
        organizationId,
        token: "cf-token",
        zoneId: null,
      }),
    ).toMatchObject({ kind: "refused", code: "BAD_REQUEST", status: 400 });
  });
});

describe("sso.listProviders", () => {
  it("an API key is refused with a 403, not a 500", async () => {
    expect(await call("sso.listProviders", key, {})).toMatchObject({
      kind: "refused",
      code: "FORBIDDEN",
      status: 403,
    });
  });
});

describe("data.testConnection", () => {
  it("an unknown connection is a 404", async () => {
    expect(
      await call("data.testConnection", key, { id: createId(ID_PREFIX.dataConnection) }),
    ).toMatchObject({ kind: "refused", code: "NOT_FOUND", status: 404 });
  });
});

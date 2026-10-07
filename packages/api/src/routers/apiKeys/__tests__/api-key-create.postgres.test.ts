/**
 * Full access is an explicit choice. An API key created with nothing selected
 * used to be a FULL-access key: the create procedure dropped an empty map, the
 * plugin stored null, and null reads as full access. Driven through the real
 * `apiKeys.create` (schemas, middlewares, handler) and the real better-auth
 * handler, against Postgres:
 *   - an omitted or empty permission map is refused and mints nothing;
 *   - `"full"` mints the full-access key, deliberately;
 *   - a map naming something no key can use is refused, not minted as a key
 *     that silently cannot do what its creator asked;
 *   - the plugin's own HTTP create endpoint, which would mint a null (full)
 *     key from a browser, is closed.
 *
 * And `git.startConnect` refuses a key before it reads the organization's
 * GitHub App, so the refusal does not tell a key whether one is configured.
 */
import type { AnyProcedure } from "@orpc/server";
import type { OrganizationId } from "@otterdeploy/shared/id";

import { createProcedureClient, ORPCError } from "@orpc/server";
import { auth } from "@otterdeploy/auth";
import { db } from "@otterdeploy/db";
import { apikey } from "@otterdeploy/db/schema/auth";
import { Result } from "better-result";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import * as z from "zod";

import type { Context } from "../../../context";

import {
  createKeyContext,
  createOwnerContext,
  openRegistration,
} from "../../../__tests__/postgres-actors";
import { seedOrganization } from "../../../__tests__/postgres-seed";
import { appRouter } from "../../index";

const created = z.object({
  id: z.string(),
  key: z.string(),
  permissions: z.record(z.string(), z.array(z.string())).nullable(),
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
});

type Outcome = { kind: "ok"; output: unknown } | { kind: "refused"; code: string };

async function settle(run: () => Promise<unknown>): Promise<Outcome> {
  const called = await Result.tryPromise({ try: run, catch: (error) => error });
  if (called.isOk()) return { kind: "ok", output: called.value };
  if (called.error instanceof ORPCError) return { kind: "refused", code: called.error.code };
  throw called.error;
}

let organizationId: OrganizationId;
let owner: Context;
let restoreRegistration: () => Promise<void>;

beforeAll(async () => {
  restoreRegistration = await openRegistration();
  organizationId = await seedOrganization("keys");
  owner = await createOwnerContext(organizationId);
});

afterAll(async () => {
  await restoreRegistration?.();
});

async function keyCount(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(apikey)
    .where(eq(apikey.referenceId, organizationId));
  return row?.n ?? 0;
}

// Untyped on purpose: the refusals below send inputs the contract rejects.
const createProcedure: AnyProcedure = appRouter.apiKeys.create;

function create(input: Record<string, unknown>): Promise<Outcome> {
  const client = createProcedureClient(createProcedure, {
    context: owner,
    path: ["apiKeys", "create"],
  });
  return settle(() => client({ name: "ci", expiresIn: null, ...input }));
}

async function mint(input: Record<string, unknown>) {
  const result = await create(input);
  if (result.kind !== "ok") throw new Error(JSON.stringify(result));
  return created.parse(result.output);
}

describe("an API key's access is always an explicit choice", () => {
  it("an omitted or empty permission selection is refused and mints no key", async () => {
    const before = await keyCount();
    for (const input of [{}, { permissions: {} }, { permissions: { project: [] } }])
      expect(await create(input), JSON.stringify(input)).toEqual({
        kind: "refused",
        code: "BAD_REQUEST",
      });
    expect(await keyCount()).toBe(before);
  });

  it('"full" mints a full-access key', async () => {
    const key = await mint({ permissions: "full" });
    expect(key.permissions).toBeNull();
    // The stored row carries no permission map: that is what full access is.
    const [row] = await db
      .select({ permissions: apikey.permissions })
      .from(apikey)
      .where(eq(apikey.id, key.id));
    expect(row?.permissions ?? null).toBeNull();
  });

  it("a limited key holds exactly its selection", async () => {
    const key = await mint({ permissions: { project: ["read"] } });
    expect(key.permissions).toEqual({ project: ["read"] });
  });

  it("an expiry is passed through to the key", async () => {
    // 30 days: inside the plugin's accepted range (its minimum is one day).
    const expiresIn = 30 * 86_400;
    const key = await mint({ permissions: { project: ["read"] }, expiresIn });
    if (!key.expiresAt) throw new Error("the key has no expiry");
    // The plugin hands back Dates at this seam; compare their epoch ms.
    const lifetimeSeconds = (key.expiresAt.getTime() - key.createdAt.getTime()) / 1_000;
    expect(Math.abs(lifetimeSeconds - expiresIn)).toBeLessThan(5);
  });

  it("a permission no key can ever use is refused and mints nothing", async () => {
    const before = await keyCount();
    expect(await create({ permissions: { project: ["write"], database: ["write"] } })).toEqual({
      kind: "refused",
      code: "PERMISSION_NOT_GRANTABLE",
    });
    expect(await keyCount()).toBe(before);
  });

  it("the plugin's own HTTP create endpoint is closed", async () => {
    const before = await keyCount();
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/api-key/create", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ name: "browser-minted", organizationId }),
      }),
    );
    expect(response.status).toBe(404);
    expect(await keyCount()).toBe(before);
  });
});

describe("git.startConnect refuses an API key before it reads the GitHub App", () => {
  function startConnect(context: Context): Promise<Outcome> {
    const client = createProcedureClient(appRouter.git.startConnect, {
      context,
      path: ["git", "startConnect"],
    });
    return settle(() => client({ kind: "github" }));
  }

  it("a key of an organization with no GitHub App is UNAUTHORIZED, not NOT_CONFIGURED", async () => {
    expect(await startConnect(createKeyContext(organizationId, null))).toEqual({
      kind: "refused",
      code: "UNAUTHORIZED",
    });
    // A member of that organization still gets the honest NOT_CONFIGURED.
    expect(await startConnect(owner)).toEqual({ kind: "refused", code: "NOT_CONFIGURED" });
  });
});

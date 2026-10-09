/**
 * Requests act in the organization they say they act in, a refused switch
 * keeps the session's organization, and a repeated create makes one thing.
 *
 *   - An org-scoped request whose stated organization (the
 *     `x-otterdeploy-organization` header, or an `organizationId` in the
 *     input) is not the session's active one is refused with 409
 *     ORGANIZATION_SWITCHED, and nothing is written.
 *   - A session with no active organization answers a typed 409
 *     NO_ACTIVE_ORGANIZATION.
 *   - `/organization/set-active` for an organization the user is not a member
 *     of is refused without clearing the session's active organization.
 *   - `apiKeys.create` and `/organization/invite-member` sent twice with the
 *     same content inside a short window make one key / one invitation; the
 *     repeat gets a 409.
 *   - Member and invitation references with control characters are invalid
 *     input.
 *
 * Real procedures and the real better-auth instance against a migrated
 * database.
 */
import type { AnyProcedure } from "@orpc/server";
import type { OrganizationId } from "@otterdeploy/shared/id";

import { createProcedureClient, ORPCError } from "@orpc/server";
import { auth } from "@otterdeploy/auth";
import { db } from "@otterdeploy/db";
import { apikey, invitation, session } from "@otterdeploy/db/schema/auth";
import { Result } from "better-result";
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { Context } from "../../context";

import {
  createRequestContext,
  ORIGIN,
  openRegistration,
  signIn,
  signUp,
} from "../../__tests__/postgres-actors";
import { seedOrganization, uniq } from "../../__tests__/postgres-seed";
import { appRouter } from "../../routers";
import { ACTING_ORGANIZATION_HEADER } from "../acting-organization";

type Outcome = { kind: "ok"; output: unknown } | { kind: "refused"; code: string; status: number };

async function call(procedure: AnyProcedure, context: Context, input: unknown): Promise<Outcome> {
  const client = createProcedureClient(procedure, { context });
  const called = await Result.tryPromise({ try: () => client(input), catch: (error) => error });
  if (called.isOk()) return { kind: "ok", output: called.value };
  if (called.error instanceof ORPCError) {
    return { kind: "refused", code: called.error.code, status: called.error.status };
  }
  throw called.error;
}

let restoreRegistration: () => Promise<void>;
let orgA: OrganizationId;
let orgB: OrganizationId;
let owner: { id: string; email: string };
let cookies: Headers;

beforeAll(async () => {
  restoreRegistration = await openRegistration();
  orgA = await seedOrganization("acting-a");
  orgB = await seedOrganization("acting-b");
  owner = await signUp("acting-owner");
  await auth.api.addMember({ body: { organizationId: orgA, userId: owner.id, role: "owner" } });
  await auth.api.addMember({ body: { organizationId: orgB, userId: owner.id, role: "owner" } });
  cookies = await signIn(owner.email);
  await auth.api.setActiveOrganization({ body: { organizationId: orgA }, headers: cookies });
});

afterAll(async () => {
  await restoreRegistration?.();
});

/** The server's context for the owner's cookies, stating `acting` (if any). */
function contextActingIn(acting: string | null): Promise<Context> {
  const headers = new Headers(cookies);
  if (acting) headers.set(ACTING_ORGANIZATION_HEADER, acting);
  return createRequestContext(headers);
}

async function keysNamed(name: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(apikey).where(eq(apikey.name, name));
  return row?.n ?? 0;
}

describe("the stated organization must be the session's active one", () => {
  it("a header naming the active organization, or none, goes through", async () => {
    for (const acting of [orgA, null]) {
      expect(await call(appRouter.project.list, await contextActingIn(acting), {})).toMatchObject({
        kind: "ok",
      });
    }
  });

  it("a header naming another organization is refused, and the write does not happen", async () => {
    const context = await contextActingIn(orgB);
    expect(await call(appRouter.project.list, context, {})).toMatchObject({
      kind: "refused",
      code: "ORGANIZATION_SWITCHED",
      status: 409,
    });
    const name = `switched-${uniq()}`;
    expect(
      await call(appRouter.apiKeys.create, context, {
        name,
        expiresIn: null,
        permissions: "full",
      }),
    ).toMatchObject({ kind: "refused", code: "ORGANIZATION_SWITCHED" });
    expect(await keysNamed(name)).toBe(0);
  });

  it("an organizationId in the input naming another organization is refused", async () => {
    expect(
      await call(appRouter.organization.settings, await contextActingIn(null), {
        organizationId: orgB,
      }),
    ).toMatchObject({ kind: "refused", code: "ORGANIZATION_SWITCHED", status: 409 });
  });

  it("a session with no active organization gets a typed 409", async () => {
    const context = await contextActingIn(null);
    expect(
      await call(appRouter.project.list, { ...context, activeOrganizationId: null }, {}),
    ).toMatchObject({ kind: "refused", code: "NO_ACTIVE_ORGANIZATION", status: 409 });
  });
});

describe("a refused organization switch", () => {
  it("keeps the session's active organization", async () => {
    const headers = await signIn(owner.email);
    await auth.api.setActiveOrganization({ body: { organizationId: orgA }, headers });
    const outsider = await seedOrganization("acting-outsider");
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/organization/set-active`, {
        method: "POST",
        headers: new Headers([...headers, ["content-type", "application/json"]]),
        body: JSON.stringify({ organizationId: outsider }),
      }),
    );
    expect(response.status).toBe(403);
    const token = decodeURIComponent(
      /better-auth\.session_token=([^;]+)/.exec(headers.get("cookie") ?? "")?.[1] ?? "",
    ).split(".")[0];
    if (!token) throw new Error("no session token in the sign-in cookies");
    const [row] = await db
      .select({ active: session.activeOrganizationId })
      .from(session)
      .where(eq(session.token, token));
    expect(row?.active).toBe(orgA);
  });
});

describe("a repeated create makes one", () => {
  it("apiKeys.create: an identical repeat is a 409; a different key goes through", async () => {
    const context = await contextActingIn(orgA);
    const name = `once-${uniq()}`;
    const input = { name, expiresIn: null, permissions: { project: ["read"] } };
    expect(await call(appRouter.apiKeys.create, context, input)).toMatchObject({ kind: "ok" });
    expect(await call(appRouter.apiKeys.create, context, input)).toMatchObject({
      kind: "refused",
      code: "CONFLICT",
      status: 409,
    });
    expect(await keysNamed(name)).toBe(1);
    expect(
      await call(appRouter.apiKeys.create, context, { ...input, name: `${name}-2` }),
    ).toMatchObject({ kind: "ok" });
  });

  it("invite-member: an identical repeat is a 409 and leaves one pending invitation", async () => {
    const email = `invitee-${uniq()}@example.com`;
    const invite = () =>
      auth.handler(
        new Request(`${ORIGIN}/api/auth/organization/invite-member`, {
          method: "POST",
          headers: new Headers([...cookies, ["content-type", "application/json"]]),
          body: JSON.stringify({ email, role: "member", organizationId: orgA }),
        }),
      );
    expect((await invite()).status).toBe(200);
    expect((await invite()).status).toBe(409);
    const [row] = await db
      .select({ n: count() })
      .from(invitation)
      .where(and(eq(invitation.email, email), eq(invitation.organizationId, orgA)));
    expect(row?.n).toBe(1);
  });
});

describe("member and invitation references", () => {
  it("a control character is invalid input, not a lookup", async () => {
    const context = await contextActingIn(orgA);
    expect(
      await call(appRouter.organization.cancelInvitation, context, {
        organizationId: orgA,
        invitationId: "inv\u0000x",
      }),
    ).toMatchObject({ kind: "refused", code: "BAD_REQUEST" });
  });
});

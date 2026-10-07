/**
 * A member removed from an organization loses it at once, through both halves
 * of the check, each driven on its own with real better-auth sessions:
 *
 *   - removal clears `activeOrganizationId` on every session of the removed
 *     user (the afterRemoveMember hook in packages/auth), so a request that
 *     revalidates against the session row has no workspace at all;
 *   - the org-scoped guard re-checks the member table per request
 *     (orgScopedMiddleware in ../../index.ts), which refuses a session that
 *     still NAMES the organization: the session cookie cache, or a membership
 *     deleted without better-auth's hooks.
 *
 * And the permission check answers such a session with a 403, not a 500.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";
import type { EvlogVariables } from "evlog/hono";

import { createProcedureClient, isProcedure, ORPCError, Procedure } from "@orpc/server";
import { auth } from "@otterdeploy/auth";
import { db } from "@otterdeploy/db";
import { member, session } from "@otterdeploy/db/schema/auth";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { Result } from "better-result";
import { and, eq, sql } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { Context } from "../../context";

import { seedOrganization, uniq } from "../../__tests__/postgres-seed";
import { createContext } from "../../context";
import { appRouter } from "../../routers";
import { authorizeCapability } from "../capability";

const PASSWORD = "member-Password-123!";
const ORIGIN = "http://localhost:3000";

const setCookiePair = /^([^=;\s]+)=([^;]*)/;

function cookieHeader(setCookies: readonly string[]): string {
  return setCookies
    .flatMap((line) => {
      const pair = setCookiePair.exec(line);
      return pair?.[1] && pair[2] !== undefined ? [`${pair[1]}=${pair[2]}`] : [];
    })
    .join("; ");
}

async function signUp(label: string): Promise<{ id: string; email: string }> {
  const email = `${label}-${uniq()}@membership.test`;
  const created = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: label } });
  return { id: created.user.id, email };
}

/** A fresh sign-in: the session picks its active organization from the
 *  user's memberships, as on a real login. Carries the full cookie set,
 *  the cached session included. */
async function signIn(email: string): Promise<Headers> {
  const signed = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  const cookie = cookieHeader(signed.headers.getSetCookie());
  if (!cookie) throw new Error(`sign-in for ${email} set no cookie`);
  return new Headers({ cookie, origin: ORIGIN });
}

/** Only the session token: every request revalidates against the session row. */
function withoutCookieCache(headers: Headers): Headers {
  const cookie = (headers.get("cookie") ?? "")
    .split("; ")
    .filter((pair) => pair.split("=")[0]?.endsWith("session_token"))
    .join("; ");
  return new Headers({ cookie, origin: ORIGIN });
}

/** The request context the server builds for these headers. */
async function createRequestContext(headers: Headers): Promise<Context> {
  const app = new Hono<EvlogVariables>();
  const built: { context: Context | null } = { context: null };
  app.use("*", async (c, next) => {
    c.set("log", createRequestLogger({ method: c.req.method, path: c.req.path }));
    await next();
  });
  app.all("*", async (c) => {
    built.context = await createContext({ context: c, broadcast: () => {} });
    return c.body(null, 204);
  });
  await app.request(`${ORIGIN}/rpc/test`, { method: "POST", headers });
  if (!built.context) throw new Error("createContext did not run");
  return built.context;
}

/** `project.list`'s guards only: the handler is replaced by a sentinel. */
async function probeProjectList(headers: Headers) {
  const listing = appRouter.project.list;
  if (!isProcedure(listing)) throw new Error("project.list is not a procedure");
  const stub = new Procedure({
    ...listing["~orpc"],
    inputSchema: undefined,
    outputSchema: undefined,
    handler: async () => "reached",
  });
  const client = createProcedureClient(stub, {
    context: await createRequestContext(headers),
    path: ["project", "list"],
  });
  const called = await Result.tryPromise({ try: () => client({}), catch: (error) => error });
  if (called.isOk()) return { kind: "reached" };
  if (called.error instanceof ORPCError) return { kind: "refused", code: called.error.code };
  throw called.error;
}

async function activeOrganizations(userId: string): Promise<(string | null)[]> {
  const rows = await db
    .select({ activeOrganizationId: session.activeOrganizationId })
    .from(session)
    .where(eq(session.userId, userId));
  return rows.map((row) => row.activeOrganizationId);
}

let organizationId: OrganizationId;
let owner: Headers;
let restoreRegistration: () => Promise<void>;

/** Open registration for this file; the database is shared, so put it back. */
async function openRegistration(): Promise<() => Promise<void>> {
  const [before] = await db
    .select({
      bootstrapCompletedAt: platformSettings.bootstrapCompletedAt,
      registrationMode: platformSettings.registrationMode,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID));
  await db
    .insert(platformSettings)
    .values({
      id: PLATFORM_SETTINGS_ID,
      bootstrapCompletedAt: sql`now()`,
      registrationMode: "open",
    })
    .onConflictDoUpdate({
      target: platformSettings.id,
      set: {
        registrationMode: "open",
        bootstrapCompletedAt: sql`coalesce(${platformSettings.bootstrapCompletedAt}, now())`,
      },
    });
  return async () => {
    await db
      .update(platformSettings)
      .set({
        registrationMode: before?.registrationMode ?? null,
        bootstrapCompletedAt: before?.bootstrapCompletedAt ?? null,
      })
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID));
  };
}

/** A fresh member of the organization, signed in twice (two live sessions). */
async function seedMember(label: string) {
  const created = await signUp(label);
  await auth.api.addMember({ body: { organizationId, userId: created.id, role: "member" } });
  return { user: created, first: await signIn(created.email), second: await signIn(created.email) };
}

async function removeMember(email: string) {
  await auth.api.removeMember({ headers: owner, body: { organizationId, memberIdOrEmail: email } });
}

async function deleteMembership(userId: string) {
  await db
    .delete(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)));
}

beforeAll(async () => {
  restoreRegistration = await openRegistration();
  organizationId = await seedOrganization("membership");
  const ownerUser = await signUp("owner");
  await auth.api.addMember({ body: { organizationId, userId: ownerUser.id, role: "owner" } });
  owner = await signIn(ownerUser.email);
});

afterAll(async () => {
  await restoreRegistration?.();
});

describe("a removed member is refused immediately", () => {
  it("removal clears the organization from every session of the removed user", async () => {
    const removed = await seedMember("removed-rows");
    const naming = (rows: (string | null)[]) => rows.filter((id) => id === organizationId).length;
    expect(naming(await activeOrganizations(removed.user.id))).toBe(2);

    await removeMember(removed.user.email);

    const after = await activeOrganizations(removed.user.id);
    expect(after.length).toBeGreaterThanOrEqual(2);
    expect(after.every((id) => id === null)).toBe(true);
    expect(await probeProjectList(withoutCookieCache(removed.second))).toEqual({
      kind: "refused",
      code: "NO_ACTIVE_ORGANIZATION",
    });
  });

  it("a session whose cookie cache still names the organization is refused FORBIDDEN", async () => {
    const removed = await seedMember("removed-cache");
    await removeMember(removed.user.email);
    const context = await createRequestContext(removed.first);
    expect(context.activeOrganizationId).toBe(organizationId);
    expect(await probeProjectList(removed.first)).toEqual({ kind: "refused", code: "FORBIDDEN" });
  });

  it("a membership deleted outside better-auth is refused on the next request", async () => {
    const removed = await seedMember("removed-direct");
    const tokenOnly = withoutCookieCache(removed.first);
    expect(await probeProjectList(tokenOnly)).toEqual({ kind: "reached" });
    await deleteMembership(removed.user.id);
    expect(await probeProjectList(tokenOnly)).toEqual({ kind: "refused", code: "FORBIDDEN" });
  });

  it("a current member still reaches the procedure", async () => {
    expect(await probeProjectList(owner)).toEqual({ kind: "reached" });
  });
});

describe("the permission check denies a non-member", () => {
  it("authorizeCapability answers 403 for a session whose user is no longer a member", async () => {
    const removed = await seedMember("removed-capability");
    await deleteMembership(removed.user.id);
    const context = await createRequestContext(withoutCookieCache(removed.first));
    expect(context.actor?.kind).toBe("session");
    expect(
      await authorizeCapability(context.actor, {
        scope: "organization",
        mode: "read",
        organizationId,
        permission: { project: ["read"] },
      }),
    ).toEqual({
      allowed: false,
      status: 403,
      reason: "The actor does not have the required permission.",
    });
  });
});

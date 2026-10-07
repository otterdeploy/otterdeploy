/**
 * Request contexts for the `*.postgres.test.ts` suite, built the way
 * createContext builds them for a verified caller, so a test can drive a real
 * procedure (middleware ladder included) as that caller.
 */
import type { OrganizationId, ProjectId } from "@otterdeploy/shared/id";
import type { EvlogVariables } from "evlog/hono";

import { auth } from "@otterdeploy/auth";
import { db } from "@otterdeploy/db";
import { member, user } from "@otterdeploy/db/schema/auth";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { eq, sql } from "drizzle-orm";
import { createRequestLogger } from "evlog";
import { Hono } from "hono";
import { vi } from "vite-plus/test";

import type { ApiKeyActor } from "../authz/actor";
import type { Context } from "../context";

import { createContext } from "../context";
import { uniq } from "./postgres-seed";

/** An organization API key's context: full access, for every project of the
 *  organization or only `projectIds`. */
export function createKeyContext(
  organizationId: OrganizationId,
  projectIds: ProjectId[] | null,
): Context {
  const apiKey: ApiKeyActor = {
    kind: "api-key",
    id: `key_${uniq()}`,
    permissions: null,
    organizationId,
    ...(projectIds ? { projectScope: "selected", projectIds } : { projectScope: "all" }),
  };
  return {
    actor: apiKey,
    session: null,
    apiKey,
    activeOrganizationId: organizationId,
    headers: new Headers(),
    log: createRequestLogger({ method: "TEST", path: "/rpc" }),
    broadcast: vi.fn(),
  };
}

/** A real member of the organization, as a session actor. */
export async function createMemberContext(organizationId: OrganizationId): Promise<Context> {
  const email = `member-${uniq()}@scope.test`;
  const [created] = await db
    .insert(user)
    .values({ name: "member", email })
    .returning({ id: user.id });
  if (!created) throw new Error("user insert returned no row");
  await db.insert(member).values({ organizationId, userId: created.id, role: "owner" });
  const session = {
    kind: "session" as const,
    headers: new Headers(),
    user: { id: created.id, email, isInstallAdmin: false, twoFactorEnabled: true },
    session: { activeOrganizationId: organizationId },
  };
  return {
    actor: session,
    session,
    apiKey: null,
    activeOrganizationId: organizationId,
    headers: new Headers(),
    log: createRequestLogger({ method: "TEST", path: "/rpc" }),
    broadcast: vi.fn(),
  };
}

const PASSWORD = "member-Password-123!";
export const ORIGIN = "http://localhost:3000";

const setCookiePair = /^([^=;\s]+)=([^;]*)/;

function cookieHeader(setCookies: readonly string[]): string {
  return setCookies
    .flatMap((line) => {
      const pair = setCookiePair.exec(line);
      return pair?.[1] && pair[2] !== undefined ? [`${pair[1]}=${pair[2]}`] : [];
    })
    .join("; ");
}

export async function signUp(label: string): Promise<{ id: string; email: string }> {
  const email = `${label}-${uniq()}@postgres.test`;
  const created = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: label } });
  return { id: created.user.id, email };
}

/** A fresh sign-in: the session picks its active organization from the
 *  user's memberships, as on a real login. Carries the full cookie set,
 *  the cached session included. */
export async function signIn(email: string): Promise<Headers> {
  const signed = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  const cookie = cookieHeader(signed.headers.getSetCookie());
  if (!cookie) throw new Error(`sign-in for ${email} set no cookie`);
  return new Headers({ cookie, origin: ORIGIN });
}

/** The request context the server builds for these headers. */
export async function createRequestContext(headers: Headers): Promise<Context> {
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

/** Open registration for a file; the database is shared, so the returned
 *  function puts the setting back. */
export async function openRegistration(): Promise<() => Promise<void>> {
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

/** A signed-in owner of the organization, as the server builds the request
 *  context from the session cookie. Registration has to be open (see
 *  openRegistration). */
export async function createOwnerContext(organizationId: OrganizationId): Promise<Context> {
  const owner = await signUp("owner");
  await auth.api.addMember({ body: { organizationId, userId: owner.id, role: "owner" } });
  return createRequestContext(await signIn(owner.email));
}

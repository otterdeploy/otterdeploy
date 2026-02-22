import type { Context as HonoContext } from "hono";

import { auth } from "@otterdeploy/auth";
import { db, eq } from "@otterdeploy/db";
import { member } from "@otterdeploy/db/schema/auth";

export type ApiContextVariables = {
  correlationId: string;
};

export type ApiHonoContext = HonoContext<{ Variables: ApiContextVariables }>;

export type CreateContextOptions = {
  context: ApiHonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });
  const headerOrganizationId = context.req.header("x-organization-id");
  const activeOrganizationId =
    session && "session" in session ? (session.session.activeOrganizationId ?? null) : null;

  let organizationId = headerOrganizationId ?? activeOrganizationId ?? null;

  if (!organizationId && session?.user?.id) {
    const fallbackMembership = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id),
    });
    organizationId = fallbackMembership?.organizationId ?? null;
  }

  const correlationId = context.get("correlationId") ?? context.req.header("x-request-id") ?? null;

  return {
    session,
    organizationId,
    correlationId,
    headers: context.req.raw.headers,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

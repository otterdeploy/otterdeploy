
import type { OrganizationId } from "@otterdeploy/shared/id";
import type { Context as HonoContext } from "hono";
import type { RequestLogger } from "evlog";

import { auth, type Session } from "@otterdeploy/auth";
type OrgId = OrganizationId;

export interface CreateContextOptions {
  context: HonoContext;
  broadcast: (resource: string) => void;
}

export async function createContext({
  context,
  broadcast,
}: CreateContextOptions) {
  const session = (await auth.api.getSession({
    headers: context.req.raw.headers,
  })) as Session | null;

  // The evlog Hono middleware (app.use(evlog())) attaches a per-request
  // wide-event logger. Handlers accumulate context via context.log.set(...).
  const log = context.get("log") as RequestLogger;

  return {
    session,
    activeOrganizationId: (session?.session.activeOrganizationId ?? null) as
      | OrgId
      | null,
    // Raw request headers — carried so org-scoped middleware can delegate
    // role/permission checks to better-auth's `auth.api.hasPermission`
    // (which resolves the active member from the session cookie/bearer).
    headers: context.req.raw.headers,
    log,
    broadcast,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

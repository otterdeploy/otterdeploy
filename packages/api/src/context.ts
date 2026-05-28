import type { Context as HonoContext } from "hono";
import type { RequestLogger } from "evlog";

import { auth, type Session } from "@otterdeploy/auth";
import { type Id, ID_PREFIX } from "@otterdeploy/shared/id";

type OrgId = Id<typeof ID_PREFIX.organization>;

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
    log,
    broadcast,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

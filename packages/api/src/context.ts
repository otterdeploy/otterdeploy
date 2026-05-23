import type { Context as HonoContext } from "hono";
import type { RequestLogger } from "evlog";

import { auth, type Session } from "@otterstack/auth";

export type CreateContextOptions = {
  context: HonoContext;
  broadcast: (resource: string) => void;
};

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
    activeOrganizationId: session?.session.activeOrganizationId ?? null,
    log,
    broadcast,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

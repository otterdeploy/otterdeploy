import type { Context as HonoContext } from "hono";

import { auth } from "@otterstack/auth";

export type CreateContextOptions = {
  context: HonoContext;
  broadcast?: (resource: string) => void;
};

export async function createContext({ context, broadcast }: CreateContextOptions) {
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });
  return {
    session,
    broadcast: broadcast ?? (() => {}),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

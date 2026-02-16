import type { Context as HonoContext } from "hono";

import { auth } from "@otterstack/auth";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });
  const organizationId = context.req.header("x-organization-id") ?? null;
  const correlationId =
    (context.get("correlationId" as never) as string | undefined) ??
    context.req.header("x-request-id") ??
    null;

  return {
    session,
    organizationId,
    correlationId,
    headers: context.req.raw.headers,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

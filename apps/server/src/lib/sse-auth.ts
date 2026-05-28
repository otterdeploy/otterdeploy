/**
 * Session + active-org middleware for cookie-authed SSE handlers.
 *
 * EventSource can't set custom headers, so SSE endpoints have to rely
 * on cookies — exactly what better-auth's session lookup does anyway.
 * This centralizes the unauthorized / no-active-org early-returns so
 * every SSE handler doesn't repeat them.
 *
 * On success the handler can read:
 *   c.var.session         — Session (always defined)
 *   c.var.organizationId  — string (always defined; brand-cast at use site)
 */

import type { MiddlewareHandler } from "hono";

import { auth, type Session } from "@otterdeploy/auth";

export interface SseAuthVariables {
  session: Session;
  organizationId: string;
}

export const requireSseSession: MiddlewareHandler<{ Variables: SseAuthVariables }> = async (
  c,
  next,
) => {
  const session = (await auth.api.getSession({
    headers: c.req.raw.headers,
  })) as Session | null;
  if (!session?.user) {
    return c.text("Unauthorized", 401);
  }
  const organizationId = session.session.activeOrganizationId ?? null;
  if (!organizationId) {
    return c.text("No active organization", 400);
  }
  c.set("session", session);
  c.set("organizationId", organizationId);
  await next();
};

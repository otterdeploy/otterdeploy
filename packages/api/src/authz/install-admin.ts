import type { Context } from "../context";

/**
 * Installation authority is intentionally unavailable to organization API
 * keys, even full-access ones. It requires a real user session carrying the
 * server-owned bootstrap/admin attribute.
 */
export function isInstallAdminActor(context: Pick<Context, "apiKey" | "session">): boolean {
  return context.apiKey === null && context.session?.user.isInstallAdmin === true;
}

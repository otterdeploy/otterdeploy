import { ORPCError } from "@orpc/server";
/**
 * API keys router. A single server-side `create` that delegates to the
 * better-auth apiKey plugin's server instance so it can set the (server-only)
 * `permissions` field. The plugin additionally enforces org membership +
 * `apiKey:create` on our org AC (owners pass automatically); `requirePermission`
 * gates the same action up front for a clean denial + audit trail.
 *
 * The plaintext `key` in the response is returned exactly once — the caller
 * shows it and discards it; it's never persisted in readable form.
 */
import { auth } from "@otterdeploy/auth";

import { requirePermission } from "../..";

export const apiKeysRouter = {
  create: requirePermission({ apiKey: ["create"] }).apiKeys.create.handler(
    async ({ input, context }) => {
      // Minting requires a real user (the key is recorded against the caller).
      // An API-key actor can never reach here — it lacks `apiKey:create` under
      // the member role cap — but the guard also narrows `session` for TS.
      if (!context.session?.user) {
        throw new ORPCError("UNAUTHORIZED");
      }
      // NOTE: deliberately NO `headers` here. The plugin flags any call that
      // carries `request`/`headers` as a browser ("client") request and then
      // rejects server-only fields like `permissions`. Omitting headers makes
      // it a true server call; we instead pass `userId` + `organizationId`
      // explicitly (both server-only body fields). The requirePermission
      // middleware already authenticated the caller and checked `apiKey:create`
      // against the session, and the plugin re-verifies org membership for the
      // passed userId, so dropping headers doesn't weaken authorization.
      // Optional presets ride in key metadata (enableMetadata is on). Only the
      // explicitly-set ones are persisted, so an unscoped key keeps the current
      // full behavior — createContext reads these back into the ApiKeyActor.
      const metadata: Record<string, unknown> = {};
      if (input.accessLevel) metadata.accessLevel = input.accessLevel;
      if (input.projectScope) metadata.projectScope = input.projectScope;
      if (input.projectScope === "selected" && input.projectIds) {
        metadata.projectIds = input.projectIds;
      }

      const created = await auth.api.createApiKey({
        body: {
          name: input.name,
          expiresIn: input.expiresIn,
          userId: context.session.user.id,
          organizationId: context.activeOrganizationId,
          ...(input.permissions && Object.keys(input.permissions).length > 0
            ? { permissions: input.permissions }
            : {}),
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        },
      });

      context.log.set({ target: { type: "apiKey", id: created.id } });

      return {
        id: created.id,
        key: created.key,
        name: created.name,
        start: created.start,
        prefix: created.prefix,
        enabled: created.enabled,
        expiresAt: created.expiresAt,
        createdAt: created.createdAt,
        permissions: created.permissions ?? null,
      };
    },
  ),
};

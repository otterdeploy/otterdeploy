import { ORPCError } from "@orpc/server";
/**
 * API keys router. A single server-side `create` that delegates to the
 * better-auth apiKey plugin's server instance so it can set the (server-only)
 * `permissions` field. The plugin additionally enforces org membership +
 * `apiKey:create` on our org AC (owners pass automatically); `requirePermission`
 * gates the same action up front for a clean denial + audit trail.
 *
 * The plaintext `key` in the response is returned exactly once. The caller
 * shows it and discards it; it's never persisted in readable form.
 */
import { auth } from "@otterdeploy/auth";
import { omitUndefined } from "@otterdeploy/shared/object";

import { requirePermission } from "../..";
import { ungrantableKeyPermissions } from "../../authz/api-key-scope";
import { FULL_ACCESS } from "./contract";

export const apiKeysRouter = {
  create: requirePermission({ apiKey: ["create"] }).apiKeys.create.handler(
    async ({ input, context, errors }) => {
      // Minting requires a real user (the key is recorded against the caller).
      // An API-key actor can never reach here. It lacks `apiKey:create` under
      // the member role cap, but the guard also narrows `session` for TS.
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
      // full behavior: createContext reads these back into the ApiKeyActor.
      const metadata: {
        accessLevel?: typeof input.accessLevel;
        projectScope?: typeof input.projectScope;
        projectIds?: typeof input.projectIds;
      } = {};
      if (input.accessLevel) metadata.accessLevel = input.accessLevel;
      if (input.projectScope) metadata.projectScope = input.projectScope;
      if (input.projectScope === "selected" && input.projectIds) {
        metadata.projectIds = input.projectIds;
      }

      // Full access is an explicit choice: `"full"` mints the plugin's null
      // permission map, which authorizeKeyScope reads as full access (still
      // capped at the member role). A limited map must name only what a key
      // can actually use, or it is refused rather than minted as a key that
      // silently cannot do what its creator asked.
      const permissions = input.permissions === FULL_ACCESS ? undefined : input.permissions;
      if (permissions) {
        const refused = ungrantableKeyPermissions(permissions);
        if (refused.length > 0) {
          throw errors.PERMISSION_NOT_GRANTABLE({
            message: `An API key cannot hold ${refused.join(", ")}: keys are capped at what a member may do.`,
            data: { refused },
          });
        }
      }

      const created = await auth.api.createApiKey({
        body: omitUndefined({
          name: input.name,
          expiresIn: input.expiresIn,
          userId: context.session.user.id,
          organizationId: context.activeOrganizationId,
          permissions,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        }),
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

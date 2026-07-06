/**
 * Ephemeral database credential handlers (see ../../ephemeral-db). Split out
 * of index.ts like nosql-handlers so the orchestrator stays scannable.
 *
 * Permissions: minting/revoking rides `database:query` (same tier as running
 * a read-only statement — a read-only URL grants nothing the actor couldn't
 * already do through the console). A `read-write` credential hands out the app
 * role's full privileges, so it additionally demands `database:write` — same
 * capability check as the data viewer's write path.
 */
import type { DatabaseEphemeralCredentialId } from "@otterdeploy/shared/id";

import { auth } from "@otterdeploy/auth";
import { db } from "@otterdeploy/db";
import { databaseEphemeralCredential } from "@otterdeploy/db/schema";
import { desc, eq } from "drizzle-orm";

import { requirePermission } from "../..";
import { enforceResourceScope } from "../../authz/project-scope-guards";
import {
  EphemeralDbError,
  mintEphemeralCredential,
  revokeEphemeralCredential,
} from "../../ephemeral-db";

export const ephemeralDatabaseHandlers = {
  ephemeralCreate: requirePermission({ database: ["query"] }).database.ephemeralCreate.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId },
        ephemeralDb: { action: "create", scope: input.scope, ttlMinutes: input.ttlMinutes },
      });
      await enforceResourceScope(context, input.resourceId);

      if (input.scope === "read-write") {
        // API-key actors have no session for better-auth's role check — same
        // stance as the data viewer's capabilities handler: no write surface.
        if (context.apiKey) throw errors.WRITE_SCOPE_FORBIDDEN();
        const { success } = await auth.api.hasPermission({
          headers: context.headers,
          body: { permissions: { database: ["write"] } },
        });
        if (!success) throw errors.WRITE_SCOPE_FORBIDDEN();
      }

      try {
        const minted = await mintEphemeralCredential({
          organizationId: context.activeOrganizationId,
          resourceId: input.resourceId,
          ttlMinutes: input.ttlMinutes,
          scope: input.scope,
          label: input.label,
          createdByUserId: context.session?.user.id,
        });
        return {
          id: minted.id,
          roleName: minted.roleName,
          scope: minted.scope,
          expiresAt: minted.expiresAt.toISOString(),
          internalUrl: minted.internalUrl,
          publicUrl: minted.publicUrl,
        };
      } catch (cause) {
        if (cause instanceof EphemeralDbError) {
          throw errors.QUERY_FAILED({ data: { reason: cause.message } });
        }
        throw cause;
      }
    },
  ),

  ephemeralList: requirePermission({ database: ["read"] }).database.ephemeralList.handler(
    async ({ input, context }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      await enforceResourceScope(context, input.resourceId);

      const rows = await db
        .select()
        .from(databaseEphemeralCredential)
        .where(eq(databaseEphemeralCredential.resourceId, input.resourceId))
        .orderBy(desc(databaseEphemeralCredential.createdAt))
        .limit(50);

      const now = Date.now();
      return {
        credentials: rows.map((r) => ({
          id: r.id,
          roleName: r.roleName,
          scope: r.scope,
          label: r.label,
          expiresAt: r.expiresAt.toISOString(),
          revokedAt: r.revokedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
          status: r.revokedAt
            ? ("revoked" as const)
            : r.expiresAt.getTime() < now
              ? ("expired" as const)
              : ("active" as const),
        })),
      };
    },
  ),

  ephemeralRevoke: requirePermission({ database: ["query"] }).database.ephemeralRevoke.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId },
        ephemeralDb: { action: "revoke", credentialId: input.credentialId },
      });
      await enforceResourceScope(context, input.resourceId);

      try {
        const revoked = await revokeEphemeralCredential({
          organizationId: context.activeOrganizationId,
          resourceId: input.resourceId,
          credentialId: input.credentialId as DatabaseEphemeralCredentialId,
        });
        return { revoked };
      } catch (cause) {
        if (cause instanceof EphemeralDbError) {
          throw errors.QUERY_FAILED({ data: { reason: cause.message } });
        }
        throw cause;
      }
    },
  ),
};

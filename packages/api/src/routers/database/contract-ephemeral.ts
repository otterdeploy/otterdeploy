/**
 * Ephemeral-credential schemas for the database contract — short-lived
 * connection URLs (real Postgres roles with VALID UNTIL) minted to hand to
 * agents/scripts and auto-disposed at expiry. The URL is returned exactly
 * once at create; list/revoke manage the lifecycle. Split out of contract.ts
 * to keep it under the file-length cap.
 */
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

const resourceIdField = zId(ID_PREFIX.resource);

export const ephemeralScopeSchema = z.enum(["read-only", "read-write"]);

export const ephemeralCreateInput = z.object({
  resourceId: resourceIdField,
  // 5 minutes to 7 days; default one hour.
  ttlMinutes: z.number().int().min(5).max(10_080).default(60),
  scope: ephemeralScopeSchema.default("read-only"),
  label: z.string().max(120).optional(),
});

export const ephemeralCreateResultSchema = z.object({
  id: z.string(),
  roleName: z.string(),
  scope: ephemeralScopeSchema,
  expiresAt: z.string(),
  // Shown ONCE — the password is never stored, so these can't be re-fetched.
  internalUrl: z.string(),
  publicUrl: z.string().nullable(),
});

export const ephemeralListInput = z.object({ resourceId: resourceIdField });

export const ephemeralListResultSchema = z.object({
  credentials: z.array(
    z.object({
      id: z.string(),
      roleName: z.string(),
      scope: ephemeralScopeSchema,
      label: z.string().nullable(),
      expiresAt: z.string(),
      revokedAt: z.string().nullable(),
      createdAt: z.string(),
      status: z.enum(["active", "expired", "revoked"]),
    }),
  ),
});

export const ephemeralRevokeInput = z.object({
  resourceId: resourceIdField,
  credentialId: z.string().min(1),
});

export const ephemeralRevokeResultSchema = z.object({ revoked: z.boolean() });

/** Read-write scope hands out the app role's full privileges, so it needs the
 *  same capability as the data viewer's write path. Takes the base error map
 *  so the shapes stay defined in one place (contract.ts). */
export function makeNotEphemeral<T extends Record<string, unknown>>(notDatabase: T) {
  return {
    ...notDatabase,
    WRITE_SCOPE_FORBIDDEN: {
      status: 403 as const,
      message: "Creating a read-write credential requires the database:write permission" as const,
    },
  };
}

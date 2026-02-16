import * as z from "zod";
import { db, eq, and } from "@otterstack/db";
import { customDomain } from "@otterstack/db/schema/operations";

import { orgProcedure, orgAdminProcedure } from "../index";
import { createId, toISOString } from "../utils/helpers";
import { validateResourceAccess, validateDomainAccess } from "../utils/ownership";

function formatDomain(row: typeof customDomain.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    resourceId: row.resourceId,
    domain: row.domain,
    verified: row.verified,
    sslStatus: row.sslStatus,
    sslExpiresAt: toISOString(row.sslExpiresAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const domainRouter = {
  add: orgAdminProcedure
    .input(
      z.object({
        resourceId: z.string().min(1),
        domain: z.string().min(3),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateResourceAccess(input.resourceId, context.organizationId);

      const now = new Date();
      const row = {
        id: createId(),
        organizationId: context.organizationId,
        resourceId: input.resourceId,
        domain: input.domain,
        verified: false,
        verificationToken: createId(),
        sslStatus: "pending" as const,
        sslExpiresAt: null,
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(customDomain).values(row);
      return formatDomain(row as typeof customDomain.$inferSelect);
    }),

  verify: orgAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateDomainAccess(input.domainId, context.organizationId);

      await db
        .update(customDomain)
        .set({ verified: true, updatedAt: new Date() })
        .where(eq(customDomain.id, input.domainId));

      const updated = await db.query.customDomain.findFirst({
        where: eq(customDomain.id, input.domainId),
      });
      return formatDomain(updated!);
    }),

  list: orgProcedure
    .input(
      z.object({
        resourceId: z.string().min(1).optional(),
        organizationId: z.string().min(1).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const conditions = [eq(customDomain.organizationId, context.organizationId)];
      if (input.resourceId) {
        conditions.push(eq(customDomain.resourceId, input.resourceId));
      }

      const rows = await db.query.customDomain.findMany({
        where: and(...conditions),
      });

      return rows.map(formatDomain);
    }),

  remove: orgAdminProcedure
    .input(
      z.object({
        domainId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await validateDomainAccess(input.domainId, context.organizationId);
      await db.delete(customDomain).where(eq(customDomain.id, input.domainId));
      return { success: true as const };
    }),
};

/**
 * The inbound endpoint's secret rotation write, split out of queries-inbound.ts
 * (which keeps the CRUD and the token lookup) to stay under the file cap.
 */
import type { InboundEndpointId, OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { type InboundEndpointRow, inboundEndpoint } from "@otterdeploy/db/schema";
import { and, eq, sql } from "drizzle-orm";

/**
 * Swap in a new secret. With a grace deadline the CURRENT
 * secret moves to the previous slot in the same statement (the SET's
 * right-hand side reads the row as it was); without one the previous slot is
 * cleared, so the old secret stops verifying at once. Null when the id names
 * nothing in the organization.
 */
export async function rotateInboundEndpointSecret(
  input: { organizationId: OrganizationId; id: InboundEndpointId },
  next: { encryptedSecret: string; previousSecretExpiresAt: Date | null },
): Promise<InboundEndpointRow | null> {
  const [row] = await db
    .update(inboundEndpoint)
    .set({
      encryptedSecret: next.encryptedSecret,
      previousEncryptedSecret: next.previousSecretExpiresAt
        ? sql`${inboundEndpoint.encryptedSecret}`
        : null,
      previousSecretExpiresAt: next.previousSecretExpiresAt,
    })
    .where(
      and(
        eq(inboundEndpoint.id, input.id),
        eq(inboundEndpoint.organizationId, input.organizationId),
      ),
    )
    .returning();
  return row ?? null;
}

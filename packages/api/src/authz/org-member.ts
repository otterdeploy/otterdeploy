/**
 * Current organization membership, straight from the member table.
 *
 * A session NAMES its active organization; only the member table says the user
 * still belongs to it. Kept in its own module (no caddy/router imports) because
 * the oRPC builders in ../index.ts consult it on every org-scoped call.
 */
import { db } from "@otterdeploy/db";
import { member } from "@otterdeploy/db/schema/auth";
import { and, eq } from "drizzle-orm";

/** True when the user is a current member of the org (one indexed lookup). */
export async function isOrgMember(userId: string, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  return Boolean(row);
}

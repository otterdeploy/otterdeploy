/**
 * The install's public IPv4 as recorded, for display. `ensureServerIp`
 * (lib/server-ip.ts) is the writer, and it re-applies an env override to this
 * column at boot, so the column is the answer. Read on its own here so the
 * server router does not pull the address detector into its import graph.
 */
import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { eq } from "drizzle-orm";

export async function readPublicIp(): Promise<string | null> {
  const [row] = await db
    .select({ serverIp: platformSettings.serverIp })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return row?.serverIp ?? null;
}

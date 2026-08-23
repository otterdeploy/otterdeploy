/**
 * Where to reach this install's own edge when probing it.
 *
 * Certificate probes (lib/cert-probe) connect to the edge DIRECTLY rather
 * than to the public domain, so a Cloudflare-proxied domain still reports the
 * ORIGIN certificate Caddy serves instead of Cloudflare's. That needs an
 * address, and the address is the platform's configured public IP —
 * loopback in dev, or before detection has run.
 *
 * Extracted because three call sites had grown their own copy of this query
 * (the org certificate inventory, the per-project route certs, and the
 * control-plane domain's certificate state). They agreed, which is exactly
 * why the duplication was easy to miss and worth removing before a fourth
 * appeared.
 */

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { eq } from "drizzle-orm";

/** Loopback fallback: in dev (and on a fresh install before detection) the
 *  edge is reachable at 127.0.0.1, which is a better guess than refusing to
 *  probe at all. */
export const EDGE_HOST_FALLBACK = "127.0.0.1";

export async function readEdgeHost(): Promise<string> {
  const [row] = await db
    .select({ serverIp: platformSettings.serverIp })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);
  return row?.serverIp ?? EDGE_HOST_FALLBACK;
}

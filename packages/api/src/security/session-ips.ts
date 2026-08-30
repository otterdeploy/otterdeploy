/**
 * The addresses people are currently signed in from.
 *
 * A mass block reads its targets from the edge access log, which does not know
 * or care that one of those addresses is the operator's own. Banning it at
 * CrowdSec 403s them at the edge, from a screen whose whole job is to keep
 * them in control of the edge — and the ban survives the reload that would
 * have told them what happened. This is the set the block path subtracts.
 *
 * Deliberately server-side and never returned to the browser: it is a list of
 * where every member of the install is sitting right now, which is not a fact
 * the Firewall UI needs in order to say "3 skipped".
 */
import { db } from "@otterdeploy/db";
import { session } from "@otterdeploy/db/schema";
import { and, gt, isNotNull } from "drizzle-orm";

/**
 * better-auth writes `ipAddress` from the `x-forwarded-for` header, which is a
 * LIST when more than one proxy has appended to it. The first hop is the
 * client; anything after is infrastructure, and blocking on that would be both
 * wrong and useless.
 */
function firstHop(raw: string): string {
  const first = raw.split(",")[0];
  return first === undefined ? "" : first.trim();
}

/** Distinct client addresses with at least one unexpired session. */
export async function activeSessionIps(now: Date = new Date()): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ ipAddress: session.ipAddress })
    .from(session)
    .where(and(gt(session.expiresAt, now), isNotNull(session.ipAddress)));

  const ips = new Set<string>();
  for (const row of rows) {
    const ip = row.ipAddress === null ? "" : firstHop(row.ipAddress);
    if (ip) ips.add(ip);
  }
  return ips;
}

/**
 * The address THIS request came from.
 *
 * Reading `x-forwarded-for` straight off the headers is safe here only because
 * `sanitizeForwardingHeaders` (apps/server/src/index.ts, first middleware)
 * has already deleted it when the immediate TCP peer is not in TRUSTED_PROXIES.
 * A direct caller therefore cannot nominate someone else's address as "mine"
 * and have the guard refuse to ban it on their behalf.
 */
export function callerIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hop = firstHop(forwarded);
    if (hop) return hop;
  }
  const real = headers.get("x-real-ip")?.trim();
  return real ? real : null;
}

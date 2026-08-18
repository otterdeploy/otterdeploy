/**
 * Aggregate scanner-probe traffic from the edge access logs: the data behind
 * the Firewall "flagged IPs" panel and the periodic edge-anomaly alert. Both
 * group suspicious requests (path matches {@link THREAT_SQL_REGEX}) by client
 * IP over a recent window. DB-backed when persistence is on (the default);
 * falls back to the in-memory ring so it still works in a pure-tail setup.
 *
 * Windowed reads ({@link flaggedIps}) go against the raw `edge_log` rows and so
 * can never see further back than its retention. The all-time read
 * ({@link flaggedIpsAllTime}) goes against the `edge_threat_ip` rollup written
 * at ingest, which is never swept.
 */

import { db } from "@otterdeploy/db";
import { edgeLog } from "@otterdeploy/db/schema/edge-log";
import { edgeThreatIp } from "@otterdeploy/db/schema/edge-threat";
import { and, desc, gte, inArray, sql } from "drizzle-orm";

import { persistenceEnabled } from "./persist";
import { recentEdgeLogLines } from "./ring";
import { classifyThreat, THREAT_SQL_REGEX } from "./threat";

/** One flagged client IP, aggregated across an org's hosts. */
export interface FlaggedIp {
  ip: string;
  country: string | null;
  count: number;
  /** Earliest probe in the queried span. All-time for the rollup-backed view. */
  firstSeen: string;
  lastSeen: string;
  samplePaths: string[];
}

/** One (host, ip) probe group: the scan maps `host` back to an org. */
export interface HostThreatGroup {
  host: string;
  ip: string;
  country: string | null;
  count: number;
  samplePath: string;
}

const threatMatch = sql`${edgeLog.path} ~* ${THREAT_SQL_REGEX}`;

/** Flagged IPs across `hosts` since `sinceMs`, busiest first. */
export async function flaggedIps(
  hosts: string[],
  sinceMs: number,
  limit = 100,
): Promise<FlaggedIp[]> {
  if (hosts.length === 0) return [];
  const since = new Date(sinceMs);

  if (persistenceEnabled()) {
    const hostSet = sql`lower(${edgeLog.host})`;
    const rows = await db
      .select({
        ip: edgeLog.clientIp,
        country: sql<string | null>`max(${edgeLog.country})`,
        count: sql<number>`count(*)::int`,
        firstSeen: sql<string>`min(${edgeLog.ts})::text`,
        lastSeen: sql<string>`max(${edgeLog.ts})::text`,
        paths: sql<string[]>`(array_agg(distinct ${edgeLog.path}))[1:5]`,
      })
      .from(edgeLog)
      .where(and(inArray(hostSet, hosts), gte(edgeLog.ts, since), threatMatch))
      .groupBy(edgeLog.clientIp)
      .orderBy(desc(sql`count(*)`))
      .limit(limit);
    return rows.map((r) => ({
      ip: r.ip,
      country: r.country,
      count: r.count,
      firstSeen: new Date(r.firstSeen).toISOString(),
      lastSeen: new Date(r.lastSeen).toISOString(),
      samplePaths: r.paths ?? [],
    }));
  }

  // In-memory fallback: group the live ring in JS.
  const hostAllow = new Set(hosts.map((h) => h.toLowerCase()));
  const groups = new Map<string, FlaggedIp>();
  for (const l of recentEdgeLogLines(sinceMs)) {
    if (!hostAllow.has(l.host.toLowerCase())) continue;
    if (!classifyThreat(l.path)) continue;
    const g = groups.get(l.clientIp);
    if (g) {
      g.count += 1;
      if (l.ts < g.firstSeen) g.firstSeen = l.ts;
      if (l.ts > g.lastSeen) g.lastSeen = l.ts;
      if (g.samplePaths.length < 5 && !g.samplePaths.includes(l.path)) g.samplePaths.push(l.path);
      g.country ??= l.country;
    } else {
      groups.set(l.clientIp, {
        ip: l.clientIp,
        country: l.country,
        count: 1,
        firstSeen: l.ts,
        lastSeen: l.ts,
        samplePaths: [l.path],
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

/**
 * All-time flagged IPs for `hosts`, from the durable `edge_threat_ip` rollup.
 * Unlike {@link flaggedIps} this is NOT bounded by the raw log's retention: it
 * reads counters written at ingest, so it still reports a scanner that last
 * probed months ago and whose request rows were long since swept.
 *
 * Two queries on purpose. Postgres can't concatenate the per-host
 * `sample_paths` arrays inside a GROUP BY without multidimensional-array
 * gymnastics, so the scalars are aggregated in SQL (cheap, indexed, ranked)
 * and only the ≤`limit` winners have their sample paths fetched and merged.
 */
export async function flaggedIpsAllTime(hosts: string[], limit = 100): Promise<FlaggedIp[]> {
  if (hosts.length === 0) return [];
  const hostAllow = hosts.map((h) => h.toLowerCase());

  const totals = await db
    .select({
      ip: edgeThreatIp.clientIp,
      country: sql<string | null>`max(${edgeThreatIp.country})`,
      count: sql<number>`sum(${edgeThreatIp.probes})::int`,
      firstSeen: sql<string>`min(${edgeThreatIp.firstSeen})::text`,
      lastSeen: sql<string>`max(${edgeThreatIp.lastSeen})::text`,
    })
    .from(edgeThreatIp)
    .where(inArray(edgeThreatIp.host, hostAllow))
    .groupBy(edgeThreatIp.clientIp)
    .orderBy(desc(sql`sum(${edgeThreatIp.probes})`))
    .limit(limit);
  if (totals.length === 0) return [];

  const pathRows = await db
    .select({ ip: edgeThreatIp.clientIp, paths: edgeThreatIp.samplePaths })
    .from(edgeThreatIp)
    .where(
      and(
        inArray(edgeThreatIp.host, hostAllow),
        inArray(
          edgeThreatIp.clientIp,
          totals.map((t) => t.ip),
        ),
      ),
    );
  // Distinct across the org's hosts: the same scanner usually probes every
  // domain with the same path list, and five samples is the display budget.
  const pathsByIp = new Map<string, Set<string>>();
  for (const row of pathRows) {
    let set = pathsByIp.get(row.ip);
    if (!set) {
      set = new Set<string>();
      pathsByIp.set(row.ip, set);
    }
    for (const p of row.paths) set.add(p);
  }

  return totals.map((t) => ({
    ip: t.ip,
    country: t.country,
    count: t.count,
    firstSeen: new Date(t.firstSeen).toISOString(),
    lastSeen: new Date(t.lastSeen).toISOString(),
    samplePaths: [...(pathsByIp.get(t.ip) ?? [])].slice(0, 5),
  }));
}

/** All (host, ip) probe groups with ≥ `minCount` requests since `sinceMs`,
 *  across every host: the anomaly scan resolves each host to its org. */
export async function scanSuspiciousGroups(
  sinceMs: number,
  minCount: number,
): Promise<HostThreatGroup[]> {
  const since = new Date(sinceMs);

  if (persistenceEnabled()) {
    const host = sql<string>`lower(${edgeLog.host})`;
    const rows = await db
      .select({
        host,
        ip: edgeLog.clientIp,
        country: sql<string | null>`max(${edgeLog.country})`,
        count: sql<number>`count(*)::int`,
        samplePath: sql<string>`(array_agg(${edgeLog.path} order by ${edgeLog.ts} desc))[1]`,
      })
      .from(edgeLog)
      .where(and(gte(edgeLog.ts, since), threatMatch))
      .groupBy(host, edgeLog.clientIp)
      .having(sql`count(*) >= ${minCount}`);
    return rows.map((r) => ({
      host: r.host,
      ip: r.ip,
      country: r.country,
      count: r.count,
      samplePath: r.samplePath,
    }));
  }

  // In-memory fallback.
  const groups = new Map<string, HostThreatGroup>();
  for (const l of recentEdgeLogLines(sinceMs)) {
    if (!classifyThreat(l.path)) continue;
    const host = l.host.toLowerCase();
    const key = `${host} ${l.clientIp}`;
    const g = groups.get(key);
    if (g) {
      g.count += 1;
      g.country ??= l.country;
    } else {
      groups.set(key, {
        host,
        ip: l.clientIp,
        country: l.country,
        count: 1,
        samplePath: l.path,
      });
    }
  }
  return [...groups.values()].filter((g) => g.count >= minCount);
}

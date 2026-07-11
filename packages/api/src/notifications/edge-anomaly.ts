import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
/**
 * Edge-threat detector — a periodic, conservative scan over recent edge access
 * logs that emits `edge.probe` when one client IP hammers an org's domains with
 * scanner-style probes (`/.env`, `/actuator`, `*.php`, `?cmd=…` — see
 * edge-logs/threat.ts). Sibling of the audit-anomaly detector: same control-plane
 * tick, in-memory cooldown, best-effort try/catch, `unref`'d timer.
 *
 * Edge logs are host-scoped, not org-scoped, so each flagged (host, ip) group is
 * mapped back to its owning org via the proxy_route → project join, then
 * aggregated per (org, ip) before alerting. Subscribers who wired an email/Slack
 * channel to `edge.probe` get notified; nothing appears in-app unless the org
 * also opens the Firewall "flagged IPs" panel.
 */
import { eq } from "drizzle-orm";
import { log } from "evlog";

import type { HostThreatGroup } from "../edge-logs/threat-scan";

import { normalizeHost } from "../edge-logs/host";
import { scanSuspiciousGroups } from "../edge-logs/threat-scan";
import { emitPlatformEvent } from "./emit";

const WINDOW_MS = 10 * 60 * 1000; // look back 10 minutes
const REQUEST_THRESHOLD = 6; // suspicious requests from one ip to one host

/** key `(org, ip)` → last-emitted ms. Suppresses repeat alerts within the window. */
const cooldown = new Map<string, number>();

function claim(key: string, now: number): boolean {
  const last = cooldown.get(key);
  if (last !== undefined && now - last < WINDOW_MS) return false;
  cooldown.set(key, now);
  return true;
}

function pruneCooldown(now: number): void {
  for (const [key, ts] of cooldown) {
    if (now - ts >= WINDOW_MS) cooldown.delete(key);
  }
}

/** Canonical host → owning organization id, for mapping edge hosts to orgs. */
async function hostOrgMap(): Promise<Map<string, string>> {
  const rows = await db
    .select({ domain: proxyRoute.domain, orgId: project.organizationId })
    .from(proxyRoute)
    .innerJoin(project, eq(project.id, proxyRoute.projectId));
  const map = new Map<string, string>();
  for (const r of rows) map.set(normalizeHost(r.domain), r.orgId);
  return map;
}

interface OrgIpAgg {
  count: number;
  country: string | null;
  samplePath: string;
}

/** Fold (host, ip) probe groups into (org, ip): an IP probing several of an
 *  org's domains is one incident. Hosts with no owning org are dropped. Keyed
 *  `"<orgId> <ip>"`. */
function foldByOrgIp(
  groups: HostThreatGroup[],
  hostOrg: Map<string, string>,
): Map<string, OrgIpAgg> {
  const perOrgIp = new Map<string, OrgIpAgg>();
  for (const g of groups) {
    const orgId = hostOrg.get(g.host);
    if (!orgId) continue;
    const key = `${orgId} ${g.ip}`;
    const agg = perOrgIp.get(key);
    if (agg) {
      agg.count += g.count;
      agg.country ??= g.country;
    } else {
      perOrgIp.set(key, { count: g.count, country: g.country, samplePath: g.samplePath });
    }
  }
  return perOrgIp;
}

/** One scan pass. Never throws. */
export async function scanEdgeThreats(now = Date.now()): Promise<void> {
  try {
    const groups = await scanSuspiciousGroups(now - WINDOW_MS, REQUEST_THRESHOLD);
    if (groups.length === 0) return;

    const perOrgIp = foldByOrgIp(groups, await hostOrgMap());

    for (const [key, agg] of perOrgIp) {
      if (agg.count < REQUEST_THRESHOLD) continue;
      const [orgId, ip] = key.split(" ");
      if (!orgId || !ip) continue;
      if (!claim(key, now)) continue;
      const where = agg.country ? `${ip} (${agg.country})` : ip;
      await emitPlatformEvent({
        organizationId: orgId as OrganizationId,
        eventId: "edge.probe",
        title: "Suspicious edge traffic",
        message: `${agg.count} scanner-style probes from ${where} in the last 10 minutes — e.g. ${agg.samplePath}. Review and block from the Firewall page.`,
        data: {
          ip,
          count: String(agg.count),
          country: agg.country ?? "",
          samplePath: agg.samplePath,
        },
      }).catch(() => undefined);
    }

    pruneCooldown(now);
  } catch (cause) {
    log.warn({
      edgeAnomaly: { event: "scan-failed" },
      error: cause instanceof Error ? cause.message : String(cause),
    } as Record<string, unknown>);
  }
}

/**
 * Start the periodic edge-threat scan. Returns a stop handle. Scans every 5 min
 * (< the 10-min window) so a burst is caught promptly but only alerted once.
 */
export function startEdgeThreatScan(intervalMs = 5 * 60 * 1000): () => void {
  const timer = setInterval(() => void scanEdgeThreats(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Periodic re-probe of routes that are stuck on a self-signed certificate.
 *
 * THE PROBLEM. `acmeFor` decides ACME-vs-`tls internal` from the DNS reading
 * taken AT THE MOMENT a route is created (domain-rules.ts). Create a route
 * before its A record propagates — the common case, since the operator usually
 * adds the host here and the DNS record afterwards — and the route is written
 * with `usesAcme: false`. Nothing ever re-evaluated that. The only path back
 * was the operator noticing and pressing Recheck DNS on the row, and the only
 * way to notice was a browser rejecting the certificate: an operator hit
 * ERR_CERT_AUTHORITY_INVALID on a route the dashboard was calling "Live".
 *
 * So the decision gets re-taken on a schedule. When DNS starts pointing here,
 * the route flips to ACME and reconciles itself, and Caddy requests a real
 * certificate on the next config load — with nobody watching.
 *
 * WHAT IT WILL NOT DO. It re-probes only routes that are ALREADY on
 * `usesAcme: false`, so it can only ever upgrade. The downgrade guard
 * (`acmeForExistingRoute`) protects the other direction, and this sweep never
 * even looks at a route holding a working certificate — the failure mode of a
 * background task quietly replacing a valid Let's Encrypt cert with a
 * self-signed one is exactly what it must never risk.
 *
 * Names no CA will issue for (`.localhost`, `.sslip.io`) are skipped: they are
 * self-signed by design and re-probing them forever is pure noise. Routes
 * whose ownership is unverified are skipped too — the TXT challenge is the
 * operator's move to make.
 *
 * Cheap by construction: one indexed query per tick, and a DNS lookup only for
 * the routes that are actually stuck. On a healthy install that is zero.
 */
import type { ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { Result } from "better-result";
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { log } from "evlog";

import { reconcile } from "../../caddy";
import { updateProxyRoute } from "../../caddy/queries";
import { checkDomainReachability } from "../../lib/domain-reachability";
import { loadDomainSourcesForProject } from "../../lib/domain-sources";
import { acmeForExistingRoute } from "./domain-rules";

/** How often the sweep runs. Slow on purpose: DNS propagation is measured in
 *  minutes to hours, and a stuck route is an inconvenience rather than an
 *  outage, so there is nothing to gain from a tight loop. */
const SWEEP_INTERVAL_MS = 10 * 60_000;

/** Don't re-probe the same route more often than this, even across restarts —
 *  `dnsCheckedAt` is persisted, so a crash-looping control plane can't turn
 *  this into a resolver hammer. */
const MIN_RECHECK_AGE_MS = 10 * 60_000;

/** Routes probed per tick. A bound, not a page: whatever is missed is picked
 *  up on the next tick ten minutes later, and an install with hundreds of
 *  stuck routes has a bigger problem than certificate latency. */
const BATCH = 25;

/** Mirrors `canHoldPublicCert` in domain-rules.ts. Duplicated rather than
 *  exported because that one is a private detail of the decision rules; this
 *  is a query filter, and coupling the two would make the rules module's
 *  internals part of this file's contract. */
function canHoldPublicCert(domain: string): boolean {
  return !domain.endsWith(".localhost") && !domain.endsWith(".sslip.io");
}

async function sweepOnce(): Promise<void> {
  const cutoff = new Date(Date.now() - MIN_RECHECK_AGE_MS);

  const candidates = await db
    .select({
      id: proxyRoute.id,
      domain: proxyRoute.domain,
      projectId: proxyRoute.projectId,
      usesAcme: proxyRoute.usesAcme,
      certState: proxyRoute.certState,
      domainVerifiedAt: proxyRoute.domainVerifiedAt,
    })
    .from(proxyRoute)
    .where(
      and(
        // Only ever an upgrade: a route already on ACME is none of this
        // sweep's business.
        eq(proxyRoute.usesAcme, false),
        eq(proxyRoute.enabled, true),
        // Custom hosts need their TXT proof first; generated hosts carry no
        // verification timestamp and are ours by construction.
        or(isNotNull(proxyRoute.domainVerifiedAt), eq(proxyRoute.source, "generated")),
        // Never probed, or not probed recently enough.
        or(lt(proxyRoute.dnsCheckedAt, cutoff), isNull(proxyRoute.dnsCheckedAt)),
      ),
    )
    .limit(BATCH);

  const stuck = candidates.filter((route) => canHoldPublicCert(route.domain));
  if (stuck.length === 0) return;

  // One IP lookup per project, not per route: a project's routes share a
  // server, and `checkDomainReachability` returns "unknown" rather than
  // "pointed" without it (domain-reachability.ts:32) — which would make this
  // sweep silently incapable of ever promoting anything.
  const serverIps = new Map<ProjectId, string | null>();
  const serverIpFor = async (projectId: ProjectId): Promise<string | null> => {
    const cached = serverIps.get(projectId);
    if (cached !== undefined) return cached;
    const sources = await loadDomainSourcesForProject(projectId);
    const ip = sources?.serverIp ?? null;
    serverIps.set(projectId, ip);
    return ip;
  };

  let promoted = 0;
  for (const route of stuck) {
    const outcome = await Result.tryPromise({
      try: async () => {
        const reachability = await checkDomainReachability({
          domain: route.domain,
          serverIp: await serverIpFor(route.projectId),
        });

        const usesAcme = acmeForExistingRoute({
          domain: route.domain,
          dnsState: reachability.state,
          currentUsesAcme: route.usesAcme,
          certState: route.certState,
        });

        await updateProxyRoute(route.id, {
          dnsState: reachability.state,
          dnsCheckedAt: new Date(),
          usesAcme,
        });

        return usesAcme;
      },
      catch: (cause) => cause,
    });

    if (outcome.isErr()) {
      log.warn({
        certSweep: { event: "probe-failed", domain: route.domain },
        error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
      });
      continue;
    }
    if (outcome.value) promoted += 1;
  }

  // Re-render once for the whole batch, not per route: the Caddyfile is
  // regenerated wholesale, so N reconciles would be N identical renders.
  if (promoted > 0) {
    log.info({ certSweep: { event: "promoted", count: promoted, scanned: stuck.length } });
    // `reconcile` takes an optional RequestLogger and builds its own step
    // logger when absent (caddy/index.ts:141), so a background sweep with no
    // request context passes nothing rather than inventing one.
    await reconcile();
  }
}

/** Start the sweep. Returns a stop handle, matching the other background
 *  services in apps/server/src/background-services.ts. */
export function startCertRecheckSweep(): () => void {
  const tick = () => {
    void sweepOnce().catch((cause: unknown) => {
      log.warn({
        certSweep: { event: "tick-failed" },
        error: cause instanceof Error ? cause.message : String(cause),
      });
    });
  };
  const interval = setInterval(tick, SWEEP_INTERVAL_MS);
  return () => {
    clearInterval(interval);
  };
}

/**
 * Periodic probe that settles `proxy_route.cert_state` from the certificate
 * the edge actually serves.
 *
 * THE PROBLEM. `cert_state` was written only by the edge-log promoter
 * (edge-logs/cert-promote.ts), i.e. only when Caddy logged an issuance event
 * WHILE this process was listening. Anything that missed that moment stayed
 * "unknown" forever: a cert issued before the sink was up, before an upgrade
 * that taught the parser to read the event, or on an install whose sink is not
 * configured. Caddy only logs again at renewal, ~60 days later. So a domain
 * served with a perfectly good Let's Encrypt certificate kept telling the
 * operator nothing about its TLS.
 *
 * So the state is also re-read from ground truth on a schedule: a TLS
 * handshake against the edge with the domain as SNI (the same probe the
 * certificate inventory uses), judged by the TLS stack's own trust verdict.
 *
 * WHAT IT DECIDES. A trusted, unexpired certificate that names the domain
 * makes the route "valid". An expired one makes it "failed" with the date.
 * Nothing else changes the state: no certificate yet, or Caddy's interim
 * self-signed one, is what an issuance in flight looks like, and the reason an
 * issuance failed only exists in Caddy's log, which the promoter already
 * records. The probe can confirm a working certificate and catch a lapsed one;
 * it does not guess at failures it cannot see.
 *
 * Cheap by construction: only ACME routes, unsettled ones (unknown/obtaining)
 * every few minutes and settled ones twice a day, a bounded batch, oldest
 * check first so a long tail is worked through rather than starved.
 */
import { db } from "@otterdeploy/db";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { log } from "evlog";

import { type CertProbe, probeServedCertificate } from "../../lib/cert-probe";
import { readEdgeHost } from "../../lib/edge-host";
import { publishRouteUpserted } from "../project/project-event-bus";

/** Unsettled routes are re-probed this often: a fresh ACME issuance lands
 *  within a minute or two, and this is what an operator waits on. */
const UNSETTLED_RECHECK_MS = 2 * 60_000;

/** A route already "valid" is re-probed this rarely: only to notice a
 *  certificate that lapsed (renewals failing quietly for a month). */
const SETTLED_RECHECK_MS = 12 * 60 * 60_000;

/** Routes probed per tick; the rest are picked up on the next tick. */
const BATCH = 25;

export interface ProbedCertState {
  certState: "valid" | "failed";
  certError: string | null;
}

/** Does a certificate SAN cover this host? Exact match, or a single-label
 *  wildcard (`*.example.com` covers `a.example.com`, not `a.b.example.com`). */
function sanCovers(san: string, domain: string): boolean {
  const s = san.toLowerCase();
  const d = domain.toLowerCase();
  if (s === d) return true;
  if (!s.startsWith("*.")) return false;
  const dot = d.indexOf(".");
  return dot > 0 && d.slice(dot + 1) === s.slice(2);
}

/**
 * Pure: the cert state a probe proves, or null when it proves nothing (no
 * handshake, no certificate yet, Caddy's interim self-signed one, a cert for
 * another name). Separate from the I/O so the rules are unit-tested with plain
 * probe objects.
 */
export function certStateFromProbe(
  domain: string,
  probe: CertProbe,
  trustError: string | null,
): ProbedCertState | null {
  if (!probe.ok) return null;
  if (probe.status === "expired") {
    return {
      certState: "failed",
      certError: `The certificate the edge serves expired${probe.notAfter ? ` on ${probe.notAfter}` : ""}.`,
    };
  }
  if (probe.selfSigned || trustError !== null) return null;
  if (!probe.sans.some((san) => sanCovers(san, domain))) return null;
  return { certState: "valid", certError: null };
}

/** The I/O the pass does beyond the database, injectable so a test can stand
 *  in for the edge without a publicly trusted certificate to serve. */
export interface CertStateProbeDeps {
  probe: typeof probeServedCertificate;
  edgeHost: () => Promise<string>;
  now: () => number;
}

const LIVE_DEPS: CertStateProbeDeps = {
  probe: probeServedCertificate,
  edgeHost: readEdgeHost,
  now: () => Temporal.Now.instant().epochMilliseconds,
};

/** One pass: probe the due ACME routes and settle what the probes prove.
 *  Returns how many routes changed state. */
export async function probeCertStatesOnce(deps: CertStateProbeDeps = LIVE_DEPS): Promise<number> {
  const now = deps.now();
  // drizzle's timestamp columns take `Date`: the library seam the query demands.
  const unsettledCutoff = new Date(now - UNSETTLED_RECHECK_MS);
  const settledCutoff = new Date(now - SETTLED_RECHECK_MS);

  const candidates = await db
    .select({
      id: proxyRoute.id,
      domain: proxyRoute.domain,
      certState: proxyRoute.certState,
      certError: proxyRoute.certError,
    })
    .from(proxyRoute)
    .where(
      and(
        // `tls internal` routes are self-signed by design; there is no public
        // certificate to confirm.
        eq(proxyRoute.usesAcme, true),
        eq(proxyRoute.type, "http"),
        eq(proxyRoute.enabled, true),
        eq(proxyRoute.disabledByUser, false),
        or(
          and(
            inArray(proxyRoute.certState, ["unknown", "obtaining"]),
            or(isNull(proxyRoute.certCheckedAt), lt(proxyRoute.certCheckedAt, unsettledCutoff)),
          ),
          // "failed" is left to the edge log: the reason lives there, and a
          // retry that succeeds logs "certificate obtained" which promotes it.
          and(eq(proxyRoute.certState, "valid"), lt(proxyRoute.certCheckedAt, settledCutoff)),
        ),
      ),
    )
    .orderBy(sql`${proxyRoute.certCheckedAt} asc nulls first`, asc(proxyRoute.domain))
    .limit(BATCH);
  if (candidates.length === 0) return 0;

  const edgeHost = await deps.edgeHost();
  const probes = await Promise.all(
    candidates.map(async (route) => ({
      route,
      ...(await deps.probe({ domain: route.domain, host: edgeHost, now })),
    })),
  );

  const checkedAt = new Date(now);
  let changed = 0;
  for (const { route, probe, trustError } of probes) {
    const next = certStateFromProbe(route.domain, probe, trustError);
    const differs =
      next !== null && (next.certState !== route.certState || next.certError !== route.certError);
    const [row] = await db
      .update(proxyRoute)
      .set(next === null ? { certCheckedAt: checkedAt } : { ...next, certCheckedAt: checkedAt })
      .where(eq(proxyRoute.id, route.id))
      .returning();
    // Cert state moves with no user action, so this push is the only signal
    // the open domain card gets. Only on a real change: a probe that merely
    // re-confirms the state is not news.
    if (differs && row) {
      changed += 1;
      publishRouteUpserted("updated", row);
    }
  }
  if (changed > 0) {
    log.info({ certStateProbe: { event: "settled", changed, probed: probes.length } });
  }
  return changed;
}

/** First pass this long after boot, not a full interval later: an upgraded
 *  install converges its routes within a minute of restarting. */
const FIRST_PASS_DELAY_MS = 30_000;

/** Run a probe pass shortly after boot and then on an interval. Returns a stop
 *  handle. `run` is the pass itself, a parameter only so the schedule is
 *  testable without a database. */
export function startCertStateProbe(
  run: () => Promise<unknown> = () => probeCertStatesOnce(),
): () => void {
  const tick = () => {
    void Result.tryPromise({
      try: run,
      catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
    }).then((outcome) => {
      if (outcome.isErr()) {
        log.warn({ certStateProbe: { event: "tick-failed" }, error: outcome.error });
      }
    });
  };
  const first = setTimeout(tick, FIRST_PASS_DELAY_MS);
  const interval = setInterval(tick, UNSETTLED_RECHECK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}

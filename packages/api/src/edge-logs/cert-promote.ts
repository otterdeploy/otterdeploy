import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema/project";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { Result } from "better-result";
/**
 * Promote Caddy cert/ACME events (the operational log plane) onto the matching
 * `proxy_route` rows, so the domains-card can show a live TLS status, and emit
 * `cert.renewed` so subscribed notification channels fire.
 *
 * Best-effort: called fire-and-forget from the edge-log ingest path, wrapped in
 * a Result so a DB hiccup can never break ingest. Cert events are sparse
 * (issuance + ~60-day renewals), so a per-event DB write is cheap.
 *
 * Note: `cert.expiring` is NOT emitted here — Caddy logs obtain/renew/fail, not
 * "expiring". A pre-expiry warning needs a separate periodic scan of cert Not
 * After dates (deferred).
 */
import { inArray } from "drizzle-orm";
import { log } from "evlog";

import type { EdgeEventLine } from "./types";

import { emitPlatformEvent } from "../notifications/emit";

type CertState = "obtaining" | "valid" | "failed";

/** Map a cert event to a state, or null when it isn't state-changing (OCSP
 *  stapling, challenge-served chatter, etc.). Error level always wins. */
function certStateOf(event: EdgeEventLine): CertState | null {
  if (event.level === "error") return "failed";
  const m = event.msg.toLowerCase();
  if (/\b(obtained|renewed|issued)\b/.test(m)) return "valid";
  if (/\b(obtaining|renewing|issuing)\b/.test(m)) return "obtaining";
  return null;
}

export async function promoteCertEvent(event: EdgeEventLine): Promise<void> {
  if (event.category !== "cert") return;
  const state = certStateOf(event);
  if (!state) return;
  // Single-host ACME challenge errors carry `host`; cert-management batches
  // carry `domains`. Match either against the route table.
  const domains = [...new Set([event.host, ...event.domains].filter((d): d is string => !!d))];
  if (domains.length === 0) return;

  const ts = new Date(event.ts);
  const outcome = await Result.tryPromise({
    try: async () => {
      const updated = await db
        .update(proxyRoute)
        .set({
          certState: state,
          certError: state === "failed" ? (event.error ?? event.msg).slice(0, 500) : null,
          certCheckedAt: ts,
        })
        .where(inArray(proxyRoute.domain, domains))
        .returning({
          projectId: proxyRoute.projectId,
          domain: proxyRoute.domain,
        });
      if (updated.length === 0 || state !== "valid") return;

      // Fan a `cert.renewed` out per affected org (a batch event can span
      // several projects/orgs). Resolve org from each route's project.
      const projectIds = [...new Set(updated.map((r) => r.projectId))];
      const projRows = await db
        .select({ id: project.id, organizationId: project.organizationId })
        .from(project)
        .where(inArray(project.id, projectIds));
      const orgByProject = new Map(projRows.map((p) => [p.id, p.organizationId]));
      const domainsByOrg = new Map<OrganizationId, string[]>();
      for (const r of updated) {
        const org = orgByProject.get(r.projectId) as OrganizationId | undefined;
        if (!org) continue;
        domainsByOrg.set(org, [...(domainsByOrg.get(org) ?? []), r.domain]);
      }
      for (const [organizationId, doms] of domainsByOrg) {
        await emitPlatformEvent({
          organizationId,
          eventId: "cert.renewed",
          title: "TLS certificate issued",
          message: doms.join(", "),
          data: { domains: doms },
        });
      }
    },
    catch: (cause) => cause,
  });
  if (outcome.isErr()) {
    log.warn({
      edgeLog: { certPromote: "failed", domains },
      error: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
    });
  }
}

/**
 * One-click DNS for a service's custom domain.
 *
 * The control-plane FQDN and the workspace base domain already had this; a
 * service's own custom domain — the one people actually add most often — did
 * not, so it was the single surface still demanding hand-copied records. Same
 * primitive, applied to the remaining caller.
 *
 * The record set is derived here from the route, never accepted from the
 * caller: a connected Cloudflare token must not become an API for writing
 * arbitrary records into the operator's zone. The caller names a route; the
 * server decides what that route requires.
 */

import type { OrganizationId, ProxyRouteId, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { proxyRoute } from "@otterdeploy/db/schema/proxy-route";
import { Result, TaggedError } from "better-result";
import { and, eq } from "drizzle-orm";

import { upsertCloudflareDnsRecord } from "../../lib/cloudflare";
import { detectDnsProvider } from "../../lib/dns-detect";
import { requiredDnsRecords } from "../../lib/dns-records";
import { getOrganizationById } from "../organization/queries";

export class DomainAutoConfigureError extends TaggedError("DomainAutoConfigureError")<{
  reason: "not-found" | "no-cloudflare" | "no-zone" | "no-server-ip" | "api";
  message: string;
}>() {}

export async function autoConfigureServiceDomainDns(input: {
  organizationId: OrganizationId;
  resourceId: ResourceId;
  routeId: ProxyRouteId;
  serverIp: string | null;
}): Promise<Result<{ recordIds: string[] }, DomainAutoConfigureError>> {
  const [route] = await db
    .select({
      domain: proxyRoute.domain,
      verifyToken: proxyRoute.domainVerifyToken,
    })
    .from(proxyRoute)
    .where(and(eq(proxyRoute.id, input.routeId), eq(proxyRoute.resourceId, input.resourceId)))
    .limit(1);

  if (!route) {
    return Result.err(
      new DomainAutoConfigureError({ reason: "not-found", message: "Domain not found" }),
    );
  }
  if (!input.serverIp) {
    return Result.err(
      new DomainAutoConfigureError({
        reason: "no-server-ip",
        message: "This install has no public IP configured, so there is no address to point at.",
      }),
    );
  }

  const org = await getOrganizationById(input.organizationId);
  const token = org?.cloudflareApiToken ?? null;
  if (!token) {
    return Result.err(
      new DomainAutoConfigureError({
        reason: "no-cloudflare",
        message: "Connect a Cloudflare API token for this workspace first.",
      }),
    );
  }

  // The zone the token must cover. Detection gives the apex that actually
  // answers NS, which is also how Cloudflare keys a zone — so a delegated
  // subzone resolves to itself rather than its parent.
  const detected = await detectDnsProvider(route.domain);
  const zoneId = org?.cloudflareZoneId ?? null;
  if (!zoneId) {
    return Result.err(
      new DomainAutoConfigureError({
        reason: "no-zone",
        message: `No Cloudflare zone is configured for ${detected.zone ?? route.domain}.`,
      }),
    );
  }

  const records = requiredDnsRecords({
    domain: route.domain,
    serverIp: input.serverIp,
    verifyToken: route.verifyToken,
    zone: detected.zone,
  });

  const written = await Result.tryPromise({
    try: async () => {
      const ids: string[] = [];
      for (const record of records) {
        const created = await upsertCloudflareDnsRecord({
          token,
          zoneId,
          type: record.type,
          name: record.name,
          content: record.value,
          // DNS-only. An orange-clouded A record terminates TLS at Cloudflare
          // and breaks the ACME HTTP-01 challenge we are about to run, which
          // is the exact failure detectProxied exists to warn about — so the
          // one-click path must not create it.
          proxied: false,
        });
        ids.push(created.id);
      }
      return ids;
    },
    catch: (err) =>
      new DomainAutoConfigureError({
        reason: "api",
        message: err instanceof Error ? err.message : String(err),
      }),
  });
  if (written.isErr()) return Result.err(written.error);

  return Result.ok({ recordIds: written.value });
}

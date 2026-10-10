/**
 * The workspace base domain's DNS, as the settings page reads it: the two
 * records it needs and what DNS says about each, the connected Cloudflare
 * zone by name, and the hostnames a domain change leaves in place. Plus the
 * repair that adds the `*.<base>` wildcard for workspaces connected before
 * one-click wrote it (od-88n8). Split from ./handlers for size.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import {
  checkBaseDomainTxt,
  checkBaseDomainWildcard,
  ensureBaseDomainWildcard,
  type TxtDnsCheck,
  type WildcardDnsCheck,
} from "../../lib/base-domain-dns";
import {
  CLOUDFLARE_TRANSPORT_CODE,
  getCloudflareZone,
  isRejectedTokenError,
} from "../../lib/cloudflare";
import { detectDnsProvider } from "../../lib/dns-detect";
import { baseDomainDnsRecords, type RequiredDnsRecord } from "../../lib/dns-records";
import { resolvePublicDomain } from "../../lib/domains";
import { acmeForPlatformHost } from "../service/domain-rules";
import { OrganizationNotFoundError } from "./errors";
import {
  getOrganizationById,
  listGeneratedHostnamesUnder,
  readLocalBaseDomain,
  readPlatformServerIp,
} from "./queries";

type OrgId = OrganizationId;
type OrgRow = NonNullable<Awaited<ReturnType<typeof getOrganizationById>>>;

export type WildcardRepair = "created" | "present" | "skipped" | "failed";

/**
 * Add the `*.<base>` record for a workspace whose Cloudflare one-click ran
 * before it wrote one. Runs on save and verify, so an already-connected
 * workspace heals on its next visit without pressing anything new.
 *
 * Best-effort and create-only: a failure (token revoked, the domain is not in
 * the connected zone) must not fail the save or verify it rides on, and an
 * existing wildcard is the operator's and is left alone.
 */
export async function repairBaseDomainWildcard(row: OrgRow): Promise<WildcardRepair> {
  if (!row.baseDomain || !row.cloudflareApiToken || !row.cloudflareZoneId) return "skipped";
  const serverIp = await readPlatformServerIp();
  if (!serverIp) return "skipped";
  const ensured = await ensureBaseDomainWildcard({
    token: row.cloudflareApiToken,
    zoneId: row.cloudflareZoneId,
    baseDomain: row.baseDomain,
    serverIp,
  });
  if (ensured.isErr()) return "failed";
  return ensured.value.created ? "created" : "present";
}

/** What a newly exposed service gets right now, from the real resolver. */
export interface BaseDomainPublishingView {
  source: "org-base" | "local-base" | "sslip-fallback";
  /** The hostname after `<service>-<project>.`: `acme.com`, or
   *  `203.0.113.24.sslip.io` when no base domain is set. */
  suffix: string;
  certificate: "lets-encrypt" | "self-signed";
}

export interface BaseDomainDnsView {
  baseDomain: string | null;
  serverIp: string | null;
  publishing: BaseDomainPublishingView;
  /** Zone apex and provider, from the nameservers. Null zone when the lookup
   *  could not find one. */
  zone: string | null;
  provider: "cloudflare" | "unknown";
  /** The two records the base domain needs, each with what DNS says now. */
  records: (RequiredDnsRecord & { purpose: "wildcard" | "verify" })[];
  wildcard: Omit<WildcardDnsCheck, "reachability"> | null;
  txt: TxtDnsCheck | null;
}

// Placeholder slugs: the resolver needs a name to build a host, and the UI
// shows only the suffix after them.
const SAMPLE = { resourceSlug: "service", projectSlug: "project", kind: "service" } as const;

/**
 * The base domain's DNS as it is right now: the two records it needs, whether
 * each is in place, and what a newly exposed service is published at.
 *
 * Read-only. Verification is still stamped only by `verifyBaseDomain`; this
 * reports, so the page can tell the truth about the wildcard, which nothing
 * checked before.
 */
/** What a service exposed now would be published at, through the real
 *  resolver, with the same certificate decision the mint path makes. */
function publishingFor(
  row: OrgRow,
  serverIp: string | null,
  wildcard: WildcardDnsCheck | null,
): BaseDomainPublishingView {
  const resolved = resolvePublicDomain(SAMPLE, {
    resourceOverride: null,
    projectCustomDomain: null,
    projectCustomDomainVerifiedAt: null,
    orgBaseDomain: row.baseDomain,
    orgBaseDomainVerifiedAt: row.baseDomainVerifiedAt,
    localBaseDomain: readLocalBaseDomain(),
    serverIp,
  });
  const trusted = acmeForPlatformHost({
    domain: resolved.fqdn,
    isLocalBase: resolved.source === "local-base",
    apexVerified: resolved.verified,
    dnsState: wildcard?.reachability ?? "unknown",
  });
  return {
    // Only the three workspace-level sources can come back: no override or
    // project domain was passed in.
    source:
      resolved.source === "org-base" || resolved.source === "local-base"
        ? resolved.source
        : "sslip-fallback",
    suffix: resolved.fqdn.slice(`${SAMPLE.resourceSlug}-${SAMPLE.projectSlug}.`.length),
    certificate: trusted ? "lets-encrypt" : "self-signed",
  };
}

export async function checkOrganizationBaseDomainDns(
  orgId: OrgId,
): Promise<Result<BaseDomainDnsView, OrganizationNotFoundError>> {
  const row = await getOrganizationById(orgId);
  if (!row) return Result.err(new OrganizationNotFoundError(orgId));
  const serverIp = await readPlatformServerIp();
  const baseDomain = row.baseDomain;
  if (!baseDomain) {
    return Result.ok({
      baseDomain: null,
      serverIp,
      publishing: publishingFor(row, serverIp, null),
      zone: null,
      provider: "unknown",
      records: [],
      wildcard: null,
      txt: null,
    });
  }

  const [wildcard, txt, detected] = await Promise.all([
    checkBaseDomainWildcard({ baseDomain, serverIp }),
    checkBaseDomainTxt({ baseDomain, verifyToken: row.baseDomainVerifyToken }),
    detectDnsProvider(baseDomain),
  ]);
  const records = baseDomainDnsRecords({
    baseDomain,
    serverIp,
    verifyToken: row.baseDomainVerifyToken,
    zone: detected.zone,
  }).map((record) => ({
    ...record,
    purpose: record.type === "A" ? ("wildcard" as const) : ("verify" as const),
  }));

  return Result.ok({
    baseDomain,
    serverIp,
    publishing: publishingFor(row, serverIp, wildcard),
    zone: detected.zone,
    provider: detected.provider,
    records,
    wildcard: {
      probe: wildcard.probe,
      state: wildcard.state,
      addresses: wildcard.addresses,
      proxied: wildcard.proxied,
    },
    txt,
  });
}

export interface CloudflareZoneView {
  zoneId: string | null;
  /** The zone's name, read live from Cloudflare. Null when it could not be. */
  name: string | null;
  /** What Cloudflare said about the stored token just now. */
  token: "not-connected" | "ok" | "rejected" | "unreachable" | "error";
  message: string | null;
}

/**
 * The connected zone's name, read with the stored token. Only the zone id is
 * stored, which is all the page could show; asking Cloudflare also proves the
 * token still works, at the moment the page is looked at rather than claimed
 * from the day it was saved.
 */
export async function getOrganizationCloudflareZone(
  orgId: OrgId,
): Promise<Result<CloudflareZoneView, OrganizationNotFoundError>> {
  const row = await getOrganizationById(orgId);
  if (!row) return Result.err(new OrganizationNotFoundError(orgId));
  const zoneId = row.cloudflareZoneId;
  if (!row.cloudflareApiToken || !zoneId) {
    return Result.ok({ zoneId, name: null, token: "not-connected", message: null });
  }
  const zone = await getCloudflareZone(row.cloudflareApiToken, zoneId);
  if (zone.isOk()) {
    return Result.ok({ zoneId, name: zone.value.name, token: "ok", message: null });
  }
  const token = isRejectedTokenError(zone.error)
    ? "rejected"
    : zone.error.code === CLOUDFLARE_TRANSPORT_CODE
      ? "unreachable"
      : "error";
  return Result.ok({ zoneId, name: null, token, message: zone.error.message });
}

/** How many existing hostnames the change dialog lists by name. */
const HOSTNAME_LIST_LIMIT = 50;

/** Generated hostnames already serving under the current base domain: the
 *  ones a domain change leaves in place. */
export async function listOrganizationBaseDomainHostnames(
  orgId: OrgId,
): Promise<
  Result<
    { baseDomain: string | null; hostnames: string[]; total: number },
    OrganizationNotFoundError
  >
> {
  const row = await getOrganizationById(orgId);
  if (!row) return Result.err(new OrganizationNotFoundError(orgId));
  if (!row.baseDomain) return Result.ok({ baseDomain: null, hostnames: [], total: 0 });
  const found = await listGeneratedHostnamesUnder(orgId, row.baseDomain, HOSTNAME_LIST_LIMIT);
  return Result.ok({ baseDomain: row.baseDomain, ...found });
}

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
  checkPointsHere,
  ensureBaseDomainWildcard,
  type PointRecordOutcome,
  type WildcardDnsCheck,
} from "../../lib/base-domain-dns";
import {
  CLOUDFLARE_TRANSPORT_CODE,
  getCloudflareZone,
  type CloudflareError,
} from "../../lib/cloudflare";
import { detectDnsProvider } from "../../lib/dns-detect";
import { baseDomainDnsRecords } from "../../lib/dns-records";
import { resolvePublicDomain } from "../../lib/domains";
import { acmeForPlatformHost } from "../service/domain-rules";
import {
  redactServerIp,
  toPointingView,
  type BaseDomainDnsView,
  type BaseDomainPublishingView,
} from "./base-domain-view";
import { OrganizationNotFoundError } from "./errors";
import {
  getOrganizationById,
  listGeneratedHostnamesUnder,
  readLocalBaseDomain,
  readPlatformServerIps,
} from "./queries";

type OrgId = OrganizationId;
type OrgRow = NonNullable<Awaited<ReturnType<typeof getOrganizationById>>>;

export type WildcardRepair = PointRecordOutcome["state"] | "skipped" | "failed";

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
  const { serverIp, serverIpv6 } = await readPlatformServerIps();
  if (!serverIp) return "skipped";
  const ensured = await ensureBaseDomainWildcard({
    token: row.cloudflareApiToken,
    zoneId: row.cloudflareZoneId,
    baseDomain: row.baseDomain,
    serverIp,
    serverIpv6,
  });
  return ensured.isErr() ? "failed" : ensured.value.state;
}

// Placeholder slugs: the resolver needs a name to build a host, and the UI
// shows only the suffix after them.
const SAMPLE = { resourceSlug: "service", projectSlug: "project", kind: "service" } as const;

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
  const suffix = resolved.fqdn.slice(`${SAMPLE.resourceSlug}-${SAMPLE.projectSlug}.`.length);
  // Only the three workspace-level sources can come back: no override or
  // project domain was passed in.
  if (resolved.source === "org-base" || resolved.source === "local-base") {
    return {
      source: resolved.source,
      suffix,
      onServerIp: false,
      certificate: trusted ? "lets-encrypt" : "self-signed",
    };
  }
  // The sslip suffix embeds the server IP. It is returned without it, and the
  // page puts the (masked) address in front: see ./base-domain-view.
  return {
    source: "sslip-fallback",
    suffix: serverIp ? "sslip.io" : suffix,
    onServerIp: serverIp !== null,
    certificate: trusted ? "lets-encrypt" : "self-signed",
  };
}

/**
 * The base domain's DNS as it is right now: the two records it needs, whether
 * each is in place, where the apex points, and what a newly exposed service is
 * published at.
 *
 * Read-only. Verification is still stamped only by `verifyBaseDomain`.
 *
 * `revealServerIp` is the caller's install-admin status. The server's address
 * is sensitive: every other caller gets the same states with the address
 * removed (see {@link redactServerIp}).
 */
export async function checkOrganizationBaseDomainDns(
  orgId: OrgId,
  options: { revealServerIp: boolean },
): Promise<Result<BaseDomainDnsView, OrganizationNotFoundError>> {
  const row = await getOrganizationById(orgId);
  if (!row) return Result.err(new OrganizationNotFoundError(orgId));
  const ips = await readPlatformServerIps();
  const { serverIp } = ips;
  const baseDomain = row.baseDomain;
  if (!baseDomain) {
    return Result.ok(
      redactServerIp(
        {
          baseDomain: null,
          serverIp,
          serverIpHidden: false,
          publishing: publishingFor(row, serverIp, null),
          zone: null,
          provider: "unknown",
          records: [],
          wildcard: null,
          apex: null,
          txt: null,
        },
        ips,
        options.revealServerIp,
      ),
    );
  }

  const [wildcard, apex, txt, detected] = await Promise.all([
    checkBaseDomainWildcard({ baseDomain, serverIp }),
    checkPointsHere({ name: baseDomain, serverIp }),
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

  return Result.ok(
    redactServerIp(
      {
        baseDomain,
        serverIp,
        serverIpHidden: false,
        publishing: publishingFor(row, serverIp, wildcard),
        zone: detected.zone,
        provider: detected.provider,
        records,
        wildcard: toPointingView(wildcard),
        apex: toPointingView(apex),
        txt,
      },
      ips,
      options.revealServerIp,
    ),
  );
}

/** Cloudflare's answers for a token it no longer accepts: invalid (1000),
 *  bad or expired access token (9109), authentication error (10000), and
 *  the token-format errors (6003, 6111). */
const CLOUDFLARE_REJECTED_TOKEN_CODES = new Set([1000, 6003, 6111, 9109, 10000]);

function isRejectedTokenError(error: CloudflareError): boolean {
  return (
    CLOUDFLARE_REJECTED_TOKEN_CODES.has(error.code) || error.code === 401 || error.code === 403
  );
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
